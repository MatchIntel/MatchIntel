import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";

const app = express();
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const cookieKey = crypto.createHash("sha256").update(config.cookieSecret).digest();
const pendingCookieName = "mi_trial_oauth";

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(publicDirectory, {
  etag: true,
  maxAge: config.nodeEnv === "production" ? "1h" : 0
}));

const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === "/health"
});

const trialLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "MI-WEBSITE-RATE-LIMIT",
    message: "Too many free-trial attempts. Wait a few minutes and try again."
  }
});

app.use(generalLimiter);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "matchintel-website",
    version: "0.5.2",
    uptimeSeconds: Math.floor(process.uptime())
  });
});


app.get("/api/status", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const response = await fetch(`${config.backendUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" }
    });
    const health = await readJson(response);
    const configurationReady = health?.configuration !== "incomplete";
    const databaseReady = health?.database === "ready" || health?.status === "ready";

    return res.status(200).json({
      website: "online",
      trials: response.ok && configurationReady && databaseReady ? "online" : "offline"
    });
  } catch {
    return res.status(200).json({ website: "online", trials: "offline" });
  }
});

app.get("/api/site-config", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    siteName: config.siteName,
    discordInviteUrl: config.discordInviteUrl,
    lifetimeBuyUrl: config.lifetimeBuyUrl,
    downloadUrl: config.downloadUrl,
    supportUrl: config.supportUrl,
    supportEmail: config.supportEmail,
    lifetimePriceLabel: config.lifetimePriceLabel,
    freeTrialDays: config.freeTrialDays
  });
});

app.get("/trial/start", trialLimiter, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const state = crypto.randomBytes(32).toString("base64url");
  const pending = seal({ state, expiresAt: Date.now() + 10 * 60_000 });

  res.setHeader("Set-Cookie", serializeCookie(pendingCookieName, pending, {
    maxAgeSeconds: 10 * 60,
    httpOnly: true,
    secure: config.nodeEnv === "production" || config.siteUrl.startsWith("https://"),
    sameSite: "Lax"
  }));

  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", config.discordClientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", config.discordRedirectUri);
  authorizeUrl.searchParams.set("scope", "identify");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "consent");
  res.redirect(302, authorizeUrl.toString());
});

app.get("/auth/discord/callback", trialLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Set-Cookie", serializeCookie(pendingCookieName, "", {
    maxAgeSeconds: 0,
    httpOnly: true,
    secure: config.nodeEnv === "production" || config.siteUrl.startsWith("https://"),
    sameSite: "Lax"
  }));

  try {
    if (req.query.error) {
      throw httpError(400, "Discord sign-in was cancelled or denied.");
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const pending = unseal(cookies[pendingCookieName]);
    if (!pending || pending.expiresAt < Date.now()) {
      throw httpError(400, "This free-trial request expired. Start again from the MatchIntel website.");
    }
    if (!req.query.state || !safeEqual(req.query.state, pending.state)) {
      throw httpError(400, "The Discord sign-in state did not match. Start the trial again.");
    }

    const code = String(req.query.code || "");
    if (!code) throw httpError(400, "Discord did not return an authorization code.");

    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.discordRedirectUri
      })
    });
    const tokenBody = await readJson(tokenResponse);
    if (!tokenResponse.ok || !tokenBody?.access_token) {
      throw httpError(502, "Discord sign-in could not be completed. Check the OAuth redirect URL and try again.");
    }

    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${tokenBody.access_token}` }
    });
    const user = await readJson(userResponse);
    if (!userResponse.ok || !user?.id) {
      throw httpError(502, "Discord did not return your user profile.");
    }

    const discordUsername = String(user.global_name || user.username || user.id).slice(0, 100);
    const issueResponse = await fetch(`${config.backendUrl}/v1/internal/free-trials`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        "X-Website-Key": config.websiteApiKey
      },
      body: JSON.stringify({
        discordUserId: String(user.id),
        discordUsername
      })
    });
    const issued = await readJson(issueResponse);
    if (!issueResponse.ok || !issued?.licenseKey) {
      console.warn("[trial] Backend rejected trial request", {
        status: issueResponse.status,
        code: issued?.code,
        missingEnvironment: issued?.missingEnvironment
      });
      throw httpError(issueResponse.status, friendlyBackendMessage(issued, issueResponse.status));
    }

    res.status(200).send(renderResult({
      title: "Free Trial Ready",
      heading: `Your ${issued.trialDays || config.freeTrialDays}-day free trial is ready`,
      message: "Copy the key below and paste it into MatchIntel to activate your trial.",
      tone: "success",
      licenseKey: issued.licenseKey,
      expiresAt: issued.license?.expiresAt,
      discordUsername
    }));
  } catch (error) {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    res.status(status).send(renderResult({
      title: "Free Trial Unavailable",
      heading: "Your free trial could not be created",
      message: error.publicMessage || "An unexpected error occurred. Try again or contact MatchIntel support.",
      tone: "error"
    }));
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send(renderResult({
    title: "MatchIntel Error",
    heading: "Something went wrong",
    message: "The website could not complete that request. Try again shortly.",
    tone: "error"
  }));
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`MatchIntel website 0.5.2 listening on ${config.port}`);
});

