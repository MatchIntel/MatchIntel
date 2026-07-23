import { pool, query, tx } from "./db.js";
import { config } from "./config.js";
import { fetchFortniteTrackerPublic, fetchGlobalEarningsLeaderboard, ProviderHttpError } from "./trackerPublicProvider.js";

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalize = value => String(value || "").trim().normalize("NFKC").toLowerCase();
const publicStatus = new Set(["ready", "stale", "queued", "refreshing", "retrying", "unavailable"]);

export const enrichmentWorkerState = {
  running: false,
  processed: 0,
  succeeded: 0,
  failed: 0,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  blockedUntil: null,
  leaderboardSeededAt: null,
  leaderboardSeedCount: 0
};

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const result = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function playerInput(body) {
  const raw = Array.isArray(body?.players)
    ? body.players
    : (body?.names || []).map(displayName => ({ displayName }));
  const unique = new Map();
  for (const item of raw.slice(0, 200)) {
    const player = typeof item === "string" ? { displayName: item } : (item || {});
    const displayName = String(player.displayName || player.name || "").trim();
    if (!displayName || /^anonymous(?:\[|$|\s)/i.test(displayName)) continue;
    const normalizedName = normalize(displayName);
    if (!normalizedName || unique.has(normalizedName)) continue;
    unique.set(normalizedName, {
      normalizedName,
      displayName,
      accountId: String(player.accountId || "").trim() || null,
      region: String(player.region || body?.region || "").trim().toUpperCase() || null
    });
  }
  return [...unique.values()].slice(0, 120);
}

function outputFromCache(player, row, now = Date.now()) {
  const updatedAt = row?.last_success_at || row?.updated_at || null;
  const nextRefreshAt = row?.next_refresh_at || row?.expires_at || null;
  const hasData = row && (row.power_ranking != null || row.lifetime_earnings != null);
  const refreshDue = !nextRefreshAt || new Date(nextRefreshAt).getTime() <= now;
  let status = row?.status || (hasData ? "ready" : "unavailable");
  if (hasData && refreshDue) status = "stale";
  if (!publicStatus.has(status)) status = hasData ? "ready" : "unavailable";
  return {
    requestedName: player.displayName,
    normalizedName: player.normalizedName,
    displayName: row?.display_name || player.displayName,
    accountId: row?.account_id || player.accountId,
    region: row?.region || player.region,
    powerRanking: finiteNumber(row?.power_ranking),
    lifetimeEarnings: finiteNumber(row?.lifetime_earnings),
    provider: row?.provider || config.enrichment.provider,
    sourceUrl: row?.source_url || null,
    status,
    cached: Boolean(row),
    stale: Boolean(hasData && refreshDue),
    updatedAt,
    lastCheckedAt: row?.last_checked_at || null,
    nextRefreshAt,
    error: row?.last_error || null
  };
}

async function cacheRows(players) {
  if (!players.length) return { byName: new Map(), byAccount: new Map(), jobs: new Map() };
  const requestedNames = players.map(player => player.normalizedName);
  const accountIds = players.map(player => player.accountId).filter(Boolean);
  const result = await query(`
    SELECT normalized_name, display_name, account_id, region, power_ranking,
           lifetime_earnings, provider, source_url, status, expires_at,
           last_checked_at, last_success_at, next_refresh_at, last_error, updated_at
    FROM enrichment_cache
    WHERE normalized_name = ANY($1::text[])
       OR (CARDINALITY($2::text[]) > 0 AND account_id = ANY($2::text[]))
  `, [requestedNames, accountIds]);
  const jobKeys = [...new Set([...requestedNames, ...result.rows.map(row => row.normalized_name)])];
  const jobs = await query(`
    SELECT normalized_name, status, run_after, attempts, last_error
    FROM enrichment_jobs
    WHERE normalized_name = ANY($1::text[])
  `, [jobKeys]);
  return {
    byName: new Map(result.rows.map(row => [row.normalized_name, row])),
    byAccount: new Map(result.rows.filter(row => row.account_id).map(row => [row.account_id, row])),
    jobs: new Map(jobs.rows.map(row => [row.normalized_name, row]))
  };
}

async function queuePlayers(items) {
  if (!items.length || config.enrichment.provider === "disabled") return;
  const names = items.map(item => item.player.normalizedName);
  const displayNames = items.map(item => item.player.displayName);
  const accountIds = items.map(item => item.player.accountId);
  const regions = items.map(item => item.player.region);
  const priorities = items.map(item => item.priority);

  await query(`
    INSERT INTO enrichment_jobs(
      normalized_name, display_name, account_id, region, priority,
      status, attempts, run_after, created_at, updated_at
    )
    SELECT normalized_name, display_name, account_id, region, priority,
           'queued', 0, NOW(), NOW(), NOW()
    FROM UNNEST(
      $1::text[], $2::text[], $3::text[], $4::text[], $5::integer[]
    ) AS incoming(normalized_name, display_name, account_id, region, priority)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      account_id = COALESCE(EXCLUDED.account_id, enrichment_jobs.account_id),
      region = COALESCE(EXCLUDED.region, enrichment_jobs.region),
      priority = GREATEST(enrichment_jobs.priority, EXCLUDED.priority),
      status = CASE WHEN enrichment_jobs.status = 'running' THEN 'running' ELSE 'queued' END,
      run_after = CASE
        WHEN enrichment_jobs.status = 'running' THEN enrichment_jobs.run_after
        ELSE LEAST(enrichment_jobs.run_after, NOW())
      END,
      updated_at = NOW()
  `, [names, displayNames, accountIds, regions, priorities]);
}

export async function enrich(req, res) {
  const players = playerInput(req.body);
  if (!players.length) return res.json({ players: [], queue: { requested: 0 } });

  const rows = await cacheRows(players);
  const now = Date.now();
  const force = Boolean(req.body?.force);
  const queue = [];
  const output = [];

  for (const player of players) {
    const row = (player.accountId && rows.byAccount.get(player.accountId)) || rows.byName.get(player.normalizedName);
    const cacheKey = row?.normalized_name || player.normalizedName;
    const job = rows.jobs.get(cacheKey);
    const item = outputFromCache(player, row, now);
    if (job) {
      item.status = job.status === "running" ? "refreshing" : job.status;
      item.retryAt = job.run_after || null;
      item.error = job.last_error || item.error;
    }
    const hasData = item.powerRanking != null || item.lifetimeEarnings != null;
    const neverSeen = !row;
    const negativeCacheExpired = row && !hasData && (
      !row.next_refresh_at || new Date(row.next_refresh_at).getTime() <= now
    );

    if (force || (!job && (neverSeen || negativeCacheExpired || item.stale))) {
      queue.push({
        player: {
          ...player,
          // Keep one cache record when the same Epic account changes names.
          normalizedName: cacheKey
        },
        priority: neverSeen || !hasData ? 100 : (force ? 80 : 50)
      });
      item.status = hasData ? "refreshing" : "queued";
    }
    output.push(item);
  }

  await queuePlayers(queue);
  res.json({
    players: output,
    queue: {
      requested: queue.length,
      provider: config.enrichment.provider,
      workerRunning: enrichmentWorkerState.running,
      blockedUntil: enrichmentWorkerState.blockedUntil
    }
  });
}

function adaptConfigured(name, body) {
  const root = body?.data || body?.player || body || {};
  return {
    requestedName: name,
    displayName: root.displayName || root.name || name,
    accountId: root.accountId || root.account_id || null,
    powerRanking: finiteNumber(root.powerRanking ?? root.power_ranking ?? root.pr ?? root.currentPr ?? root.stats?.powerRanking ?? root.stats?.pr),
    lifetimeEarnings: finiteNumber(root.lifetimeEarnings ?? root.lifetime_earnings ?? root.earnings ?? root.prizeMoney ?? root.stats?.earnings),
    sourceUrl: root.sourceUrl || null,
    provider: root.provider || "configured",
    raw: body
  };
}

async function fetchConfigured(player) {
  if (!config.enrichment.endpointTemplate) {
    throw new Error("ENRICHMENT_ENDPOINT_TEMPLATE is not configured.");
  }
  const url = config.enrichment.endpointTemplate
    .replaceAll("{name}", encodeURIComponent(player.displayName))
    .replaceAll("{accountId}", encodeURIComponent(player.accountId || ""))
    .replaceAll("{region}", encodeURIComponent(player.region || ""));
  const headers = { Accept: "application/json" };
  if (config.enrichment.apiKey) headers[config.enrichment.apiHeader] = config.enrichment.apiKey;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(config.enrichment.requestTimeoutMs)
  });
  if (!response.ok) {
    throw new ProviderHttpError(response.status, `Enrichment provider returned HTTP ${response.status}`);
  }
  return adaptConfigured(player.displayName, await response.json());
}

