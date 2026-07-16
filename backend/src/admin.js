import { query, tx } from "./db.js";
import { config } from "./config.js";
import { createLicenseKey, parseDuration, randomUuid, sha256 } from "./security.js";
import { getRuntimeSettings, setMaintenance, setVersionControl } from "./appSettings.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_SQL = "status='active' AND (expires_at IS NULL OR expires_at>NOW())";
const ALL_FEATURES = ["live_lobby", "enrichment", "history", "reports"];

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function planFrom(value) {
  const plan = clean(value, 20).toLowerCase();
  if (plan !== "trial" && plan !== "lifetime") {
    throw httpError(400, "MI-PLAN-INVALID", "Plan must be trial or lifetime.");
  }
  return plan;
}

function trialDaysFrom(value) {
  const days = Number(value ?? 3);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw httpError(400, "MI-TRIAL-DAYS", "Trial days must be a whole number from 1 to 30.");
  }
  return days;
}

function extensionDaysFrom(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw httpError(400, "MI-EXTENSION-DAYS", "Extension days must be a whole number from 1 to 3650.");
  }
  return days;
}

function bulkScopeFrom(value, allowed) {
  const scope = clean(value || allowed[0], 30).toLowerCase();
  if (!allowed.includes(scope)) {
    throw httpError(400, "MI-BULK-SCOPE", `Scope must be one of: ${allowed.join(", ")}.`);
  }
  return scope;
}

function deletionCondition(scope) {
  return {
    all: "TRUE",
    active: "status='active' AND (expires_at IS NULL OR expires_at>NOW())",
    revoked: "status='revoked'",
    expired: "expires_at IS NOT NULL AND expires_at<=NOW()",
    trial: "plan='trial'",
    lifetime: "plan='lifetime'"
  }[scope];
}

function extensionCondition(scope) {
  return {
    all: "plan='trial' AND expires_at IS NOT NULL",
    active: "plan='trial' AND status='active' AND expires_at>NOW()",
    revoked: "plan='trial' AND status='revoked'",
    expired: "plan='trial' AND expires_at IS NOT NULL AND expires_at<=NOW()"
  }[scope];
}

function discordIdFrom(value) {
  const id = clean(value, 40).replace(/[<@!>]/g, "");
  if (!/^\d{15,25}$/.test(id)) {
    throw httpError(400, "MI-DISCORD-ID", "A valid Discord user ID is required.");
  }
  return id;
}

function serializeLicense(row) {
  if (!row) return null;
  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    plan: row.plan,
    status: row.status,
    expiresAt: row.expires_at,
    maxDevices: row.max_devices,
    features: row.features || [],
    note: row.note || "",
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    issuedByDiscordId: row.issued_by_discord_id,
    revokedReason: row.revoked_reason,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deviceCount: Number(row.device_count ?? 0),
    isUsable: row.status === "active" && (!row.expires_at || new Date(row.expires_at) > new Date())
  };
}

async function audit(action, actor, target, details = {}, executor = query) {
  await executor(
    "INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)",
    [randomUuid(), action, clean(actor || "admin", 200), clean(target, 300), JSON.stringify(details)]
  );
}

function refWhere(ref) {
  const value = clean(ref, 200);
  if (!value) throw httpError(400, "MI-LICENSE-REF", "A license ID, key, or key prefix is required.");
  if (UUID_RE.test(value)) {
    return { sql: "l.id=$1::uuid", params: [value] };
  }
  if (/^MI-/i.test(value)) {
    const upper = value.toUpperCase();
    return {
      sql: "(l.key_hash=$1 OR l.key_prefix ILIKE $2)",
      params: [sha256(upper), `${upper}%`]
    };
  }
  return { sql: "l.key_prefix ILIKE $1", params: [`${value}%`] };
}

