import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands.js";
import { api } from "./api.js";
import { canUse, accessLevel } from "./access.js";
import { COLORS, discordTime, embed, licenseFields, licenseLabel, truncate } from "./format.js";

const ADMIN_COMMANDS = new Set([
  "revokekey", "revokeuser", "restorekey", "convertkey", "transferkey",
  "deletekey", "extendkey", "extendallkeys", "maintenance", "setversion", "auditlog"
]);
const OWNER_ONLY_COMMANDS = new Set(["deleteallkeys", "setversion"]);

await new REST({ version: "10" })
  .setToken(config.token)
  .put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function username(user) {
  return user.globalName || user.username;
}

async function deny(interaction, message) {
  const payload = { content: message, ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function handleGenKey(interaction) {
  const target = interaction.options.getUser("user", true);
  if (target.bot) throw new Error("Keys cannot be linked to bot accounts.");
  const plan = interaction.options.getString("plan", true);
  const trialDays = interaction.options.getInteger("trial_days") || config.defaultTrialDays;
  const maxDevices = interaction.options.getInteger("devices") || 1;
  const note = interaction.options.getString("note") || "";
  const result = await api("/v1/admin/licenses", {
    method: "POST",
    actor: interaction.user.id,
    body: JSON.stringify({
      plan, trialDays, maxDevices, note,
      discordUserId: target.id,
      discordUsername: username(target),
      issuedByDiscordId: interaction.user.id
    })
  });
  const expires = result.license.expiresAt ? discordTime(result.license.expiresAt) : "Lifetime";
  const customerEmbed = embed("Your MatchIntel license", [
    { name: "License key", value: `\`${result.licenseKey}\`` },
    { name: "Plan", value: result.license.plan, inline: true },
    { name: "Devices", value: String(result.license.maxDevices), inline: true },
    { name: "Expires", value: expires, inline: true },
    { name: "Linked Discord account", value: `<@${target.id}>` },
    { name: "Keep this private", value: "Do not post or share this key. It is linked to your Discord account." }
  ], COLORS.purple);
  let delivery = "Sent by DM.";
  try { await target.send({ embeds: [customerEmbed] }); }
  catch { delivery = "DM failed. Copy the key below and send it securely."; }
  return interaction.editReply({ embeds: [embed("MatchIntel key generated", [
    { name: "Customer", value: `${target} (\`${target.id}\`)` },
    { name: "Key", value: `\`${result.licenseKey}\`` },
    { name: "License ID", value: `\`${result.license.id}\`` },
    { name: "Plan", value: result.license.plan, inline: true },
    { name: "Devices", value: String(result.license.maxDevices), inline: true },
    { name: "Expires", value: expires, inline: true },
    { name: "Delivery", value: delivery }
  ], COLORS.green)] });
}

async function handleKeyInfo(interaction) {
  const ref = interaction.options.getString("license", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}`, { actor: interaction.user.id });
  return interaction.editReply({ embeds: [embed("MatchIntel key information", licenseFields(result.license), COLORS.blue)] });
}

async function handleFindUser(interaction) {
  const target = interaction.options.getUser("user", true);
  const result = await api(`/v1/admin/users/${target.id}/licenses`, { actor: interaction.user.id });
  const lines = result.licenses.slice(0, 20).map(licenseLabel);
  return interaction.editReply({ embeds: [embed(`Keys linked to ${username(target)}`, [
    { name: "Discord account", value: `${target} (\`${target.id}\`)` },
    { name: `Licenses (${result.licenses.length})`, value: truncate(lines.join("\n") || "No licenses found.", 4000) }
  ], lines.length ? COLORS.blue : COLORS.yellow)] });
}

async function handleListKeys(interaction) {
  const status = interaction.options.getString("status") || "";
  const plan = interaction.options.getString("plan") || "";
  const limit = interaction.options.getInteger("limit") || 15;
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  if (plan) params.set("plan", plan);
  const result = await api(`/v1/admin/licenses?${params}`, { actor: interaction.user.id });
  const lines = result.licenses.map(license => `${licenseLabel(license)}${license.discordUserId ? ` • <@${license.discordUserId}>` : " • Unlinked"}`);
  return interaction.editReply({ embeds: [embed("Recent MatchIntel keys", [
    { name: `Results (${result.licenses.length})`, value: truncate(lines.join("\n") || "No licenses found.", 4000) }
  ])] });
}

