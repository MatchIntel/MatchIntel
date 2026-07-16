function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function ids(name, requiredValue = false) {
  const raw = requiredValue ? required(name) : (process.env[name] || "");
  return new Set(raw.split(",").map(value => value.trim()).filter(Boolean));
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
  defaultTrialDays: Math.max(1, Math.min(30, Number(process.env.DEFAULT_TRIAL_DAYS || 3)))
};