async function resolveLicense(executor, ref, { forUpdate = false } = {}) {
  const where = refWhere(ref);
  const result = await executor(
    `SELECT l.*,
      (SELECT COUNT(*)::int FROM devices d WHERE d.license_id=l.id) AS device_count
     FROM licenses l
     WHERE ${where.sql}
     ORDER BY l.created_at DESC
     LIMIT 2${forUpdate ? " FOR UPDATE OF l" : ""}`,
    where.params
  );
  if (!result.rowCount) throw httpError(404, "MI-LICENSE-NOT-FOUND", "License not found.");
  if (result.rowCount > 1) throw httpError(409, "MI-LICENSE-AMBIGUOUS", "That key prefix matches multiple licenses. Use the license UUID.");
  return result.rows[0];
}

function sendError(res, error, fallbackCode = "MI-ADMIN") {
  res.status(error.status || 400).json({ code: error.code || fallbackCode, message: error.message });
}

export async function create(req, res) {
  try {
    const plan = planFrom(req.body?.plan);
    const discordUserId = discordIdFrom(req.body?.discordUserId);
    const discordUsername = clean(req.body?.discordUsername, 100) || discordUserId;
    const issuedByDiscordId = discordIdFrom(req.body?.issuedByDiscordId || req.headers["x-admin-actor"]);
    const trialDays = plan === "trial" ? trialDaysFrom(req.body?.trialDays) : null;
    const expiresAt = plan === "trial" ? parseDuration(`${trialDays}d`) : null;
    const maxDevices = Math.max(1, Math.min(25, Number(req.body?.maxDevices || 1)));
    const features = Array.isArray(req.body?.features)
      ? req.body.features.map(String).slice(0, 40)
      : ALL_FEATURES;
    const note = clean(req.body?.note, 500);
    const key = createLicenseKey();
    const id = randomUuid();

    await tx(async client => {
      await client.query(
        `INSERT INTO licenses(
          id,key_hash,key_prefix,plan,expires_at,max_devices,features,note,
          discord_user_id,discord_username,issued_by_discord_id
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id, sha256(key), key.slice(0, 12), plan, expiresAt, maxDevices,
          JSON.stringify(features), note, discordUserId, discordUsername, issuedByDiscordId
        ]
      );
      await audit("license.create", issuedByDiscordId, id, {
        plan, trialDays, maxDevices, discordUserId, discordUsername
      }, client.query.bind(client));
    });

    res.status(201).json({
      licenseKey: key,
      license: serializeLicense({
        id,
        key_prefix: key.slice(0, 12),
        plan,
        status: "active",
        expires_at: expiresAt,
        max_devices: maxDevices,
        features,
        note,
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        issued_by_discord_id: issuedByDiscordId,
        created_at: new Date(),
        updated_at: new Date(),
        device_count: 0
      })
    });
  } catch (error) {
    sendError(res, error, "MI-ADMIN-LICENSE");
  }
}

export async function find(req, res) {
  try {
    const q = clean(req.query.q, 200);
    const status = clean(req.query.status, 20).toLowerCase();
    const plan = clean(req.query.plan, 20).toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 100)));
    const result = await query(
      `SELECT l.*,
        (SELECT COUNT(*)::int FROM devices d WHERE d.license_id=l.id) AS device_count
       FROM licenses l
       WHERE ($1='' OR l.id::text ILIKE '%'||$1||'%' OR l.key_prefix ILIKE '%'||$1||'%'
          OR COALESCE(l.note,'') ILIKE '%'||$1||'%'
          OR COALESCE(l.discord_user_id,'') ILIKE '%'||$1||'%'
          OR COALESCE(l.discord_username,'') ILIKE '%'||$1||'%')
         AND ($2='' OR l.status=$2)
         AND ($3='' OR l.plan=$3)
       ORDER BY l.created_at DESC
       LIMIT $4`,
      [q, status, plan, limit]
    );
    res.json({ licenses: result.rows.map(serializeLicense) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function one(req, res) {
  try {
    res.json({ license: serializeLicense(await resolveLicense(query, req.params.ref)) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function userLicenses(req, res) {
  try {
    const userId = discordIdFrom(req.params.discordUserId);
    const result = await query(
      `SELECT l.*,
        (SELECT COUNT(*)::int FROM devices d WHERE d.license_id=l.id) AS device_count
       FROM licenses l
       WHERE l.discord_user_id=$1
       ORDER BY l.created_at DESC`,
      [userId]
    );
    res.json({ discordUserId: userId, licenses: result.rows.map(serializeLicense) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function revoke(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const reason = clean(req.body?.reason, 300) || "Revoked by staff";
    const license = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      const result = await client.query(
        `UPDATE licenses
         SET status='revoked',revoked_reason=$2,revoked_at=NOW(),updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [current.id, reason]
      );
      await client.query(
        "UPDATE refresh_tokens SET revoked_at=NOW() WHERE license_id=$1 AND revoked_at IS NULL",
        [current.id]
      );
      await audit("license.revoke", actor, current.id, { reason, discordUserId: current.discord_user_id }, client.query.bind(client));
      return result.rows[0];
    });
    res.json({ license: serializeLicense(license) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function revokeUser(req, res) {
  try {
    const userId = discordIdFrom(req.params.discordUserId);
    const actor = req.headers["x-admin-actor"] || "admin";
    const reason = clean(req.body?.reason, 300) || "Discord account revoked by staff";
    const result = await tx(async client => {
      const changed = await client.query(
        `UPDATE licenses SET status='revoked',revoked_reason=$2,revoked_at=NOW(),updated_at=NOW()
         WHERE discord_user_id=$1 AND status<>'revoked' RETURNING id`,
        [userId, reason]
      );
      await client.query(
        `UPDATE refresh_tokens SET revoked_at=NOW()
         WHERE license_id IN (SELECT id FROM licenses WHERE discord_user_id=$1)
           AND revoked_at IS NULL`,
        [userId]
      );
      await audit("license.revoke_user", actor, userId, { reason, licensesRevoked: changed.rowCount }, client.query.bind(client));
      return changed.rowCount;
    });
    res.json({ ok: true, discordUserId: userId, licensesRevoked: result });
  } catch (error) {
    sendError(res, error);
  }
}

export async function restore(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const license = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      if (current.expires_at && new Date(current.expires_at) <= new Date()) {
        throw httpError(409, "MI-LICENSE-EXPIRED", "This trial has expired. Convert it to lifetime instead of restoring it.");
      }
      const result = await client.query(
        `UPDATE licenses SET status='active',revoked_reason=NULL,revoked_at=NULL,updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [current.id]
      );
      await audit("license.restore", actor, current.id, {}, client.query.bind(client));
      return result.rows[0];
    });
    res.json({ license: serializeLicense(license) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function reset(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const result = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      const devices = await client.query("DELETE FROM devices WHERE license_id=$1 RETURNING id", [current.id]);
      const tokens = await client.query(
        "UPDATE refresh_tokens SET revoked_at=NOW() WHERE license_id=$1 AND revoked_at IS NULL RETURNING id",
        [current.id]
      );
      await audit("license.reset_devices", actor, current.id, {
        devicesRemoved: devices.rowCount,
        refreshTokensRevoked: tokens.rowCount,
        discordUserId: current.discord_user_id
      }, client.query.bind(client));
      return {
        license: serializeLicense({ ...current, device_count: 0 }),
        devicesRemoved: devices.rowCount,
        refreshTokensRevoked: tokens.rowCount
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}

export async function resetUser(req, res) {
  try {
    const userId = discordIdFrom(req.params.discordUserId);
    const actor = req.headers["x-admin-actor"] || "admin";
    const result = await tx(async client => {
      const licenses = await client.query("SELECT id FROM licenses WHERE discord_user_id=$1", [userId]);
      if (!licenses.rowCount) throw httpError(404, "MI-USER-NO-LICENSES", "No licenses are linked to that Discord account.");
      const devices = await client.query(
        "DELETE FROM devices WHERE license_id IN (SELECT id FROM licenses WHERE discord_user_id=$1) RETURNING id",
        [userId]
      );
      const tokens = await client.query(
        `UPDATE refresh_tokens SET revoked_at=NOW()
         WHERE license_id IN (SELECT id FROM licenses WHERE discord_user_id=$1)
           AND revoked_at IS NULL RETURNING id`,
        [userId]
      );
      await audit("license.reset_user_devices", actor, userId, {
        licensesAffected: licenses.rowCount,
        devicesRemoved: devices.rowCount,
        refreshTokensRevoked: tokens.rowCount
      }, client.query.bind(client));
      return {
        licensesAffected: licenses.rowCount,
        devicesRemoved: devices.rowCount,
        refreshTokensRevoked: tokens.rowCount
      };
    });
    res.json({ ok: true, discordUserId: userId, ...result });
  } catch (error) {
    sendError(res, error);
  }
}

export async function devices(req, res) {
  try {
    const license = await resolveLicense(query, req.params.ref);
    const result = await query(
      `SELECT id,device_hash,device_name,first_seen_at,last_seen_at
       FROM devices WHERE license_id=$1 ORDER BY last_seen_at DESC`,
      [license.id]
    );
    res.json({
      license: serializeLicense(license),
      devices: result.rows.map(row => ({
        id: row.id,
        hash: `${row.device_hash.slice(0, 8)}…${row.device_hash.slice(-4)}`,
        name: row.device_name || "Unknown device",
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at
      }))
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function convertLifetime(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const license = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      const result = await client.query(
        `UPDATE licenses
         SET plan='lifetime',expires_at=NULL,status='active',revoked_reason=NULL,revoked_at=NULL,
             plan_changed_at=NOW(),updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [current.id]
      );
      await audit("license.convert_lifetime", actor, current.id, {
        previousPlan: current.plan,
        discordUserId: current.discord_user_id
      }, client.query.bind(client));
      return result.rows[0];
    });
    res.json({ license: serializeLicense(license) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function transfer(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const discordUserId = discordIdFrom(req.body?.discordUserId);
    const discordUsername = clean(req.body?.discordUsername, 100) || discordUserId;
    const license = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      const result = await client.query(
        `UPDATE licenses SET discord_user_id=$2,discord_username=$3,updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [current.id, discordUserId, discordUsername]
      );
      await audit("license.transfer", actor, current.id, {
        fromDiscordUserId: current.discord_user_id,
        toDiscordUserId: discordUserId,
        toDiscordUsername: discordUsername
      }, client.query.bind(client));
      return result.rows[0];
    });
    res.json({ license: serializeLicense(license) });
  } catch (error) {
    sendError(res, error);
  }
}


export async function deleteLicense(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const result = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      const [devices, tokens, accesses] = await Promise.all([
        client.query("SELECT COUNT(*)::int count FROM devices WHERE license_id=$1", [current.id]),
        client.query("SELECT COUNT(*)::int count FROM refresh_tokens WHERE license_id=$1", [current.id]),
        client.query("SELECT COUNT(*)::int count FROM session_access WHERE license_id=$1", [current.id])
      ]);
      await client.query("DELETE FROM licenses WHERE id=$1", [current.id]);
      await audit("license.delete", actor, current.id, {
        keyPrefix: current.key_prefix,
        plan: current.plan,
        status: current.status,
        discordUserId: current.discord_user_id,
        devicesDeleted: devices.rows[0].count,
        refreshTokensDeleted: tokens.rows[0].count,
        sessionAccessDeleted: accesses.rows[0].count
      }, client.query.bind(client));
      return {
        id: current.id,
        keyPrefix: current.key_prefix,
        discordUserId: current.discord_user_id,
        devicesDeleted: devices.rows[0].count,
        refreshTokensDeleted: tokens.rows[0].count,
        sessionAccessDeleted: accesses.rows[0].count
      };
    });
    res.json({ ok: true, deleted: result });
  } catch (error) {
    sendError(res, error, "MI-LICENSE-DELETE");
  }
}

export async function deleteBulk(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const confirmation = clean(req.body?.confirmation, 100);
    if (confirmation !== "DELETE ALL KEYS") {
      throw httpError(400, "MI-BULK-CONFIRM", "Confirmation must exactly equal DELETE ALL KEYS.");
    }
    const scope = bulkScopeFrom(req.body?.scope || "all", ["all", "active", "revoked", "expired", "trial", "lifetime"]);
    const condition = deletionCondition(scope);
    const result = await tx(async client => {
      const counts = await client.query(
        `SELECT COUNT(*)::int licenses,
          COALESCE((SELECT COUNT(*)::int FROM devices d WHERE d.license_id IN (SELECT id FROM licenses WHERE ${condition})),0)::int devices,
          COALESCE((SELECT COUNT(*)::int FROM refresh_tokens r WHERE r.license_id IN (SELECT id FROM licenses WHERE ${condition})),0)::int tokens,
          COALESCE((SELECT COUNT(*)::int FROM session_access s WHERE s.license_id IN (SELECT id FROM licenses WHERE ${condition})),0)::int accesses
         FROM licenses WHERE ${condition}`
      );
      const deleted = await client.query(`DELETE FROM licenses WHERE ${condition} RETURNING id`);
      await audit("license.delete_bulk", actor, `scope:${scope}`, {
        scope,
        licensesDeleted: deleted.rowCount,
        devicesDeleted: counts.rows[0].devices,
        refreshTokensDeleted: counts.rows[0].tokens,
        sessionAccessDeleted: counts.rows[0].accesses
      }, client.query.bind(client));
      return {
        scope,
        licensesDeleted: deleted.rowCount,
        devicesDeleted: counts.rows[0].devices,
        refreshTokensDeleted: counts.rows[0].tokens,
        sessionAccessDeleted: counts.rows[0].accesses
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error, "MI-LICENSE-BULK-DELETE");
  }
}

export async function extendLicense(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const days = extensionDaysFrom(req.body?.days);
    const license = await tx(async client => {
      const current = await resolveLicense(client.query.bind(client), req.params.ref, { forUpdate: true });
      if (current.plan !== "trial" || !current.expires_at) {
        throw httpError(409, "MI-LIFETIME-NO-EXPIRY", "Lifetime keys do not expire and cannot be extended.");
      }
      const result = await client.query(
        `UPDATE licenses
         SET expires_at=GREATEST(expires_at,NOW()) + ($2::int * INTERVAL '1 day'),updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [current.id, days]
      );
      await audit("license.extend", actor, current.id, {
        days,
        previousExpiresAt: current.expires_at,
        newExpiresAt: result.rows[0].expires_at,
        discordUserId: current.discord_user_id
      }, client.query.bind(client));
      return result.rows[0];
    });
    res.json({ ok: true, days, license: serializeLicense(license) });
  } catch (error) {
    sendError(res, error, "MI-LICENSE-EXTEND");
  }
}

export async function extendBulk(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const days = extensionDaysFrom(req.body?.days);
    const scope = bulkScopeFrom(req.body?.scope || "active", ["all", "active", "revoked", "expired"]);
    const condition = extensionCondition(scope);
    const result = await tx(async client => {
      const before = await client.query(
        `SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE expires_at<=NOW())::int expired,
          COUNT(*) FILTER (WHERE status='revoked')::int revoked
         FROM licenses WHERE ${condition}`
      );
      const changed = await client.query(
        `UPDATE licenses
         SET expires_at=GREATEST(expires_at,NOW()) + ($1::int * INTERVAL '1 day'),updated_at=NOW()
         WHERE ${condition}
         RETURNING id`,
        [days]
      );
      await audit("license.extend_bulk", actor, `scope:${scope}`, {
        scope,
        days,
        licensesExtended: changed.rowCount,
        previouslyExpired: before.rows[0].expired,
        revokedIncluded: before.rows[0].revoked
      }, client.query.bind(client));
      return {
        scope,
        days,
        licensesExtended: changed.rowCount,
        previouslyExpired: before.rows[0].expired,
        revokedIncluded: before.rows[0].revoked
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error, "MI-LICENSE-BULK-EXTEND");
  }
}

export async function versionStatus(req, res) {
  try {
    const settings = await getRuntimeSettings({ fresh: true });
    res.json({ version: settings.version });
  } catch (error) {
    sendError(res, error, "MI-VERSION-STATUS");
  }
}

export async function updateVersion(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const previous = (await getRuntimeSettings({ fresh: true })).version;
    const version = await setVersionControl({
      minimumVersion: req.body?.minimumVersion,
      latestVersion: req.body?.latestVersion,
      forceUpdate: req.body?.forceUpdate,
      updateUrl: req.body?.updateUrl,
      message: req.body?.message
    }, actor);
    await audit("system.version_update", actor, "version_control", { previous, version });
    res.json({ ok: true, version });
  } catch (error) {
    sendError(res, error, "MI-VERSION-UPDATE");
  }
}

export async function maintenance(req, res) {
  try {
    const actor = req.headers["x-admin-actor"] || "admin";
    const maintenance = await setMaintenance({
      enabled: !!req.body?.enabled,
      message: req.body?.message || config.maintenanceMessage
    }, actor);
    await audit("system.maintenance", actor, "maintenance", maintenance);
    res.json({
      ...maintenance,
      note: "This change is live immediately and does not require a Railway redeploy."
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function auditLog(req, res) {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 15)));
    const action = clean(req.query.action, 100);
    const result = await query(
      `SELECT id,action,actor,target,details,created_at
       FROM audit_logs
       WHERE ($1='' OR action ILIKE '%'||$1||'%')
       ORDER BY created_at DESC LIMIT $2`,
      [action, limit]
    );
    res.json({ entries: result.rows });
  } catch (error) {
    sendError(res, error);
  }
}

export async function status(req, res) {
  try {
    const [active, total, devicesCount, sessions, byPlan, linked, revoked, runtime] = await Promise.all([
      query(`SELECT COUNT(*)::int count FROM licenses WHERE ${ACTIVE_SQL}`),
      query("SELECT COUNT(*)::int count FROM licenses"),
      query("SELECT COUNT(*)::int count FROM devices"),
      query("SELECT COUNT(*)::int count FROM sessions"),
      query(`SELECT plan,COUNT(*)::int count FROM licenses WHERE ${ACTIVE_SQL} GROUP BY plan`),
      query("SELECT COUNT(*)::int count FROM licenses WHERE discord_user_id IS NOT NULL"),
      query("SELECT COUNT(*)::int count FROM licenses WHERE status='revoked'"),
      getRuntimeSettings()
    ]);
    const plans = Object.fromEntries(byPlan.rows.map(row => [row.plan, row.count]));
    res.json({
      status: "ok",
      totalLicenses: total.rows[0].count,
      activeLicenses: active.rows[0].count,
      activeTrial: plans.trial || 0,
      activeLifetime: plans.lifetime || 0,
      linkedLicenses: linked.rows[0].count,
      revokedLicenses: revoked.rows[0].count,
      devices: devicesCount.rows[0].count,
      sessions: sessions.rows[0].count,
      version: runtime.version.latestVersion,
      minimumVersion: runtime.version.minimumVersion,
      forceUpdate: runtime.version.forceUpdate,
      maintenance: runtime.maintenance.enabled
    });
  } catch (error) {
    sendError(res, error);
  }
}