async function handleResetDevices(interaction) {
  if (interaction.options.getSubcommand() === "user") {
    const target = interaction.options.getUser("user", true);
    const result = await api(`/v1/admin/users/${target.id}/reset-devices`, {
      method: "POST", actor: interaction.user.id, body: "{}"
    });
    return interaction.editReply({ embeds: [embed("User devices reset", [
      { name: "Customer", value: `${target} (\`${target.id}\`)` },
      { name: "Licenses affected", value: String(result.licensesAffected), inline: true },
      { name: "Devices removed", value: String(result.devicesRemoved), inline: true },
      { name: "Sessions revoked", value: String(result.refreshTokensRevoked), inline: true },
      { name: "Result", value: "The customer can activate MatchIntel again immediately." }
    ], COLORS.green)] });
  }
  const ref = interaction.options.getString("license", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/reset-devices`, {
    method: "POST", actor: interaction.user.id, body: "{}"
  });
  return interaction.editReply({ embeds: [embed("License devices reset", [
    { name: "License ID", value: `\`${result.license.id}\`` },
    { name: "Owner", value: result.license.discordUserId ? `<@${result.license.discordUserId}>` : "Unlinked" },
    { name: "Devices removed", value: String(result.devicesRemoved), inline: true },
    { name: "Sessions revoked", value: String(result.refreshTokensRevoked), inline: true }
  ], COLORS.green)] });
}

async function handleDevices(interaction) {
  const ref = interaction.options.getString("license", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/devices`, { actor: interaction.user.id });
  const lines = result.devices.map((device, index) =>
    `**${index + 1}. ${device.name}**\n${device.hash} • Last used ${discordTime(device.lastSeenAt)}`
  );
  return interaction.editReply({ embeds: [embed("Bound devices", [
    { name: "License", value: `\`${result.license.id}\`` },
    { name: `Devices (${result.devices.length}/${result.license.maxDevices})`, value: truncate(lines.join("\n\n") || "No devices are currently bound.", 4000) }
  ])] });
}

async function handleRevokeKey(interaction) {
  const ref = interaction.options.getString("license", true);
  const reason = interaction.options.getString("reason", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/revoke`, {
    method: "POST", actor: interaction.user.id, body: JSON.stringify({ reason })
  });
  return interaction.editReply({ embeds: [embed("Key revoked", licenseFields(result.license), COLORS.red)] });
}

async function handleRevokeUser(interaction) {
  const target = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const result = await api(`/v1/admin/users/${target.id}/revoke`, {
    method: "POST", actor: interaction.user.id, body: JSON.stringify({ reason })
  });
  return interaction.editReply({ embeds: [embed("User licenses revoked", [
    { name: "Customer", value: `${target} (\`${target.id}\`)` },
    { name: "Licenses revoked", value: String(result.licensesRevoked), inline: true },
    { name: "Reason", value: reason }
  ], COLORS.red)] });
}

async function handleRestore(interaction) {
  const ref = interaction.options.getString("license", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/restore`, {
    method: "POST", actor: interaction.user.id, body: "{}"
  });
  return interaction.editReply({ embeds: [embed("Key restored", licenseFields(result.license), COLORS.green)] });
}

async function handleConvert(interaction) {
  const ref = interaction.options.getString("license", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/convert-lifetime`, {
    method: "POST", actor: interaction.user.id, body: "{}"
  });
  return interaction.editReply({ embeds: [embed("Key converted to lifetime", licenseFields(result.license), COLORS.purple)] });
}

async function handleTransfer(interaction) {
  const ref = interaction.options.getString("license", true);
  const target = interaction.options.getUser("user", true);
  if (target.bot) throw new Error("Keys cannot be transferred to bot accounts.");
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/transfer`, {
    method: "POST",
    actor: interaction.user.id,
    body: JSON.stringify({ discordUserId: target.id, discordUsername: username(target) })
  });
  return interaction.editReply({ embeds: [embed("Key ownership transferred", licenseFields(result.license), COLORS.purple)] });
}

async function handleDeleteKey(interaction) {
  if (interaction.options.getString("confirmation", true) !== "DELETE KEY") {
    throw new Error("Confirmation must exactly equal DELETE KEY.");
  }
  const ref = interaction.options.getString("license", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}`, {
    method: "DELETE", actor: interaction.user.id
  });
  return interaction.editReply({ embeds: [embed("Key permanently deleted", [
    { name: "License ID", value: `\`${result.deleted.id}\`` },
    { name: "Key prefix", value: `\`${result.deleted.keyPrefix}…\`` },
    { name: "Owner", value: result.deleted.discordUserId ? `<@${result.deleted.discordUserId}>` : "Unlinked" },
    { name: "Devices deleted", value: String(result.deleted.devicesDeleted), inline: true },
    { name: "Sessions deleted", value: String(result.deleted.refreshTokensDeleted), inline: true },
    { name: "Warning", value: "This deletion is permanent and cannot be restored." }
  ], COLORS.red)] });
}

