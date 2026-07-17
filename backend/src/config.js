function text(name, fallback = "") {
  const value = process.env[name];
  return value == null ? fallback : String(value).trim();
}

function number(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const requiredNames = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ADMIN_API_KEY",
  "WEBSITE_API_KEY",
  "DEVICE_HASH_PEPPER"
];

export const config = {
  nodeEnv: text("NODE_ENV", "development"),
  port: number("PORT", 8080, { min: 1, max: 65535 }),
  databaseUrl: text("DATABASE_URL"),
  databaseSsl: text("DATABASE_SSL", "false").toLowerCase() === "true",
  jwtSecret: text("JWT_SECRET"),
  adminApiKey: text("ADMIN_API_KEY"),
  websiteApiKey: text("WEBSITE_API_KEY"),
  deviceHashPepper: text("DEVICE_HASH_PEPPER"),
  // A separate stable secret is preferred. JWT_SECRET is used as a backwards-compatible fallback.
  licenseKeyEncryptionKey: text("LICENSE_KEY_ENCRYPTION_KEY", text("JWT_SECRET")),
  freeTrialDays: number("FREE_TRIAL_DAYS", 2, { min: 1, max: 30 }),
  accessTokenMinutes: number("ACCESS_TOKEN_MINUTES", 15, { min: 1, max: 1440 }),
  refreshTokenDays: number("REFRESH_TOKEN_DAYS", 30, { min: 1, max: 3650 }),
  corsOrigins: text("CORS_ORIGINS", "*").split(",").map(value => value.trim()).filter(Boolean),
  maintenanceMode: text("MAINTENANCE_MODE", "false").toLowerCase() === "true",
  maintenanceMessage: text("MAINTENANCE_MESSAGE", "MatchIntel is temporarily under maintenance."),
  minimumAppVersion: text("MINIMUM_APP_VERSION", "0.2.0"),
  latestAppVersion: text("LATEST_APP_VERSION", "0.4.0"),
  enrichment: {
    provider: text("ENRICHMENT_PROVIDER", text("ENRICHMENT_ENDPOINT_TEMPLATE") ? "configured" : "fortnitetracker-public"),
    endpointTemplate: text("ENRICHMENT_ENDPOINT_TEMPLATE"),
    apiHeader: text("ENRICHMENT_API_HEADER", "x-api-key"),
    apiKey: text("ENRICHMENT_API_KEY"),
    cacheHours: number("ENRICHMENT_CACHE_HOURS", 24, { min: 1, max: 720 }),
    negativeCacheHours: number("ENRICHMENT_NEGATIVE_CACHE_HOURS", 6, { min: 1, max: 168 }),
    requestIntervalMs: number("ENRICHMENT_REQUEST_INTERVAL_MS", 1500, { min: 500, max: 60000 }),
    requestTimeoutMs: number("ENRICHMENT_REQUEST_TIMEOUT_MS", 15000, { min: 3000, max: 120000 }),
    idlePollMs: number("ENRICHMENT_IDLE_POLL_MS", 2000, { min: 500, max: 60000 }),
    maxAttempts: number("ENRICHMENT_MAX_ATTEMPTS", 5, { min: 1, max: 20 }),
    maxRetryMinutes: number("ENRICHMENT_MAX_RETRY_MINUTES", 120, { min: 5, max: 1440 }),
    blockedCooldownMinutes: number("ENRICHMENT_BLOCKED_COOLDOWN_MINUTES", 30, { min: 5, max: 1440 }),
    seedGlobalLeaderboard: text("ENRICHMENT_SEED_GLOBAL_LEADERBOARD", "true").toLowerCase() === "true",
    leaderboardSeedHours: number("ENRICHMENT_LEADERBOARD_SEED_HOURS", 12, { min: 1, max: 168 })
  }
};

export function missingRequiredEnvironment() {
  return requiredNames.filter(name => !text(name));
}

export function configurationReady() {
  return missingRequiredEnvironment().length === 0;
}
