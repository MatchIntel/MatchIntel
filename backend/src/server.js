import http from "node:http";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { config, missingRequiredEnvironment } from "./config.js";
import { pool } from "./db.js";
import { requireAdmin, requireAuth, requireWebsite } from "./auth.js";
import { requireClientVersion, getRuntimeSettings } from "./appSettings.js";
import { activate, refresh, status as licenseStatus } from "./licenses.js";
import { ingest, list, one } from "./live.js";
import { enrich, enrichmentQueueStatus, enrichmentWorkerState, startEnrichmentWorker, stopEnrichmentWorker } from "./enrichment.js";
import { report } from "./reports.js";
import * as admin from "./admin.js";
import { attach } from "./websocket.js";
import { issueWebsiteTrial } from "./freeTrials.js";
import { migrationState, startMigrationLoop } from "./migrations.js";

const app = express();

// Railway places one reverse proxy in front of the service. Trusting exactly
// one hop allows express-rate-limit to identify the real client without making
// arbitrary forwarded headers trustworthy.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin(origin, callback) {
  if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
    return callback(null, true);
  }
  callback(new Error("CORS origin is not allowed."));
}}));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  const missingEnvironment = missingRequiredEnvironment();
  res.status(200).json({
    status: "ok",
    service: "matchintel-backend",
    version: "0.6.0",
    uptimeSeconds: Math.floor(process.uptime()),
    configuration: missingEnvironment.length ? "incomplete" : "ready",
    missingEnvironment,
    database: migrationState.ready ? "ready" : "starting",
    migrationAttempts: migrationState.attempts,
    enrichment: {
      provider: config.enrichment.provider,
      workerRunning: enrichmentWorkerState.running,
      blockedUntil: enrichmentWorkerState.blockedUntil,
      lastSuccessAt: enrichmentWorkerState.lastSuccessAt,
      leaderboardSeededAt: enrichmentWorkerState.leaderboardSeededAt,
      leaderboardSeedCount: enrichmentWorkerState.leaderboardSeedCount
    }
  });
});

app.get("/ready", async (_req, res) => {
  const missingEnvironment = missingRequiredEnvironment();
  if (missingEnvironment.length) {
    return res.status(503).json({
      status: "not-ready",
      configuration: "incomplete",
      missingEnvironment,
      message: "Add the listed variables to the Railway backend service."
    });
  }
  if (!migrationState.ready) {
    return res.status(503).json({
      status: "starting",
      database: "not-ready",
      migrationAttempts: migrationState.attempts,
      message: migrationState.lastError || "Waiting for database migrations."
    });
  }
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready", database: "ready", version: "0.6.0" });
  } catch (error) {
    res.status(503).json({
      status: "not-ready",
      database: "unavailable",
      message: String(error.message || error).slice(0, 300)
    });
  }
});

app.get("/v1/public/config", async (_req, res, next) => {
  try {
    const runtime = await getRuntimeSettings();
    res.json({
      latestVersion: runtime.version.latestVersion,
      minimumVersion: runtime.version.minimumVersion,
      forceUpdate: runtime.version.forceUpdate,
      updateUrl: runtime.version.updateUrl,
      updateMessage: runtime.version.message,
      maintenance: runtime.maintenance.enabled,
      maintenanceMessage: runtime.maintenance.message
    });
  } catch (error) {
    next(error);
  }
});

app.use(rateLimit({
  windowMs: 60000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === "/health" || req.path === "/ready"
}));

app.use("/v1", (_req, res, next) => {
  const missingEnvironment = missingRequiredEnvironment();
  if (!missingEnvironment.length) return next();
  res.setHeader("Retry-After", "30");
  return res.status(503).json({
    code: "MI-CONFIG-INCOMPLETE",
    message: "The MatchIntel backend is missing required Railway variables.",
    missingEnvironment
  });
});