async function handleDeleteAll(interaction) {
  const confirmation = interaction.options.getString("confirmation", true);
  if (confirmation !== "DELETE ALL KEYS") throw new Error("Confirmation must exactly equal DELETE ALL KEYS.");
  const scope = interaction.options.getString("scope", true);
  const result = await api("/v1/admin/licenses/bulk-delete", {
    method: "POST",
    actor: interaction.user.id,
    timeoutMs: 60000,
    body: JSON.stringify({ scope, confirmation })
  });
  return interaction.editReply({ embeds: [embed("Bulk key deletion completed", [
    { name: "Scope", value: result.scope, inline: true },
    { name: "Licenses deleted", value: String(result.licensesDeleted), inline: true },
    { name: "Devices deleted", value: String(result.devicesDeleted), inline: true },
    { name: "Refresh sessions deleted", value: String(result.refreshTokensDeleted), inline: true },
    { name: "Warning", value: "Deleted keys are permanently removed and cannot be restored." }
  ], COLORS.red)] });
}

async function handleExtendKey(interaction) {
  const ref = interaction.options.getString("license", true);
  const days = interaction.options.getInteger("days", true);
  const result = await api(`/v1/admin/licenses/${encodeURIComponent(ref)}/extend`, {
    method: "POST", actor: interaction.user.id, body: JSON.stringify({ days })
  });
  return interaction.editReply({ embeds: [embed(`Trial extended by ${days} days`, licenseFields(result.license), COLORS.green)] });
}

async function handleExtendAll(interaction) {
  const days = interaction.options.getInteger("days", true);
  const scope = interaction.options.getString("scope", true);
  const result = await api("/v1/admin/licenses/bulk-extend", {
    method: "POST", actor: interaction.user.id, timeoutMs: 60000,
    body: JSON.stringify({ days, scope })
  });
  return interaction.editReply({ embeds: [embed("Bulk trial extension completed", [
    { name: "Scope", value: result.scope, inline: true },
    { name: "Days added", value: String(result.days), inline: true },
    { name: "Licenses extended", value: String(result.licensesExtended), inline: true },
    { name: "Previously expired", value: String(result.previouslyExpired), inline: true },
    { name: "Revoked included", value: String(result.revokedIncluded), inline: true },
    { name: "Note", value: "Lifetime keys were skipped because they never expire. Extending a revoked key does not restore it." }
  ], COLORS.green)] });
}

async function handleMaintenance(interaction) {
  const result = await api("/v1/admin/maintenance", {
    method: "POST",
    actor: interaction.user.id,
    body: JSON.stringify({
      enabled: interaction.options.getBoolean("enabled", true),
      message: interaction.options.getString("message") || undefined
    })
  });
  return interaction.editReply({ embeds: [embed("Maintenance updated", [
    { name: "State", value: result.enabled ? "Enabled" : "Disabled", inline: true },
    { name: "Message", value: result.message || "No message" },
    { name: "Result", value: result.note }
  ], result.enabled ? COLORS.yellow : COLORS.green)] });
}

async function handleSetVersion(interaction) {
  const minimumVersion = interaction.options.getString("minimum", true).trim();
  const latestVersion = (interaction.options.getString("latest") || minimumVersion).trim();
  const forceUpdate = interaction.options.getBoolean("force_update", true);
  const updateUrl = interaction.options.getString("update_url") || "";
  const message = interaction.options.getString("message") || "";
  const result = await api("/v1/admin/version", {
    method: "POST",
    actor: interaction.user.id,
    body: JSON.stringify({ minimumVersion, latestVersion, forceUpdate, updateUrl, message })
  });
  const version = result.version;
  return interaction.editReply({ embeds: [embed("MatchIntel version control updated", [
    { name: "Minimum allowed", value: `\`${version.minimumVersion}\``, inline: true },
    { name: "Latest available", value: `\`${version.latestVersion}\``, inline: true },
    { name: "Force update", value: version.forceUpdate ? "Enabled" : "Disabled", inline: true },
    { name: "Update URL", value: version.updateUrl || "Not configured" },
    { name: "User message", value: version.message },
    { name: "Important", value: "Clients with the 0.3.9+ force-update controller will immediately block when below the minimum version." }
  ], version.forceUpdate ? COLORS.red : COLORS.green)] });
}

async function handleVersionStatus(interaction) {
  const result = await api("/v1/admin/version", { actor: interaction.user.id });
  const version = result.version;
  return interaction.editReply({ embeds: [embed("MatchIntel version control", [
    { name: "Minimum allowed", value: `\`${version.minimumVersion}\``, inline: true },
    { name: "Latest available", value: `\`${version.latestVersion}\``, inline: true },
    { name: "Force update", value: version.forceUpdate ? "Enabled" : "Disabled", inline: true },
    { name: "Update URL", value: version.updateUrl || "Not configured" },
    { name: "Message", value: version.message },
    { name: "Last changed", value: version.updatedAt ? discordTime(version.updatedAt) : "Using Railway defaults" }
  ], version.forceUpdate ? COLORS.yellow : COLORS.blue)] });
}

