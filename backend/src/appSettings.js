import { query } from "./db.js";
import { config } from "./config.js";
import { compareVersions } from "./security.js";

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CACHE_MS = 3000;
const cache = { value: null, expiresAt: 0 };

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeVersion(value, fallback) {
  const version = clean(value || fallback, 50);
  if (!VERSION_RE.test(version)) {
    const error = new Error("Versions must look like 0.3.9 or 1.0.0-beta.1.");
    error.status = 400;
    error.code = "MI-VERSION-INVALID";
    throw error;
  }
  return version;
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
      forceUpdate: false,
      updateUrl: "",
      message: "A newer MatchIntel version is required before you can continue.",
      updatedBy: null,
      updatedAt: null
    }
  };
}

function mergeSettings(rows) {
  const value = defaults();
  for (const row of rows) {
    const stored = row.value && typeof row.value === "object" ? row.value : {};
    if (row.key === "maintenance") {
      value.maintenance.enabled = Boolean(stored.enabled);
      value.maintenance.message = clean(stored.message || value.maintenance.message, 500);
    }
    if (row.key === "version_control") {
      value.version.minimumVersion = normalizeVersion(stored.minimumVersion, value.version.minimumVersion);
      value.version.latestVersion = normalizeVersion(stored.latestVersion, value.version.latestVersion);
      value.version.forceUpdate = Boolean(stored.forceUpdate);
      value.version.updateUrl = clean(stored.updateUrl, 1000);
      value.version.message = clean(stored.message || value.version.message, 500);
      value.version.updatedBy = clean(stored.updatedBy, 200) || null;
      value.version.updatedAt = stored.updatedAt || null;
    }
  }
  if (compareVersions(value.version.latestVersion, value.version.minimumVersion) < 0) {
    value.version.latestVersion = value.version.minimumVersion;
  }
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

export function updatePayload(version) {
  return {
    code: "MI-UPDATE-REQUIRED",
    message: version.message || `MatchIntel ${version.minimumVersion} or newer is required.`,
    minimumVersion: version.minimumVersion,
    latestVersion: version.latestVersion,
    updateUrl: version.updateUrl || "",
    forceUpdate: version.forceUpdate
  };
}

export function isVersionOutdated(appVersion, version, { allowMissing = false } = {}) {
  if (!version.forceUpdate) return false;
  const supplied = clean(appVersion, 50);
  if (!supplied) return !allowMissing;
  if (!VERSION_RE.test(supplied)) return true;
  return compareVersions(supplied, version.minimumVersion) < 0;
}

export async function requireClientVersion(req, res, next) {
  try {
    const settings = await getRuntimeSettings();
    const appVersion = req.headers["x-matchintel-version"];
    if (isVersionOutdated(appVersion, settings.version, { allowMissing: !settings.version.forceUpdate })) {
      return res.status(426).json(updatePayload(settings.version));
    }
    req.runtimeSettings = settings;
    next();
  } catch (error) {
    next(error);
  }
}
