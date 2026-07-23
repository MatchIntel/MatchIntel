export function compareVersions(a, b) {
  const parts = value => String(value || "0").split(/[+-]/)[0].split(".").map(x => Number(x) || 0);
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index] || 0;
    const y = right[index] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function cleanVersionValue(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeVersion(value, fallback) {
  const version = cleanVersionValue(value || fallback, 50);
  if (!VERSION_RE.test(version)) {
    const error = new Error("Versions must look like 0.3.9 or 1.0.0-beta.1.");
    error.status = 400;
    error.code = "MI-VERSION-INVALID";
    throw error;
  }
  return version;
}

export function requiredClientVersion(version) {
  const minimum = normalizeVersion(version?.minimumVersion, "0.0.0");
  const latest = normalizeVersion(version?.latestVersion, minimum);
  return version?.forceUpdate && compareVersions(latest, minimum) > 0 ? latest : minimum;
}

export function updatePayload(version) {
  const requiredVersion = requiredClientVersion(version);
  return {
    code: "MI-UPDATE-REQUIRED",
    message: version.message || `MatchIntel ${requiredVersion} or newer is required.`,
    minimumVersion: version.minimumVersion,
    latestVersion: version.latestVersion,
    requiredVersion,
    updateUrl: version.updateUrl || "",
    forceUpdate: Boolean(version.forceUpdate)
  };
}

export function isVersionOutdated(appVersion, version, { allowMissing = false } = {}) {
  const supplied = cleanVersionValue(appVersion, 50);
  if (!supplied) return !allowMissing;
  if (!VERSION_RE.test(supplied)) return true;
  return compareVersions(supplied, requiredClientVersion(version)) < 0;
}
