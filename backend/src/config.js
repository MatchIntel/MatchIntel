const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  databaseUrl: required("DATABASE_URL"),
  databaseSsl: String(process.env.DATABASE_SSL || "false").toLowerCase() === "true",
  jwtSecret: required("JWT_SECRET"),
  adminApiKey: required("ADMIN_API_KEY"),
  deviceHashPepper: required("DEVICE_HASH_PEPPER"),
  accessTokenMinutes: Number(process.env.ACCESS_TOKEN_MINUTES || 15),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map(x => x.trim()),
  maintenanceMode: String(process.env.MAINTENANCE_MODE || "false").toLowerCase() === "true",
  maintenanceMessage: process.env.MAINTENANCE_MESSAGE || "MatchIntel is temporarily under maintenance.",
  minimumAppVersion: process.env.MINIMUM_APP_VERSION || "0.2.0",
  latestAppVersion: process.env.LATEST_APP_VERSION || "0.2.0",
  enrichment: {
    endpointTemplate: process.env.ENRICHMENT_ENDPOINT_TEMPLATE || "",
    apiHeader: process.env.ENRICHMENT_API_HEADER || "x-api-key",
    apiKey: process.env.ENRICHMENT_API_KEY || "",
    cacheHours: Number(process.env.ENRICHMENT_CACHE_HOURS || 24)
  }
};
