import { config } from "./config.js";

const TRACKER_ORIGIN = "https://fortnitetracker.com";
const DEFAULT_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.8",
  "Cache-Control": "no-cache",
  "User-Agent": "MatchIntel/0.6 (+https://matchintel.cc)"
};

export class ProviderHttpError extends Error {
  constructor(status, message, retryAfterMs = null) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_all, decimal) => String.fromCodePoint(Number(decimal)));
}

function plainText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function numeric(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/\\u0024/g, "$")
    .replace(/[$,\s]/g, "")
    .trim();
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function firstNumber(source, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const value = numeric(match[1]);
    if (value != null) return value;
  }
  return null;
}

function parseJsonScripts(html) {
  const results = [];
  const patterns = [
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        results.push(JSON.parse(decodeEntities(match[1]).trim()));
      } catch {
        // Tracker has used multiple client frameworks over time. Invalid or
        // unrelated script blobs are ignored and the text parser remains active.
      }
    }
  }
  return results;
}

function scoreCandidate(path, kind) {
  const text = path.join(".").toLowerCase();
  if (kind === "pr") {
    let score = 0;
    if (/powerrankinglifetime|lifetimepower|lifetime.*pr/.test(text)) score += 100;
    if (/powerranking|power_ranking/.test(text)) score += 70;
    if (/(^|\.)pr($|\.)/.test(text)) score += 35;
    if (/rank|position|percentile/.test(text)) score -= 80;
    if (/displayvalue|value|amount|total/.test(text)) score += 10;
    return score;
  }
  let score = 0;
  if (/lifetime.*earning|earning.*lifetime/.test(text)) score += 110;
  if (/total.*earning|earning.*total/.test(text)) score += 95;
  if (/prizemoney|prize_money|cashprize|eventearnings/.test(text)) score += 85;
  if (/earnings|winnings/.test(text)) score += 65;
  if (/event|session|placement|recent/.test(text)) score -= 20;
  if (/displayvalue|value|amount|total/.test(text)) score += 10;
  return score;
}

function candidatesFromJson(root, kind) {
  const candidates = [];
  const seen = new Set();
  const walk = (value, path = [], depth = 0) => {
    if (depth > 18 || value == null) return;
    if (typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.slice(0, 5000).forEach((item, index) => walk(item, [...path, String(index)], depth + 1));
      } else {
        for (const [key, item] of Object.entries(value)) walk(item, [...path, key], depth + 1);
      }
      return;
    }
    const score = scoreCandidate(path, kind);
    if (score <= 0) return;
    const number = numeric(value);
    if (number == null) return;
    candidates.push({ number, score, path: path.join(".") });
  };
  walk(root);
  return candidates.sort((a, b) => b.score - a.score || b.number - a.number);
}

function parseEmbeddedJson(html) {
  const roots = parseJsonScripts(html);
  const pr = roots.flatMap(root => candidatesFromJson(root, "pr"))[0]?.number ?? null;
  const earnings = roots.flatMap(root => candidatesFromJson(root, "earnings"))[0]?.number ?? null;
  return { powerRanking: pr, lifetimeEarnings: earnings };
}

