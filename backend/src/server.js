import http from "node:http";
import { spawn } from "node:child_process";
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

await new Promise((resolve, reject) => {
  const process = spawn(process.execPath, ["src/migrate.js"], { stdio: "inherit", env: process.env });
  process.on("exit", code => code === 0 ? resolve() : reject(new Error(`Migration exited ${code}`)));
  process.on("error", reject);
});

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin(origin, callback) {
  if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) return callback(null, true);
  callback(new Error("CORS origin is not allowed."));
}}));
app.use(express.json({ limit: "4mb" }));
app.use(rateLimit({ windowMs: 60000, limit: 240, standardHeaders: true, legacyHeaders: false }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "matchintel-backend", version: config.latestAppVersion });
  } catch (error) {
    res.status(503).json({ status: "error", message: error.message });
  }
});
app.get("/v1/public/config", (_req, res) => res.json({
  latestVersion: config.latestAppVersion,
  minimumVersion: config.minimumAppVersion,
  maintenance: config.maintenanceMode,
  maintenanceMessage: config.maintenanceMessage
}));

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
server.listen(config.port, "0.0.0.0", () => console.log(`MatchIntel backend listening on ${config.port}`));
