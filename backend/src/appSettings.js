import { query } from "./db.js";
import { config } from "./config.js";
import { compareVersions, isVersionOutdated, normalizeVersion, requiredClientVersion, updatePayload } from "./versionControl.js";
const CACHE_MS = 3000;
const cache = { value: null, expiresAt: 0 };

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}


function defaults() {
  return {
    maintenance: {
      enabled: config.maintenanceMode,
      message: config.maintenanceMessage
    },
    version: {
      minimumVersion: normalizeVersion(config.minimumAppVersion, "0.2.0"),
      latestVersion: normalizeVersion(config.latestAppVersion, config.minimumAppVersion),
      forceUpdate: config.forceUpdate,
      updateUrl: config.updateUrl,
      message: config.updateMessage,
      updatedBy: null,
      updatedAt: null
    }
  };
}

function mergeSettings(rows) {
  const value = defaults();
  let databaseVersionFound = false;
  for (const row of rows) {
    const stored = row.value && typeof row.value === "object" ? row.value : {};
    if (row.key === "maintenance") {
      value.maintenance.enabled = Boolean(stored.enabled);
      value.maintenance.message = clean(stored.message || value.maintenance.message, 500);
    }
    if (row.key === "version_control") {
      databaseVersionFound = true;
      value.version.minimumVersion = normalizeVersion(stored.minimumVersion, value.version.minimumVersion);
      value.version.latestVersion = normalizeVersion(stored.latestVersion, value.version.latestVersion);
      value.version.forceUpdate = Boolean(stored.forceUpdate);
      value.version.updateUrl = clean(stored.updateUrl, 1000);
      value.version.message = clean(stored.message || value.version.message, 500);
      value.version.updatedBy = clean(stored.updatedBy, 200) || null;
      value.version.updatedAt = stored.updatedAt || null;
    }
  }

  // Explicit Railway variables are authoritative. Older backend builds allowed a
  // saved app_settings row to silently override MINIMUM_APP_VERSION and
  // LATEST_APP_VERSION, which made changing Railway variables appear to do
  // nothing. When a variable is present, use it after the database merge.
  const env = config.versionEnvironment;
  const environmentOverride = env.minimumExplicit || env.latestExplicit || env.forceExplicit ||
    env.updateUrlExplicit || env.updateMessageExplicit;
  if (env.minimumExplicit) value.version.minimumVersion = normalizeVersion(config.minimumAppVersion, value.version.minimumVersion);
  if (env.latestExplicit) value.version.latestVersion = normalizeVersion(config.latestAppVersion, value.version.latestVersion);
  if (env.forceExplicit) value.version.forceUpdate = Boolean(config.forceUpdate);
  if (env.updateUrlExplicit) value.version.updateUrl = clean(config.updateUrl, 1000);
  if (env.updateMessageExplicit) value.version.message = clean(config.updateMessage, 500);

  if (compareVersions(value.version.latestVersion, value.version.minimumVersion) < 0) {
    value.version.latestVersion = value.version.minimumVersion;
  }
  value.version.requiredVersion = requiredClientVersion(value.version);
  value.version.source = environmentOverride ? "environment" : databaseVersionFound ? "database" : "defaults";
  return value;
}

export function clearSettingsCache() {
  cache.value = null;
  cache.expiresAt = 0;
}

export async function getRuntimeSettings({ fresh = false } = {}) {
  if (!fresh && cache.value && cache.expiresAt > Date.now()) return cache.value;
  const result = await query(
    "SELECT key,value FROM app_settings WHERE key IN ('maintenance','version_control')"
  );
  cache.value = mergeSettings(result.rows);
  cache.expiresAt = Date.now() + CACHE_MS;
  return cache.value;
}

export async function setMaintenance({ enabled, message }, actor = "admin") {
  const value = {
    enabled: Boolean(enabled),
    message: clean(message || config.maintenanceMessage, 500),
    updatedBy: clean(actor, 200),
    updatedAt: new Date().toISOString()
  };
  await query(
    `INSERT INTO app_settings(key,value) VALUES('maintenance',$1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
    [JSON.stringify(value)]
  );
  clearSettingsCache();
  return (await getRuntimeSettings({ fresh: true })).maintenance;
}

export async function setVersionControl(input, actor = "admin") {
  const current = (await getRuntimeSettings()).version;
  const minimumVersion = normalizeVersion(input.minimumVersion, current.minimumVersion);
  const latestVersion = normalizeVersion(input.latestVersion || minimumVersion, current.latestVersion);
  if (compareVersions(latestVersion, minimumVersion) < 0) {
    const error = new Error("Latest version cannot be lower than the minimum version.");
    error.status = 400;
    error.code = "MI-VERSION-RANGE";
    throw error;
  }

  const value = {
    minimumVersion,
    latestVersion,
    forceUpdate: input.forceUpdate == null ? current.forceUpdate : Boolean(input.forceUpdate),
    updateUrl: clean(input.updateUrl ?? current.updateUrl, 1000),
    message: clean(input.message || current.message, 500),
    updatedBy: clean(actor, 200),
    updatedAt: new Date().toISOString()
  };

  await query(
    `INSERT INTO app_settings(key,value) VALUES('version_control',$1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
    [JSON.stringify(value)]
  );
  clearSettingsCache();
  return (await getRuntimeSettings({ fresh: true })).version;
}

export { isVersionOutdated, requiredClientVersion, updatePayload };

export async function requireClientVersion(req, res, next) {
  try {
    const settings = await getRuntimeSettings();
    const appVersion = req.headers["x-matchintel-version"];
    if (isVersionOutdated(appVersion, settings.version, { allowMissing: false })) {
      return res.status(426).json(updatePayload(settings.version));
    }
    req.runtimeSettings = settings;
    next();
  } catch (error) {
    next(error);
  }
}