app.use("/v1", (_req, res, next) => {
  if (migrationState.ready) return next();
  res.setHeader("Retry-After", "5");
  return res.status(503).json({
    code: "MI-DATABASE-STARTING",
    message: "MatchIntel is finishing its database startup. Try again in a few seconds."
  });
});

app.post("/v1/licenses/activate", activate);
app.post("/v1/internal/free-trials", requireWebsite, issueWebsiteTrial);
app.post("/v1/auth/refresh", refresh);
app.get("/v1/licenses/status", requireClientVersion, requireAuth, licenseStatus);

app.post("/v1/live/ingest", requireClientVersion, requireAuth, ingest);
app.get("/v1/sessions", requireClientVersion, requireAuth, list);
app.get("/v1/sessions/:sessionId", requireClientVersion, requireAuth, one);
app.post("/v1/enrichment/players", requireClientVersion, requireAuth, enrich);
app.get("/v1/enrichment/status", requireClientVersion, requireAuth, enrichmentQueueStatus);
app.get("/v1/reports/summary", requireClientVersion, requireAuth, report);

app.get("/v1/admin/status", requireAdmin, admin.status);
app.get("/v1/admin/audit", requireAdmin, admin.auditLog);
app.get("/v1/admin/version", requireAdmin, admin.versionStatus);
app.post("/v1/admin/version", requireAdmin, admin.updateVersion);
app.get("/v1/admin/licenses", requireAdmin, admin.find);
app.post("/v1/admin/licenses", requireAdmin, admin.create);
app.post("/v1/admin/licenses/bulk-delete", requireAdmin, admin.deleteBulk);
app.post("/v1/admin/licenses/bulk-extend", requireAdmin, admin.extendBulk);
app.post("/v1/admin/keyinfo", requireAdmin, admin.keyInfo);
app.post("/v1/admin/licenses/reissue", requireAdmin, admin.reissueKey);
app.get("/v1/admin/licenses/:ref", requireAdmin, admin.one);
app.delete("/v1/admin/licenses/:ref", requireAdmin, admin.deleteLicense);
app.get("/v1/admin/licenses/:ref/devices", requireAdmin, admin.devices);
app.post("/v1/admin/licenses/:ref/revoke", requireAdmin, admin.revoke);
app.post("/v1/admin/licenses/:ref/restore", requireAdmin, admin.restore);
app.post("/v1/admin/licenses/:ref/reset-devices", requireAdmin, admin.reset);
app.post("/v1/admin/licenses/:ref/extend", requireAdmin, admin.extendLicense);
app.post("/v1/admin/licenses/:ref/convert-lifetime", requireAdmin, admin.convertLifetime);
app.post("/v1/admin/licenses/:ref/transfer", requireAdmin, admin.transfer);
app.get("/v1/admin/users/:discordUserId/licenses", requireAdmin, admin.userLicenses);
app.post("/v1/admin/users/:discordUserId/reset-devices", requireAdmin, admin.resetUser);
app.post("/v1/admin/users/:discordUserId/revoke", requireAdmin, admin.revokeUser);
app.post("/v1/admin/maintenance", requireAdmin, admin.maintenance);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    code: error.code || "MI-SERVER",
    message: error.status ? error.message : "An internal server error occurred."
  });
});

const server = http.createServer(app);
app.locals.broadcast = attach(server);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`MatchIntel backend 0.6.1 listening on 0.0.0.0:${config.port}`);
  const missingEnvironment = missingRequiredEnvironment();
  if (missingEnvironment.length) {
    console.error(`[configuration] Missing required Railway variable(s): ${missingEnvironment.join(", ")}`);
    console.error("[configuration] /health remains online; API routes are disabled until the variables are added.");
    return;
  }
  void startMigrationLoop().then(() => startEnrichmentWorker()).catch(error => {
    console.error(`[startup] Enrichment worker failed to start: ${error.message}`);
  });
});

async function shutdown(signal) {
  console.log(`[shutdown] ${signal} received.`);
  server.close(async () => {
    stopEnrichmentWorker();
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", error => {
  console.error("[unhandledRejection]", error);
});
