import { config } from "./config.js";
import { ProviderHttpError } from "./trackerPublicProvider.js";

let citoRateGate = Promise.resolve();
let citoNextRequestAt = 0;

async function waitForCitoRateSlot(requestsPerMinute) {
  const intervalMs = Math.ceil(60000 / Math.max(1, Number(requestsPerMinute) || 1));
  const turn = citoRateGate.then(async () => {
    const waitMs = citoNextRequestAt - Date.now();
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    citoNextRequestAt = Date.now() + intervalMs;
  });
  citoRateGate = turn.catch(() => {});
  await turn;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function errorCode(body) {
  return String(
    body?.code ||
    body?.error?.code ||
    body?.error_code ||
    ""
  ).trim().toUpperCase();
}

function errorMessage(body, fallback) {
  const error = body?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error.message === "string" && error.message.trim()) return error.message.trim();
  if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
  return fallback;
}

function retryAfterMilliseconds(response, body) {
  const bodySeconds = firstFinite(
    body?.retry_after_seconds,
    body?.retryAfterSeconds,
    body?.error?.retry_after_seconds,
    body?.error?.retryAfterSeconds
  );
  if (bodySeconds != null) return Math.max(1000, bodySeconds * 1000);

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
    const date = new Date(retryAfter).getTime();
    if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  }

  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.max(1000, reset * 1000 - Date.now());
  }
  return null;
}

function identifierNotFound(status, body) {
  if (status === 404) return true;
  if (body?.data_available === false && String(body?.reason || "").toLowerCase().includes("identifier")) return true;
  const code = errorCode(body);
  return [
    "NOT_FOUND",
    "PLAYER_NOT_FOUND",
    "IDENTIFIER_NOT_FOUND",
    "UNKNOWN_PLAYER"
  ].includes(code);
}

function statusFromBody(responseStatus, body) {
  const code = errorCode(body);
  if (["UNAUTHORIZED", "INVALID_API_KEY", "API_KEY_INVALID"].includes(code)) return 401;
  if (["FORBIDDEN", "PLAN_REQUIRED", "UPGRADE_REQUIRED"].includes(code)) return 403;
  if (["RATE_LIMITED", "RATE_LIMIT_EXCEEDED", "TOO_MANY_REQUESTS"].includes(code)) return 429;
  return responseStatus || 502;
}

export function parseCitoPlayerResponse(body, requestedName = "", sourceUrl = null) {
  const root = body?.data || body?.player || body || {};
  const identifiers = root?.identifiers || {};
  const earnings = root?.earnings || root?.careerEarnings || {};

  const displayName = clean(
    root.display_name ||
    root.displayName ||
    root.name ||
    identifiers.display_name ||
    identifiers.displayName ||
    requestedName
  ) || requestedName;

  const accountId = clean(
    identifiers.epic_account_id ||
    identifiers.epicAccountId ||
    root.epic_account_id ||
    root.epicAccountId ||
    root.account_id ||
    root.accountId
  );

  const lifetimeEarnings = firstFinite(
    earnings.total,
    earnings.earnings_usd,
    earnings.earningsUsd,
    earnings.totalEarnings,
    root.totalEarnings,
    root.total_earnings,
    root.lifetimeEarnings,
    root.lifetime_earnings,
    root.earningsTotal,
    root.earnings_total
  );

  const powerRanking = firstFinite(
    root.powerRanking,
    root.power_ranking,
    root.pr,
    root.currentPr,
    root.current_pr,
    root.stats?.powerRanking,
    root.stats?.power_ranking,
    root.stats?.pr
  );

  const providerSource = clean(
    earnings.earnings_source ||
    earnings.earningsSource ||
    root.source_url ||
    root.sourceUrl ||
    identifiers.wiki_url ||
    identifiers.wikiUrl ||
    sourceUrl
  );

  return {
    requestedName,
    displayName,
    accountId,
    powerRanking,
    lifetimeEarnings,
    provider: "cito",
    sourceUrl: providerSource,
    raw: {
      parser: "cito-player-profile-v1",
      success: body?.success !== false,
      dataAvailable: body?.data_available ?? true,
      playerId: clean(root.player_id || root.playerId || identifiers.player_id || identifiers.playerId),
      slug: clean(root.slug || identifiers.slug),
      verifiedCompetitive: root.verified_competitive ?? root.verifiedCompetitive ?? null,
      identityConfidence: clean(root.identity_confidence || root.identityConfidence),
      earnings: lifetimeEarnings == null ? null : {
        total: lifetimeEarnings,
        currency: clean(earnings.earnings_currency || earnings.currency || "USD"),
        confidence: clean(earnings.earnings_confidence || earnings.confidence),
        lastVerified: clean(earnings.earnings_last_verified || earnings.lastVerified)
      }
    }
  };
}

async function responseJson(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderHttpError(
      response.status || 502,
      "Cito returned a non-JSON response."
    );
  }
}

export async function fetchCitoPlayer(player, options = {}) {
  const apiKey = clean(options.apiKey ?? config.enrichment.cito.apiKey);
  const baseUrl = String(options.baseUrl ?? config.enrichment.cito.baseUrl).replace(/\/+$/, "");
  const timeoutMs = Number(options.timeoutMs ?? config.enrichment.cito.requestTimeoutMs);
  const fetchImpl = options.fetchImpl || fetch;
  const requestsPerMinute = Number(options.requestsPerMinute ?? config.enrichment.cito.requestsPerMinute);

  if (!apiKey) {
    throw new ProviderHttpError(
      401,
      "CITO_API_KEY is missing. Add it to the Railway backend variables.",
      config.enrichment.blockedCooldownMinutes * 60000
    );
  }

  const requestedName = String(player?.displayName || "").trim();
  const accountId = String(player?.accountId || "").trim();
  if (!requestedName && !accountId) throw new Error("A Cito player identifier is required.");

  const identifiers = [...new Set([accountId, requestedName].filter(Boolean))];
  const attempts = [];

  for (const identifier of identifiers) {
    const sourceUrl = `${baseUrl}/fortnite/players/${encodeURIComponent(identifier)}`;
    if (!options.disableRateLimit) await waitForCitoRateSlot(requestsPerMinute);
    const response = await fetchImpl(sourceUrl, {
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
        "User-Agent": "MatchIntel-Backend/0.6.3"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await responseJson(response);
    attempts.push({ identifier, status: response.status, code: errorCode(body) || null });

    if (identifierNotFound(response.status, body)) continue;

    if (!response.ok || body?.success === false) {
      const status = statusFromBody(response.status, body);
      throw new ProviderHttpError(
        status,
        `Cito player lookup failed: ${errorMessage(body, `HTTP ${status}`)}`,
        retryAfterMilliseconds(response, body)
      );
    }

    const parsed = parseCitoPlayerResponse(body, requestedName || identifier, response.url || sourceUrl);
    return {
      ...parsed,
      accountId: parsed.accountId || accountId || null,
      raw: {
        ...parsed.raw,
        lookupIdentifier: identifier,
        lookupUsedAccountId: Boolean(accountId && identifier === accountId),
        attempts
      }
    };
  }

  return {
    requestedName,
    displayName: requestedName || accountId,
    accountId: accountId || null,
    powerRanking: null,
    lifetimeEarnings: null,
    provider: "cito",
    sourceUrl: identifiers.length
      ? `${baseUrl}/fortnite/players/${encodeURIComponent(identifiers.at(-1))}`
      : null,
    raw: {
      parser: "cito-player-profile-v1",
      dataAvailable: false,
      reason: "identifier_not_found",
      attempts
    }
  };
}
