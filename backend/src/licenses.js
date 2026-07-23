import { tx } from "./db.js";
import { config } from "./config.js";
import { getRuntimeSettings, isVersionOutdated, updatePayload } from "./appSettings.js";
import { hashDevice, randomToken, randomUuid, sha256, signAccess } from "./security.js";

const pub = license => ({
  id: license.id,
  plan: license.plan,
  isFreeTrial: Boolean(license.is_free_trial),
  status: license.status,
  expiresAt: license.expires_at,
  maxDevices: license.max_devices,
  features: license.features || []
});

async function tokens(client, license, deviceHash) {
  const accessToken = signAccess(license, deviceHash);
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 86400000);
  await client.query(
    "INSERT INTO refresh_tokens(id,license_id,device_hash,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)",
    [randomUuid(), license.id, deviceHash, sha256(refreshToken), expiresAt]
  );
  return { accessToken, refreshToken };
}


export async function enforceFreeTrialDevice(client, license, deviceHash) {
  if (!license.is_free_trial) return;

  // Lock both the device and license in a stable order. This closes concurrent
  // activation races without ever storing the raw Device ID.
  const locks = [
    `free-trial-device:${deviceHash}`,
    `free-trial-license:${license.id}`
  ].sort();
  for (const lock of locks) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lock]);
  }

  const byDevice = await client.query(
    "SELECT first_license_id FROM free_trial_device_usage WHERE device_hash=$1 FOR UPDATE",
    [deviceHash]
  );
  if (byDevice.rowCount && String(byDevice.rows[0].first_license_id) !== String(license.id)) {
    throw Object.assign(
      new Error("This device has already used a MatchIntel free trial."),
      { status: 403, code: "MI-FREE-TRIAL-DEVICE-USED" }
    );
  }

  const byLicense = await client.query(
    "SELECT device_hash FROM free_trial_device_usage WHERE first_license_id=$1 FOR UPDATE",
    [license.id]
  );
  if (byLicense.rowCount && byLicense.rows[0].device_hash !== deviceHash) {
    throw Object.assign(
      new Error("This free-trial key has already been activated on another device."),
      { status: 403, code: "MI-FREE-TRIAL-KEY-BOUND" }
    );
  }

  if (!byDevice.rowCount && !byLicense.rowCount) {
    await client.query(
      `INSERT INTO free_trial_device_usage(
        device_hash,first_license_id,first_discord_user_id
      ) VALUES($1,$2,$3)`,
      [deviceHash, license.id, license.discord_user_id || null]
    );
  } else {
    await client.query(
      "UPDATE free_trial_device_usage SET last_seen_at=NOW() WHERE device_hash=$1",
      [deviceHash]
    );
  }
}

async function enforceRuntime(appVersion, res, { allowMissingVersion = false } = {}) {
  const settings = await getRuntimeSettings();
  if (settings.maintenance.enabled) {
    res.status(503).json({
      code: "MI-MAINTENANCE",
      message: settings.maintenance.message
    });
    return null;
  }
  if (isVersionOutdated(appVersion, settings.version, {
    allowMissing: allowMissingVersion
  })) {
    res.status(426).json(updatePayload(settings.version));
    return null;
  }
  return settings;
}

export async function activate(req, res) {
  const { licenseKey, deviceId, deviceName, appVersion } = req.body || {};
  if (!licenseKey || !deviceId) {
    return res.status(400).json({
      code: "MI-ACTIVATION-INVALID",
      message: "License key and device ID are required."
    });
  }

  try {
    if (!await enforceRuntime(appVersion, res)) return;
    const answer = await tx(async client => {
      const result = await client.query(
        "SELECT * FROM licenses WHERE key_hash=$1 FOR UPDATE",
        [sha256(String(licenseKey).trim().toUpperCase())]
      );
      const license = result.rows[0];
      if (!license) throw Object.assign(new Error("The MatchIntel key is invalid."), { status: 401, code: "MI-KEY-INVALID" });
      if (license.status !== "active") throw Object.assign(new Error(`This key is ${license.status}.`), { status: 403, code: "MI-KEY-INACTIVE" });
      if (license.expires_at && new Date(license.expires_at) <= new Date()) {
        throw Object.assign(new Error("This key has expired."), { status: 403, code: "MI-KEY-EXPIRED" });
      }

      const deviceHash = hashDevice(deviceId);
      await enforceFreeTrialDevice(client, license, deviceHash);
      const existing = await client.query(
        "SELECT 1 FROM devices WHERE license_id=$1 AND device_hash=$2",
        [license.id, deviceHash]
      );
      if (!existing.rowCount) {
        const count = await client.query(
          "SELECT COUNT(*)::int count FROM devices WHERE license_id=$1",
          [license.id]
        );
        if (count.rows[0].count >= license.max_devices) {
          throw Object.assign(new Error("This key has reached its device limit."), { status: 403, code: "MI-DEVICE-LIMIT" });
        }
        await client.query(
          "INSERT INTO devices(id,license_id,device_hash,device_name) VALUES($1,$2,$3,$4)",
          [randomUuid(), license.id, deviceHash, String(deviceName || "").slice(0, 160)]
        );
      } else {
        await client.query(
          "UPDATE devices SET last_seen_at=NOW(),device_name=COALESCE(NULLIF($3,''),device_name) WHERE license_id=$1 AND device_hash=$2",
          [license.id, deviceHash, String(deviceName || "").slice(0, 160)]
        );
      }
      return { ...(await tokens(client, license, deviceHash)), license: pub(license) };
    });
    res.json(answer);
  } catch (error) {
    res.status(error.status || 500).json({ code: error.code || "MI-ACTIVATION-FAILED", message: error.message });
  }
}

export async function refresh(req, res) {
  const { refreshToken, deviceId, appVersion } = req.body || {};
  if (!refreshToken || !deviceId) {
    return res.status(400).json({ code: "MI-REFRESH-INVALID", message: "Refresh token and device ID are required." });
  }

  try {
    if (!await enforceRuntime(appVersion, res, { allowMissingVersion: true })) return;
    const answer = await tx(async client => {
      const result = await client.query(
        `SELECT rt.id token_id,rt.license_id,rt.device_hash,rt.expires_at token_expires,l.*
         FROM refresh_tokens rt JOIN licenses l ON l.id=rt.license_id
         WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL FOR UPDATE`,
        [sha256(refreshToken)]
      );
      const row = result.rows[0];
      if (!row || new Date(row.token_expires) <= new Date() || row.status !== "active") {
        throw Object.assign(new Error("The refresh token is invalid or expired."), { status: 401, code: "MI-REFRESH-EXPIRED" });
      }
      if (row.expires_at && new Date(row.expires_at) <= new Date()) {
        throw Object.assign(new Error("This license has expired."), { status: 401, code: "MI-LICENSE-EXPIRED" });
      }
      const deviceHash = hashDevice(deviceId);
      if (deviceHash !== row.device_hash) {
        throw Object.assign(new Error("The refresh token belongs to another device."), { status: 401, code: "MI-REFRESH-DEVICE" });
      }
      await client.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1", [row.token_id]);
      return { ...(await tokens(client, row, deviceHash)), license: pub(row) };
    });
    res.json(answer);
  } catch (error) {
    res.status(error.status || 500).json({ code: error.code || "MI-REFRESH-FAILED", message: error.message });
  }
}

export const status = (req, res) => res.json({ license: pub(req.auth.license) });
