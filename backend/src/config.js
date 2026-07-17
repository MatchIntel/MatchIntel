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
  freeTrialDays: number("FREE_TRIAL_DAYS", 3, { min: 1, max: 30 }),
  accessTokenMinutes: number("ACCESS_TOKEN_MINUTES", 15, { min: 1, max: 1440 }),
  refreshTokenDays: number("REFRESH_TOKEN_DAYS", 30, { min: 1, max: 3650 }),
  corsOrigins: text("CORS_ORIGINS", "*").split(",").map(value => value.trim()).filter(Boolean),
  maintenanceMode: text("MAINTENANCE_MODE", "false").toLowerCase() === "true",
  maintenanceMessage: text("MAINTENANCE_MESSAGE", "MatchIntel is temporarily under maintenance."),
  minimumAppVersion: text("MINIMUM_APP_VERSION", "0.2.0"),
  latestAppVersion: text("LATEST_APP_VERSION", "0.2.0"),
  enrichment: {
    endpointTemplate: text("ENRICHMENT_ENDPOINT_TEMPLATE"),
    apiHeader: text("ENRICHMENT_API_HEADER", "x-api-key"),
    apiKey: text("ENRICHMENT_API_KEY"),
    cacheHours: number("ENRICHMENT_CACHE_HOURS", 24, { min: 1, max: 720 })
  }
};

export function missingRequiredEnvironment() {
  return requiredNames.filter(name => !text(name));
}

export function configurationReady() {
  return missingRequiredEnvironment().length === 0;
}
