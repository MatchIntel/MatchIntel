import http from "node:http";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { pool } from "./db.js";
import { requireAdmin, requireAuth } from "./auth.js";
import { activate, refresh, status as licenseStatus } from "./licenses.js";
import { ingest, list, one } from "./live.js";
import { enrich } from "./enrichment.js";
import { report } from "./reports.js";
import * as admin from "./admin.js";
import { attach } from "./websocket.js";
import { migrationState, startMigrationLoop } from "./migrations.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin(origin, callback) {
  if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
    return callback(null, true);
  }
  callback(new Error("CORS origin is not allowed."));
}}));
app.use(express.json({ limit: "4mb" }));

// Railway uses this as a liveness check. It intentionally returns 200 as soon as
// the HTTP process is listening, even while PostgreSQL is reconnecting or a
// migration is waiting for a lock. Database readiness is exposed at /ready.
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "matchintel-backend",
    version: config.latestAppVersion,
    uptimeSeconds: Math.floor(process.uptime()),
    database: migrationState.ready ? "ready" : "starting",
    migrationAttempts: migrationState.attempts
  });
});

app.get("/ready", async (_req, res) => {
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
    res.json({ status: "ready", database: "ready", version: config.latestAppVersion });
  } catch (error) {
    res.status(503).json({
      status: "not-ready",
      database: "unavailable",
      message: String(error.message || error).slice(0, 300)
    });
  }
});

app.get("/v1/public/config", (_req, res) => res.json({
  latestVersion: config.latestAppVersion,
  minimumVersion: config.minimumAppVersion,
  maintenance: config.maintenanceMode,
  maintenanceMessage: config.maintenanceMessage
}));

app.use(rateLimit({
  windowMs: 60000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === "/health" || req.path === "/ready"
}));

// Do not let normal API calls hit a half-migrated schema. Railway can still see
// the process as healthy while this returns a clear temporary 503 to clients.
app.use("/v1", (req, res, next) => {
  if (migrationState.ready) return next();
  res.setHeader("Retry-After", "5");
  return res.status(503).json({
    code: "MI-DATABASE-STARTING",
    message: "MatchIntel is finishing its database startup. Try again in a few seconds."
  });
});

app.post("/v1/licenses/activate", activate);
app.post("/v1/auth/refresh", refresh);
app.get("/v1/licenses/status", requireAuth, licenseStatus);

app.post("/v1/live/ingest", requireAuth, ingest);
app.get("/v1/sessions", requireAuth, list);
app.get("/v1/sessions/:sessionId", requireAuth, one);
app.post("/v1/enrichment/players", requireAuth, enrich);
app.get("/v1/reports/summary", requireAuth, report);

app.get("/v1/admin/status", requireAdmin, admin.status);
app.get("/v1/admin/audit", requireAdmin, admin.auditLog);
app.get("/v1/admin/licenses", requireAdmin, admin.find);
app.post("/v1/admin/licenses", requireAdmin, admin.create);
app.get("/v1/admin/licenses/:ref", requireAdmin, admin.one);
app.get("/v1/admin/licenses/:ref/devices", requireAdmin, admin.devices);
app.post("/v1/admin/licenses/:ref/revoke", requireAdmin, admin.revoke);
app.post("/v1/admin/licenses/:ref/restore", requireAdmin, admin.restore);
app.post("/v1/admin/licenses/:ref/reset-devices", requireAdmin, admin.reset);
app.post("/v1/admin/licenses/:ref/convert-lifetime", requireAdmin, admin.convertLifetime);
app.post("/v1/admin/licenses/:ref/transfer", requireAdmin, admin.transfer);
app.get("/v1/admin/users/:discordUserId/licenses", requireAdmin, admin.userLicenses);
app.post("/v1/admin/users/:discordUserId/reset-devices", requireAdmin, admin.resetUser);
app.post("/v1/admin/users/:discordUserId/revoke", requireAdmin, admin.revokeUser);
app.post("/v1/admin/maintenance", requireAdmin, admin.maintenance);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ code: "MI-SERVER", message: "An internal server error occurred." });
});

const server = http.createServer(app);
app.locals.broadcast = attach(server);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`MatchIntel backend listening on ${config.port}`);
  void startMigrationLoop();
});

async function shutdown(signal) {
  console.log(`[shutdown] ${signal} received.`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