async function handleSystemStatus(interaction) {
  const result = await api("/v1/admin/status", { actor: interaction.user.id });
  return interaction.editReply({ embeds: [embed("MatchIntel system status", [
    { name: "Backend", value: result.status, inline: true },
    { name: "Latest version", value: result.version, inline: true },
    { name: "Minimum version", value: result.minimumVersion, inline: true },
    { name: "Force update", value: result.forceUpdate ? "Enabled" : "Disabled", inline: true },
    { name: "Maintenance", value: result.maintenance ? "Enabled" : "Disabled", inline: true },
    { name: "Total licenses", value: String(result.totalLicenses), inline: true },
    { name: "Active licenses", value: String(result.activeLicenses), inline: true },
    { name: "Lifetime", value: String(result.activeLifetime), inline: true },
    { name: "Trials", value: String(result.activeTrial), inline: true },
    { name: "Revoked", value: String(result.revokedLicenses), inline: true },
    { name: "Discord linked", value: String(result.linkedLicenses), inline: true },
    { name: "Devices", value: String(result.devices), inline: true },
    { name: "Sessions", value: String(result.sessions), inline: true }
  ], COLORS.green)] });
}

async function handleAuditLog(interaction) {
  const params = new URLSearchParams({ limit: String(interaction.options.getInteger("limit") || 10) });
  const action = interaction.options.getString("action");
  if (action) params.set("action", action);
  const result = await api(`/v1/admin/audit?${params}`, { actor: interaction.user.id });
  const lines = result.entries.map(entry =>
    `**${entry.action}** • ${discordTime(entry.created_at)}\nActor: \`${entry.actor || "unknown"}\` • Target: \`${entry.target || "none"}\``
  );
  return interaction.editReply({ embeds: [embed("Recent MatchIntel audit log", [
    { name: `Entries (${result.entries.length})`, value: truncate(lines.join("\n\n") || "No entries found.", 4000) }
  ], COLORS.yellow)] });
}

async function handleHelp(interaction) {
  return interaction.editReply({ embeds: [embed("MatchIntel bot commands", [
    { name: "Staff", value: "`/genkey` `/keyinfo` `/finduser` `/listkeys` `/resetdevices` `/devices` `/versionstatus` `/systemstatus`" },
    { name: "Admin", value: "`/revokekey` `/revokeuser` `/restorekey` `/convertkey` `/transferkey` `/deletekey` `/extendkey` `/extendallkeys` `/maintenance` `/auditlog`" },
    { name: "Owner only", value: "`/deleteallkeys` `/setversion`" },
    { name: "Your access", value: accessLevel(interaction) },
    { name: "Deletion safety", value: "Revoking disables a key but keeps its record. Deleting permanently removes it and cannot be undone." }
  ])] });
}

const handlers = {
  genkey: handleGenKey,
  keyinfo: handleKeyInfo,
  finduser: handleFindUser,
  listkeys: handleListKeys,
  resetdevices: handleResetDevices,
  devices: handleDevices,
  revokekey: handleRevokeKey,
  revokeuser: handleRevokeUser,
  restorekey: handleRestore,
  convertkey: handleConvert,
  transferkey: handleTransfer,
  deletekey: handleDeleteKey,
  deleteallkeys: handleDeleteAll,
  extendkey: handleExtendKey,
  extendallkeys: handleExtendAll,
  maintenance: handleMaintenance,
  setversion: handleSetVersion,
  versionstatus: handleVersionStatus,
  systemstatus: handleSystemStatus,
  auditlog: handleAuditLog,
  bothelp: handleHelp
};

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!canUse(interaction, "staff")) {
    return deny(interaction, "You need the configured MatchIntel staff role to use this bot.");
  }
  if (ADMIN_COMMANDS.has(interaction.commandName) && !canUse(interaction, "admin")) {
    return deny(interaction, "This command requires the configured MatchIntel admin role.");
  }
  if (OWNER_ONLY_COMMANDS.has(interaction.commandName) && accessLevel(interaction) !== "owner") {
    return deny(interaction, "This destructive global command is restricted to MatchIntel owner IDs.");
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const handler = handlers[interaction.commandName];
    if (!handler) return interaction.editReply("Unknown command.");
    await handler(interaction);
  } catch (error) {
    console.error(`Command ${interaction.commandName} failed`, error);
    const code = error.code ? ` (${error.code})` : "";
    await interaction.editReply(`Error${code}: ${error.message || "Unknown error"}`);
  }
});

client.once("ready", () => {
  console.log(`MatchIntel bot 0.5.0 logged in as ${client.user.tag}`);
  console.log(`Registered ${commands.length} guild commands in ${config.guildId}`);
  if (!config.staffRoles.size) console.warn("BOT_STAFF_ROLE_IDS is empty. Only owners/admin-role users can access commands.");
});

client.login(config.token);
