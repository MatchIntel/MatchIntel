import { SlashCommandBuilder } from "discord.js";

const planChoices = [
  { name: "Trial", value: "trial" },
  { name: "Lifetime", value: "lifetime" }
];
const trialChoices = [1, 3, 7, 14, 30].map(days => ({ name: `${days} day${days === 1 ? "" : "s"}`, value: days }));

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
    .setDescription("Show detailed information for a key")
    .addStringOption(option => option.setName("license").setDescription("License UUID, full key, or key prefix").setRequired(true)),

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
    .setName("maintenance")
    .setDescription("Set MatchIntel maintenance state")
    .addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable maintenance").setRequired(true))
    .addStringOption(option => option.setName("message").setDescription("Maintenance message").setMaxLength(500)),

  new SlashCommandBuilder().setName("systemstatus").setDescription("Show backend, license, device, and session totals"),

  new SlashCommandBuilder()
    .setName("auditlog")
    .setDescription("Show recent administrative actions")
    .addStringOption(option => option.setName("action").setDescription("Optional action filter"))
    .addIntegerOption(option => option.setName("limit").setDescription("Entries to show").setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder().setName("bothelp").setDescription("Show the MatchIntel bot command list")
].map(command => command.toJSON());
