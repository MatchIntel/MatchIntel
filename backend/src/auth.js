import crypto from "node:crypto";
import { query } from "./db.js";
import { config } from "./config.js";
import { verifyAccess } from "./security.js";

function equal(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ code: "MI-AUTH-REQUIRED", message: "Authentication is required." });
    const payload = verifyAccess(token);
    const result = await query("SELECT * FROM licenses WHERE id=$1", [payload.sub]);
    const license = result.rows[0];
    if (!license || license.status !== "active") {
      return res.status(401).json({ code: "MI-LICENSE-INACTIVE", message: "This license is not active." });
    }
    if (license.expires_at && new Date(license.expires_at) <= new Date()) {
      return res.status(401).json({ code: "MI-LICENSE-EXPIRED", message: "This license has expired." });
    }
    req.auth = { license, deviceHash: payload.deviceHash, features: license.features || [] };
    await query(
      "UPDATE devices SET last_seen_at=NOW() WHERE license_id=$1 AND device_hash=$2",
      [license.id, payload.deviceHash]
    );
    next();
  } catch {
    res.status(401).json({ code: "MI-AUTH-INVALID", message: "The access token is invalid or expired." });
  }
}

export function requireAdmin(req, res, next) {
  const supplied = req.headers["x-admin-key"] || "";
  if (!supplied || !equal(supplied, config.adminApiKey)) {
    return res.status(403).json({ code: "MI-ADMIN-FORBIDDEN", message: "Administrator access is required." });
  }
  next();
}

export function requireWebsite(req, res, next) {
  const supplied = req.headers["x-website-key"] || "";
  if (!supplied || !equal(supplied, config.websiteApiKey)) {
    return res.status(403).json({ code: "MI-WEBSITE-FORBIDDEN", message: "Website service access is required." });
  }
  next();
}