async function fetchProvider(player) {
  if (config.enrichment.provider === "configured") return fetchConfigured(player);
  if (config.enrichment.provider === "fortnitetracker-public") return fetchFortniteTrackerPublic(player);
  throw new Error("Player enrichment is disabled.");
}

async function claimJob() {
  return tx(async client => {
    const result = await client.query(`
      WITH next_job AS (
        SELECT normalized_name
        FROM enrichment_jobs
        WHERE status IN ('queued', 'retrying')
          AND run_after <= NOW()
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE enrichment_jobs AS job
      SET status='running', locked_at=NOW(), updated_at=NOW()
      FROM next_job
      WHERE job.normalized_name = next_job.normalized_name
      RETURNING job.*
    `);
    return result.rows[0] || null;
  });
}

async function saveSuccess(job, result) {
  const hasData = result.powerRanking != null || result.lifetimeEarnings != null;
  const refreshHours = hasData
    ? config.enrichment.cacheHours
    : config.enrichment.negativeCacheHours;
  const nextRefreshAt = new Date(Date.now() + refreshHours * 3600000);
  const status = hasData ? "ready" : "unavailable";

  await tx(async client => {
    await client.query(`
      INSERT INTO enrichment_cache(
        normalized_name, display_name, account_id, region, power_ranking,
        lifetime_earnings, provider, source_url, raw, status, expires_at,
        last_checked_at, last_success_at, next_refresh_at, last_error, updated_at
      ) VALUES(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),
        CASE WHEN $12::boolean THEN NOW() ELSE NULL END,$11,NULL,NOW()
      )
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        account_id=COALESCE(EXCLUDED.account_id,enrichment_cache.account_id),
        region=COALESCE(EXCLUDED.region,enrichment_cache.region),
        power_ranking=CASE
          WHEN EXCLUDED.power_ranking IS NOT NULL THEN EXCLUDED.power_ranking
          ELSE enrichment_cache.power_ranking
        END,
        lifetime_earnings=CASE
          WHEN EXCLUDED.lifetime_earnings IS NOT NULL THEN EXCLUDED.lifetime_earnings
          ELSE enrichment_cache.lifetime_earnings
        END,
        provider=EXCLUDED.provider,
        source_url=COALESCE(EXCLUDED.source_url,enrichment_cache.source_url),
        raw=EXCLUDED.raw,
        status=CASE
          WHEN EXCLUDED.power_ranking IS NOT NULL OR EXCLUDED.lifetime_earnings IS NOT NULL THEN 'ready'
          WHEN enrichment_cache.power_ranking IS NOT NULL OR enrichment_cache.lifetime_earnings IS NOT NULL THEN 'stale'
          ELSE 'unavailable'
        END,
        expires_at=EXCLUDED.expires_at,
        last_checked_at=NOW(),
        last_success_at=CASE
          WHEN EXCLUDED.power_ranking IS NOT NULL OR EXCLUDED.lifetime_earnings IS NOT NULL THEN NOW()
          ELSE enrichment_cache.last_success_at
        END,
        next_refresh_at=EXCLUDED.next_refresh_at,
        last_error=NULL,
        updated_at=NOW()
    `, [
      job.normalized_name,
      result.displayName || job.display_name,
      result.accountId || job.account_id,
      job.region,
      result.powerRanking,
      result.lifetimeEarnings,
      result.provider,
      result.sourceUrl,
      result.raw || {},
      status,
      nextRefreshAt,
      hasData
    ]);
    await client.query("DELETE FROM enrichment_jobs WHERE normalized_name=$1", [job.normalized_name]);
  });
}