export function parseTrackerProfileHtml(html, requestedName = "") {
  const raw = String(html || "");
  const text = plainText(raw);
  const embedded = parseEmbeddedJson(raw);

  const powerRanking = embedded.powerRanking ?? firstNumber(raw, [
    /["']powerRankingLifetime["']\s*:\s*\{[\s\S]{0,1200}?["'](?:displayValue|value)["']\s*:\s*["']?([\d,.]+)["']?/i,
    /["']lifetimePowerRanking["']\s*:\s*["']?([\d,.]+)["']?/i,
    /["']powerRanking["']\s*:\s*\{[\s\S]{0,800}?["'](?:displayValue|value)["']\s*:\s*["']?([\d,.]+)["']?/i
  ]) ?? firstNumber(text, [
    /PR History[\s\S]{0,700}?Lifetime\s+([\d,]+)\s*\(No Decay\)/i,
    /Lifetime\s+([\d,]+)\s*\(No Decay\)/i,
    /Power Ranking[\s\S]{0,300}?([\d,]+)\s+PR points earned without any decay/i
  ]);

  const lifetimeEarnings = embedded.lifetimeEarnings ?? firstNumber(raw, [
    /["']lifetimeEarnings["']\s*:\s*(?:\{[\s\S]{0,800}?["'](?:displayValue|value|amount)["']\s*:\s*)?["']?\$?([\d,.]+)["']?/i,
    /["']totalEarnings["']\s*:\s*(?:\{[\s\S]{0,800}?["'](?:displayValue|value|amount)["']\s*:\s*)?["']?\$?([\d,.]+)["']?/i,
    /["'](?:prizeMoney|cashPrize|eventEarnings|winnings)["']\s*:\s*(?:\{[\s\S]{0,800}?["'](?:displayValue|value|amount)["']\s*:\s*)?["']?\$?([\d,.]+)["']?/i
  ]) ?? firstNumber(text, [
    /(?:Lifetime|Total)\s+(?:Event\s+)?Earnings\s*\$\s*([\d,]+)/i,
    /Earnings\s*\$\s*([\d,]+)\s+(?:[\d,]+\s+PR|Power Ranking)/i
  ]);

  const canonicalName = decodeEntities(
    raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") || requestedName
  ).replace(/\s+/g, " ").trim() || requestedName;

  const accountId = raw.match(/["'](?:accountId|platformUserId|profileId)["']\s*:\s*["']([a-z0-9-]{16,64})["']/i)?.[1] || null;

  return {
    displayName: canonicalName,
    accountId,
    powerRanking,
    lifetimeEarnings,
    raw: {
      parser: "tracker-public-profile-v1",
      textLength: text.length,
      foundPowerRanking: powerRanking != null,
      foundLifetimeEarnings: lifetimeEarnings != null
    }
  };
}


export function parseTrackerEarningsLeaderboardHtml(html) {
  const raw = String(html || "");
  const anchors = [...raw.matchAll(/<a\b[^>]*href=["']([^"']*\/profile\/(?:all|kbm|gamepad|touch)\/[^"']*?\/events[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const players = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const match = anchors[index];
    const start = match.index + match[0].length;
    const end = anchors[index + 1]?.index ?? Math.min(raw.length, start + 3000);
    const between = plainText(raw.slice(start, end));
    const earnings = firstNumber(between, [/\$\s*([\d,]+)/i]);
    const powerRanking = firstNumber(between, [/([\d,]+)\s*PR/i]);
    if (earnings == null && powerRanking == null) continue;
    const displayName = decodeEntities(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!displayName) continue;
    const href = decodeEntities(match[1]);
    players.push({
      displayName,
      powerRanking,
      lifetimeEarnings: earnings,
      sourceUrl: href.startsWith("http") ? href : `${TRACKER_ORIGIN}${href}`,
      provider: "fortnitetracker-global-leaderboard"
    });
  }
  return players;
}

export async function fetchGlobalEarningsLeaderboard() {
  const sourceUrl = `${TRACKER_ORIGIN}/events/earnings?platform=pc&region=GLOBAL`;
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(config.enrichment.requestTimeoutMs)
  });
  if (!response.ok) {
    throw new ProviderHttpError(
      response.status,
      `Fortnite Tracker leaderboard returned HTTP ${response.status}`,
      retryAfterMilliseconds(response.headers.get("retry-after"))
    );
  }
  const html = await response.text();
  if (/captcha|cf-chl|cloudflare ray id|verify you are human|access denied/i.test(html)) {
    throw new ProviderHttpError(403, "Fortnite Tracker requested browser verification.", 30 * 60 * 1000);
  }
  return {
    sourceUrl: response.url || sourceUrl,
    players: parseTrackerEarningsLeaderboardHtml(html)
  };
}

export async function fetchFortniteTrackerPublic(player) {
  const requestedName = String(player?.displayName || "").trim();
  if (!requestedName) throw new Error("A player display name is required.");

  const sourceUrl = `${TRACKER_ORIGIN}/profile/all/${encodeURIComponent(requestedName)}/events?region=GLOBAL`;
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(config.enrichment.requestTimeoutMs)
  });

  if (!response.ok) {
    throw new ProviderHttpError(
      response.status,
      `Fortnite Tracker returned HTTP ${response.status}`,
      retryAfterMilliseconds(response.headers.get("retry-after"))
    );
  }

  const contentType = String(response.headers.get("content-type") || "");
  const html = await response.text();
  if (!contentType.includes("text/html") && !html.trim().startsWith("<")) {
    throw new Error("Fortnite Tracker returned an unexpected response.");
  }

  const blocked = /captcha|cf-chl|cloudflare ray id|verify you are human|access denied/i.test(html);
  if (blocked) {
    throw new ProviderHttpError(403, "Fortnite Tracker requested browser verification.", 30 * 60 * 1000);
  }

  const parsed = parseTrackerProfileHtml(html, requestedName);
  return {
    ...parsed,
    requestedName,
    sourceUrl: response.url || sourceUrl,
    provider: "fortnitetracker-public",
    raw: {
      ...parsed.raw,
      finalUrl: response.url || sourceUrl,
      status: response.status
    }
  };
}
