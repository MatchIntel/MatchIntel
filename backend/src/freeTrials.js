import { tx } from "./db.js";
import { config } from "./config.js";
import { createLicenseKey, encryptLicenseKey, randomUuid, sha256 } from "./security.js";

const ALL_FEATURES = ["live_lobby", "enrichment", "history", "reports"];

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function discordIdFrom(value) {
  const id = clean(value, 40).replace(/[<@!>]/g, "");
  if (!/^\d{15,25}$/.test(id)) {
    throw httpError(400, "MI-TRIAL-DISCORD-ID", "A valid Discord user ID is required.");
  }
  return id;
}

async function audit(client, action, actor, target, details) {
  await client.query(
    "INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)",
    [randomUuid(), action, actor, target, JSON.stringify(details)]
  );
}

export async function issueWebsiteTrial(req, res) {
  try {
    const discordUserId = discordIdFrom(req.body?.discordUserId);
    const discordUsername = clean(req.body?.discordUsername || discordUserId, 100);
    const days = config.freeTrialDays;
    const licenseKey = createLicenseKey();
    const licenseId = randomUuid();
    const claimId = randomUuid();
    const expiresAt = new Date(Date.now() + days * 86_400_000);

    const result = await tx(async client => {
      // Prevent two simultaneous OAuth callbacks for the same Discord account.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`website-trial-discord:${discordUserId}`]
      );

      const existing = await client.query(
        "SELECT license_id,created_at FROM website_trial_claims WHERE discord_user_id=$1 LIMIT 1",
        [discordUserId]
      );
      if (existing.rowCount) {
        throw httpError(
          409,
          "MI-TRIAL-DISCORD-USED",
          "This Discord account has already received a MatchIntel free trial."
        );
      }

      await client.query(
        `INSERT INTO licenses(
          id,key_hash,key_prefix,key_ciphertext,plan,status,expires_at,max_devices,features,note,
          discord_user_id,discord_username,issued_by_discord_id,is_free_trial
        ) VALUES($1,$2,$3,$4,'trial','active',$5,1,$6,$7,$8,$9,$8,TRUE)`,
        [
          licenseId,
          sha256(licenseKey),
          licenseKey.slice(0, 12),
          encryptLicenseKey(licenseKey),
          expiresAt,
          JSON.stringify(ALL_FEATURES),
          "Automatically issued by the MatchIntel website free-trial flow.",
          discordUserId,
          discordUsername
        ]
      );

      await client.query(
        `INSERT INTO website_trial_claims(
          id,discord_user_id,discord_username,license_id
        ) VALUES($1,$2,$3,$4)`,
        [claimId, discordUserId, discordUsername, licenseId]
      );

      await audit(client, "website.free_trial.issue", discordUserId, licenseId, {
        discordUsername,
        days,
        deviceBinding: "on-first-app-activation"
      });

      return {
        licenseKey,
        license: {
          id: licenseId,
          plan: "trial",
          isFreeTrial: true,
          status: "active",
          expiresAt,
          maxDevices: 1,
          features: ALL_FEATURES,
          discordUserId,
          discordUsername
        }
      };
    });

    res.status(201).json({ ok: true, trialDays: days, ...result });
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({
        code: "MI-TRIAL-DISCORD-USED",
        message: "This Discord account has already received a MatchIntel free trial."
      });
    }
    res.status(error.status || 500).json({
      code: error.code || "MI-TRIAL-ISSUE-FAILED",
      message: error.status ? error.message : "The free trial could not be created."
    });
  }
}