function retryDelay(attempts, error) {
  if (error?.retryAfterMs != null) return Math.max(1000, error.retryAfterMs);
  return Math.min(
    config.enrichment.maxRetryMinutes * 60000,
    Math.max(15000, 15000 * (2 ** Math.max(0, attempts - 1)))
  );
}

async function saveFailure(job, error) {
  const attempts = Number(job.attempts || 0) + 1;
  const message = String(error?.message || error || "Unknown enrichment error").slice(0, 500);
  const terminal = attempts >= config.enrichment.maxAttempts && !(error instanceof ProviderHttpError && [403, 429].includes(error.status));
  const delay = retryDelay(attempts, error);

  if (error instanceof ProviderHttpError && [403, 429].includes(error.status)) {
    const blockedUntil = new Date(Date.now() + Math.max(delay, config.enrichment.blockedCooldownMinutes * 60000));
    enrichmentWorkerState.blockedUntil = blockedUntil.toISOString();
  }

  await tx(async client => {
    await client.query(`
      INSERT INTO enrichment_cache(
        normalized_name, display_name, account_id, region, provider, raw,
        status, expires_at, last_checked_at, next_refresh_at, last_error, updated_at
      ) VALUES($1,$2,$3,$4,$5,'{}'::jsonb,'unavailable',$6,NOW(),$6,$7,NOW())
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        account_id=COALESCE(EXCLUDED.account_id,enrichment_cache.account_id),
        region=COALESCE(EXCLUDED.region,enrichment_cache.region),
        status=CASE
          WHEN enrichment_cache.power_ranking IS NOT NULL OR enrichment_cache.lifetime_earnings IS NOT NULL THEN 'stale'
          ELSE 'unavailable'
        END,
        last_checked_at=NOW(),
        next_refresh_at=EXCLUDED.next_refresh_at,
        expires_at=EXCLUDED.expires_at,
        last_error=EXCLUDED.last_error,
        updated_at=NOW()
    `, [
      job.normalized_name,
      job.display_name,
      job.account_id,
      job.region,
      config.enrichment.provider,
      new Date(Date.now() + delay),
      message
    ]);

    if (terminal) {
      await client.query("DELETE FROM enrichment_jobs WHERE normalized_name=$1", [job.normalized_name]);
    } else {
      await client.query(`
        UPDATE enrichment_jobs
        SET status='retrying', attempts=$2, run_after=$3,
            locked_at=NULL, last_error=$4, updated_at=NOW()
        WHERE normalized_name=$1
      `, [job.normalized_name, attempts, new Date(Date.now() + delay), message]);
    }
  });
}