function httpError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const result = {};
  for (const pair of String(header || "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (Number.isFinite(options.maxAgeSeconds)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  return parts.join("; ");
}

function seal(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cookieKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function unseal(value) {
  try {
    const packed = Buffer.from(String(value || ""), "base64url");
    if (packed.length < 29) return null;
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", cookieKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    return null;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return { message: text.slice(0, 300) }; }
}

function friendlyBackendMessage(body, status) {
  if (body?.code === "MI-TRIAL-DISCORD-USED") {
    return "This Discord account has already used its MatchIntel free trial.";
  }
  if (body?.code === "MI-DATABASE-STARTING") {
    return "The trial system is starting up. Wait a moment and try again.";
  }
  if (body?.code === "MI-CONFIG-INCOMPLETE") {
    return "Free trials are temporarily unavailable. Please try again shortly or join the Discord for help.";
  }
  if (status === 401 || status === 403) {
    return "Free trials are temporarily unavailable. Please contact MatchIntel support.";
  }
  if (status === 429) {
    return "Too many attempts were made. Wait a few minutes and try again.";
  }
  if (status >= 500) {
    return "The trial system is temporarily unavailable. Please try again shortly.";
  }
  return body?.message || "The free trial could not be created. Please try again or contact support.";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderResult({ title, heading, message, tone, licenseKey, expiresAt, discordUsername }) {
  const keyBlock = licenseKey ? `
    <div class="key-panel">
      <span>LICENSE KEY</span>
      <code id="licenseKey">${escapeHtml(licenseKey)}</code>
      <button id="copyKey" class="button primary" type="button">Copy license key</button>
    </div>
    <div class="result-meta">
      <span>Discord</span><strong>${escapeHtml(discordUsername || "Connected")}</strong>
      <span>Expires</span><strong>${escapeHtml(expiresAt ? new Date(expiresAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" }) : "Trial period")}</strong>
    </div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} | MatchIntel</title>
  <link rel="icon" href="/assets/icon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="result-page">
  <div class="background-grid" aria-hidden="true"></div>
  <main class="result-card ${tone === "success" ? "success" : "failure"}">
    <a class="result-brand" href="/"><img src="/assets/icon.png" alt=""><span>MATCH<strong>INTEL</strong></span></a>
    <div class="result-symbol">${tone === "success" ? "✓" : "!"}</div>
    <p class="eyebrow">${tone === "success" ? "TRIAL READY" : "TRIAL UNAVAILABLE"}</p>
    <h1>${escapeHtml(heading)}</h1>
    <p class="result-message">${escapeHtml(message)}</p>
    ${keyBlock}
    <div class="result-actions">
      <a class="button secondary" href="/">Back to MatchIntel</a>
    </div>
  </main>
  ${licenseKey ? '<script src="/result.js"></script>' : ""}
</body>
</html>`;
}
