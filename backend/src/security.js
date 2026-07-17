import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export const randomUuid = () => crypto.randomUUID();
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");
export const hashDevice = value => sha256(`${config.deviceHashPepper}:${value}`);

function licenseCipherKey() {
  return crypto.createHash("sha256")
    .update(String(config.licenseKeyEncryptionKey || config.jwtSecret))
    .digest();
}

export function encryptLicenseKey(value) {
  const plaintext = String(value || "").trim();
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", licenseCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptLicenseKey(value) {
  const packed = String(value || "").trim();
  if (!packed) return null;
  const [version, ivText, tagText, encryptedText] = packed.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      licenseCipherKey(),
      Buffer.from(ivText, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function createLicenseKey() {
  // Hex uses only characters accepted by the existing MI key format and always
  // produces exactly 24 characters, avoiding occasional short Base64URL keys.
  const body = crypto.randomBytes(12).toString("hex").toUpperCase();
  return `MI-${body.match(/.{4}/g).join("-")}`;
}

export function parseDuration(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "lifetime") return null;
  const match = /^(\d+)(h|d|w|m|y)$/.exec(text);
  if (!match) throw new Error("Duration must look like 12h, 7d, 4w, 1m, 1y, or lifetime.");
  const amount = Number(match[1]);
  const date = new Date();
  if (match[2] === "h") date.setHours(date.getHours() + amount);
  if (match[2] === "d") date.setDate(date.getDate() + amount);
  if (match[2] === "w") date.setDate(date.getDate() + amount * 7);
  if (match[2] === "m") date.setMonth(date.getMonth() + amount);
  if (match[2] === "y") date.setFullYear(date.getFullYear() + amount);
  return date;
}

export function compareVersions(a, b) {
  const parts = value => String(value || "0").split(/[+-]/)[0].split(".").map(x => Number(x) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

export const signAccess = (license, deviceHash) => jwt.sign(
  {
    sub: license.id,
    plan: license.plan,
    features: license.features || [],
    deviceHash,
    type: "access"
  },
  config.jwtSecret,
  { expiresIn: `${config.accessTokenMinutes}m`, issuer: "matchintel" }
);

export const verifyAccess = token => jwt.verify(token, config.jwtSecret, { issuer: "matchintel" });