async function recoverStuckJobs() {
  await query(`
    UPDATE enrichment_jobs
    SET status='retrying', run_after=NOW(), locked_at=NULL,
        last_error=COALESCE(last_error,'Recovered after worker restart.'), updated_at=NOW()
    WHERE status='running'
      AND locked_at < NOW() - ($1::integer * INTERVAL '1 second')
  `, [Math.ceil(config.enrichment.requestTimeoutMs / 1000) + 60]);
}

async function seedGlobalLeaderboard() {
  if (!config.enrichment.seedGlobalLeaderboard || config.enrichment.provider !== "fortnitetracker-public") return;
  try {
    const result = await fetchGlobalEarningsLeaderboard();
    if (!result.players.length) throw new Error("No leaderboard players were parsed.");
    for (const player of result.players) {
      const normalizedName = normalize(player.displayName);
      const nextRefreshAt = new Date(Date.now() + config.enrichment.leaderboardSeedHours * 3600000);
      await query(`
        INSERT INTO enrichment_cache(
          normalized_name, display_name, power_ranking, lifetime_earnings,
          provider, source_url, raw, status, expires_at, last_checked_at,
          last_success_at, next_refresh_at, last_error, updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,'ready',$8,NOW(),NOW(),$8,NULL,NOW())
        ON CONFLICT(normalized_name) DO UPDATE SET
          display_name=EXCLUDED.display_name,
          power_ranking=COALESCE(EXCLUDED.power_ranking,enrichment_cache.power_ranking),
          lifetime_earnings=COALESCE(EXCLUDED.lifetime_earnings,enrichment_cache.lifetime_earnings),
          provider=EXCLUDED.provider,
          source_url=EXCLUDED.source_url,
          raw=EXCLUDED.raw,
          status='ready',
          expires_at=EXCLUDED.expires_at,
          last_checked_at=NOW(),
          last_success_at=NOW(),
          next_refresh_at=EXCLUDED.next_refresh_at,
          last_error=NULL,
          updated_at=NOW()
      `, [normalizedName, player.displayName, player.powerRanking, player.lifetimeEarnings,
        player.provider, player.sourceUrl, { source: "global-earnings-leaderboard" }, nextRefreshAt]);
    }
    enrichmentWorkerState.leaderboardSeededAt = new Date().toISOString();
    enrichmentWorkerState.leaderboardSeedCount = result.players.length;
    console.log(`[enrichment] Seeded ${result.players.length} global leaderboard players.`);
  } catch (error) {
    console.warn(`[enrichment] Global leaderboard seed skipped: ${error.message}`);
  }
}

