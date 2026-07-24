function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function ids(name, requiredValue = false) {
  const raw = requiredValue ? required(name) : (process.env[name] || "");
  return new Set(raw.split(",").map(value => value.trim()).filter(Boolean));
}

function text(name, fallback = "") {
  const value = process.env[name];
  return value == null || String(value).trim() === "" ? fallback : String(value).trim();
}

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: required("DISCORD_GUILD_ID"),
  backendUrl: required("BACKEND_URL").replace(/\/+$/, ""),
  backendAdminKey: required("BACKEND_ADMIN_KEY"),
  owners: ids("OWNER_DISCORD_IDS", true),
  staffRoles: ids("BOT_STAFF_ROLE_IDS"),
  adminRoles: ids("BOT_ADMIN_ROLE_IDS"),
  defaultTrialDays: Math.max(1, Math.min(30, Number(process.env.DEFAULT_TRIAL_DAYS || 3))),
  updatesChannelId: text("MATCHINTEL_UPDATES_CHANNEL_ID", "1529448180213874740"),
  paypalEmail: text("MATCHINTEL_PAYPAL_EMAIL", "liamlifeisgood@gmail.com"),
  releaseVersion: text("MATCHINTEL_RELEASE_VERSION", "0.7.5"),
  releaseComponents: text("MATCHINTEL_RELEASE_COMPONENTS", "Discord bot"),
  releaseNotes: text(
    "MATCHINTEL_RELEASE_NOTES",
    "Purchase tickets now show the official PayPal address and include configurable owner-only payment safety reminders."
  )
};
