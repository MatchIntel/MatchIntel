import { SlashCommandBuilder } from "discord.js";

const planChoices = [
  { name: "Trial", value: "trial" },
  { name: "Lifetime", value: "lifetime" }
];
const trialChoices = [1, 3, 7, 14, 30].map(days => ({
  name: `${days} day${days === 1 ? "" : "s"}`,
  value: days
}));
const deletionScopes = [
  { name: "Every key", value: "all" },
  { name: "Revoked keys only", value: "revoked" },
  { name: "Expired trials only", value: "expired" },
  { name: "Currently active keys", value: "active" },
  { name: "All trial keys", value: "trial" },
  { name: "All lifetime keys", value: "lifetime" }
];
const extensionScopes = [
  { name: "All trial keys", value: "all" },
  { name: "Active trials only", value: "active" },
  { name: "Expired trials only", value: "expired" },
  { name: "Revoked trials only", value: "revoked" }
];

export const commands = [
  new SlashCommandBuilder()
    .setName("genkey")
    .setDescription("Generate a Discord-linked MatchIntel key")
    .addUserOption(option => option.setName("user").setDescription("Discord account that will own the key").setRequired(true))
    .addStringOption(option => option.setName("plan").setDescription("License plan").setRequired(true).addChoices(...planChoices))
    .addIntegerOption(option => option.setName("trial_days").setDescription("Trial length; ignored for lifetime").addChoices(...trialChoices))
    .addIntegerOption(option => option.setName("devices").setDescription("Maximum devices").setMinValue(1).setMaxValue(25))
    .addStringOption(option => option.setName("note").setDescription("Private staff note").setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("keyinfo")
    .setDescription("Find a key using a license value or Device ID")
    .addStringOption(option => option.setName("reference").setDescription("Full key, key prefix, license ID, or Device ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("reissuekey")
    .setDescription("Replace an older key and reveal the new full key")
    .addStringOption(option => option.setName("reference").setDescription("License ID, full key, key prefix, or Device ID").setRequired(true))
    .addStringOption(option => option.setName("confirmation").setDescription("Type REISSUE KEY exactly").setRequired(true)),

  new SlashCommandBuilder()
    .setName("finduser")
    .setDescription("Show every key linked to a Discord account")
    .addUserOption(option => option.setName("user").setDescription("Discord account").setRequired(true)),

  new SlashCommandBuilder()
    .setName("listkeys")
    .setDescription("List recent MatchIntel keys")
    .addStringOption(option => option.setName("status").setDescription("Filter by status").addChoices(
      { name: "Active", value: "active" }, { name: "Revoked", value: "revoked" }
    ))
    .addStringOption(option => option.setName("plan").setDescription("Filter by plan").addChoices(...planChoices))
    .addIntegerOption(option => option.setName("limit").setDescription("Number to show").setMinValue(1).setMaxValue(25)),

  new SlashCommandBuilder()
    .setName("resetdevices")
    .setDescription("Reset device bindings so a customer can activate again")
    .addSubcommand(sub => sub.setName("key").setDescription("Reset one license").addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true)))
    .addSubcommand(sub => sub.setName("user").setDescription("Reset every license linked to a user").addUserOption(option => option.setName("user").setDescription("Discord account").setRequired(true))),

  new SlashCommandBuilder()
    .setName("devices")
    .setDescription("List devices currently bound to a key")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true)),

  new SlashCommandBuilder()
    .setName("revokekey")
    .setDescription("Revoke one MatchIntel key")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true))
    .addStringOption(option => option.setName("reason").setDescription("Reason for revocation").setRequired(true).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName("revokeuser")
    .setDescription("Revoke every key linked to a Discord account")
    .addUserOption(option => option.setName("user").setDescription("Discord account").setRequired(true))
    .addStringOption(option => option.setName("reason").setDescription("Reason for revocation").setRequired(true).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName("restorekey")
    .setDescription("Restore a revoked, unexpired key")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true)),

  new SlashCommandBuilder()
    .setName("convertkey")
    .setDescription("Convert a trial key to lifetime")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true)),

  new SlashCommandBuilder()
    .setName("transferkey")
    .setDescription("Transfer a key to another Discord account")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true))
    .addUserOption(option => option.setName("user").setDescription("New Discord owner").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deletekey")
    .setDescription("Permanently delete one MatchIntel key")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true))
    .addStringOption(option => option.setName("confirmation").setDescription("Type DELETE KEY exactly").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deleteallkeys")
    .setDescription("Permanently delete a selected group of keys")
    .addStringOption(option => option.setName("scope").setDescription("Which keys to delete").setRequired(true).addChoices(...deletionScopes))
    .addStringOption(option => option.setName("confirmation").setDescription("Type DELETE ALL KEYS exactly").setRequired(true)),

  new SlashCommandBuilder()
    .setName("extendkey")
    .setDescription("Add days to one trial key")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or prefix").setRequired(true))
    .addIntegerOption(option => option.setName("days").setDescription("Days to add").setRequired(true).setMinValue(1).setMaxValue(3650)),

  new SlashCommandBuilder()
    .setName("extendallkeys")
    .setDescription("Add days to a selected group of trial keys")
    .addIntegerOption(option => option.setName("days").setDescription("Days to add").setRequired(true).setMinValue(1).setMaxValue(3650))
    .addStringOption(option => option.setName("scope").setDescription("Which trial keys to extend").setRequired(true).addChoices(...extensionScopes)),

  new SlashCommandBuilder()
    .setName("maintenance")
    .setDescription("Set MatchIntel maintenance state")
    .addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable maintenance").setRequired(true))
    .addStringOption(option => option.setName("message").setDescription("Maintenance message").setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("setversion")
    .setDescription("Set MatchIntel minimum/latest versions and force-update state")
    .addStringOption(option => option.setName("minimum").setDescription("Minimum allowed version, such as 0.3.9").setRequired(true))
    .addBooleanOption(option => option.setName("force_update").setDescription("Block clients below minimum").setRequired(true))
    .addStringOption(option => option.setName("latest").setDescription("Newest available version; defaults to minimum"))
    .addStringOption(option => option.setName("update_url").setDescription("Page or download URL shown to outdated users").setMaxLength(1000))
    .addStringOption(option => option.setName("message").setDescription("Message shown to outdated users").setMaxLength(500)),

  new SlashCommandBuilder().setName("versionstatus").setDescription("Show current MatchIntel version-control settings"),
  new SlashCommandBuilder().setName("systemstatus").setDescription("Show backend, license, device, session, and version totals"),

  new SlashCommandBuilder()
    .setName("auditlog")
    .setDescription("Show recent administrative actions")
    .addStringOption(option => option.setName("action").setDescription("Optional action filter"))
    .addIntegerOption(option => option.setName("limit").setDescription("Entries to show").setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder().setName("bothelp").setDescription("Show the MatchIntel bot command list")
].map(command => command.toJSON());
