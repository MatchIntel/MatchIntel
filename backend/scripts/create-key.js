import { pool } from "../src/db.js";
import { createLicenseKey, encryptLicenseKey, parseDuration, randomUuid, sha256 } from "../src/security.js";

const opts = {};
for (let index = 0; index < process.argv.length; index += 1) {
  if (!process.argv[index].startsWith("--")) continue;
  const key = process.argv[index].slice(2);
  opts[key] = process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[++index]
    : "true";
}

const duration = opts.duration || "30d";
const durationTarget = parseDuration(duration);
const plan = durationTarget ? "trial" : "lifetime";
const activationDurationSeconds = durationTarget
  ? Math.max(1, Math.ceil((durationTarget.getTime() - Date.now()) / 1000))
  : null;
const maxDevices = Math.max(1, Number(opts.devices || 1));
const licenseKey = createLicenseKey();
const id = randomUuid();
const features = String(opts.features || "live_lobby,enrichment,history,reports")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

try {
  await pool.query(
    `INSERT INTO licenses(
      id,key_hash,key_prefix,key_ciphertext,plan,expires_at,activation_duration_seconds,
      activated_at,max_devices,features,note
    ) VALUES($1,$2,$3,$4,$5,NULL,$6,NULL,$7,$8,$9)`,
    [
      id,
      sha256(licenseKey),
      licenseKey.slice(0, 12),
      encryptLicenseKey(licenseKey),
      plan,
      activationDurationSeconds,
      maxDevices,
      JSON.stringify(features),
      opts.note || ""
    ]
  );
  console.log(JSON.stringify({
    licenseKey,
    id,
    plan,
    duration,
    pendingActivation: plan === "trial",
    activationDurationSeconds,
    expiresAt: null,
    maxDevices,
    features
  }, null, 2));
} finally {
  await pool.end();
}