function startLeaderboardSeedLoop() {
  if (!config.enrichment.seedGlobalLeaderboard) return;
  const run = async () => {
    await seedGlobalLeaderboard();
    const timer = setTimeout(run, config.enrichment.leaderboardSeedHours * 3600000);
    timer.unref?.();
  };
  void run();
}

export async function startEnrichmentWorker() {
  if (enrichmentWorkerState.running || config.enrichment.provider === "disabled") return;
  enrichmentWorkerState.running = true;
  await recoverStuckJobs().catch(error => console.error(`[enrichment] Recovery failed: ${error.message}`));
  console.log(`[enrichment] Worker started with provider=${config.enrichment.provider}`);
  startLeaderboardSeedLoop();

  while (enrichmentWorkerState.running) {
    try {
      if (enrichmentWorkerState.blockedUntil) {
        const wait = new Date(enrichmentWorkerState.blockedUntil).getTime() - Date.now();
        if (wait > 0) {
          await sleep(Math.min(wait, 30000));
          continue;
        }
        enrichmentWorkerState.blockedUntil = null;
      }

      const job = await claimJob();
      if (!job) {
        await sleep(config.enrichment.idlePollMs);
        continue;
      }

      enrichmentWorkerState.lastRunAt = new Date().toISOString();
      enrichmentWorkerState.processed += 1;
      try {
        const result = await fetchProvider({
          displayName: job.display_name,
          accountId: job.account_id,
          region: job.region
        });
        await saveSuccess(job, result);
        enrichmentWorkerState.succeeded += 1;
        enrichmentWorkerState.lastSuccessAt = new Date().toISOString();
        enrichmentWorkerState.lastError = null;
      } catch (error) {
        enrichmentWorkerState.failed += 1;
        enrichmentWorkerState.lastError = String(error?.message || error).slice(0, 500);
        await saveFailure(job, error);
        console.warn(`[enrichment] ${job.display_name}: ${enrichmentWorkerState.lastError}`);
      }
      await sleep(config.enrichment.requestIntervalMs);
    } catch (error) {
      enrichmentWorkerState.lastError = String(error?.message || error).slice(0, 500);
      console.error(`[enrichment] Worker loop error: ${enrichmentWorkerState.lastError}`);
      await sleep(5000);
    }
  }
}

export function stopEnrichmentWorker() {
  enrichmentWorkerState.running = false;
}

export async function enrichmentQueueStatus(_req, res) {
  const [queued, cached] = await Promise.all([
    query(`SELECT status, COUNT(*)::integer AS count FROM enrichment_jobs GROUP BY status`),
    query(`
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE power_ranking IS NOT NULL)::integer AS with_pr,
        COUNT(*) FILTER (WHERE lifetime_earnings IS NOT NULL)::integer AS with_earnings,
        COUNT(*) FILTER (WHERE next_refresh_at <= NOW())::integer AS stale
      FROM enrichment_cache
    `)
  ]);
  res.json({
    provider: config.enrichment.provider,
    worker: enrichmentWorkerState,
    jobs: Object.fromEntries(queued.rows.map(row => [row.status, Number(row.count)])),
    cache: cached.rows[0]
  });
}
