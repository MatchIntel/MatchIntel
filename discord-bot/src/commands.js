import { ChannelType, SlashCommandBuilder } from "discord.js";

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

const commandBuilders = [
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
  ,new SlashCommandBuilder()
    .setName("setupwelcome")
    .setDescription("Configure the MatchIntel welcome message and automatic member role")
    .addChannelOption(option => option.setName("channel").setDescription("Channel that receives welcome messages").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(option => option.setName("role").setDescription("Role automatically added to new members").setRequired(true))
    .addStringOption(option => option.setName("title").setDescription("Welcome embed title").setMaxLength(200))
    .addStringOption(option => option.setName("message").setDescription("Supports {member}, {server}, and {memberCount}").setMaxLength(2000)),

  new SlashCommandBuilder()
    .setName("testwelcome")
    .setDescription("Preview the configured welcome message in the welcome channel"),

  new SlashCommandBuilder()
    .setName("setuptickets")
    .setDescription("Post the MatchIntel ticket-type panel in this channel")
    .addChannelOption(option => option.setName("category").setDescription("Category where private tickets are created").addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption(option => option.setName("support_role").setDescription("Support or staff role that can view tickets"))
    .addRoleOption(option => option.setName("mod_role").setDescription("Moderator role that can view tickets"))
    .addStringOption(option => option.setName("title").setDescription("Ticket panel title").setMaxLength(200))
    .addStringOption(option => option.setName("message").setDescription("Ticket panel instructions").setMaxLength(2000)),

  new SlashCommandBuilder()
    .setName("sendthismessage")
    .setDescription("Send a message or files as MatchIntel Helper in this channel")
    .addStringOption(option => option.setName("message").setDescription("Message text").setMaxLength(4000))
    .addStringOption(option => option.setName("title").setDescription("Optional embed title").setMaxLength(200))
    .addAttachmentOption(option => option.setName("file_1").setDescription("Optional image or file"))
    .addAttachmentOption(option => option.setName("file_2").setDescription("Optional second image or file"))
    .addAttachmentOption(option => option.setName("file_3").setDescription("Optional third image or file"))
    .addBooleanOption(option => option.setName("allow_mentions").setDescription("Allow @everyone, roles, and user mentions in the message")),

  new SlashCommandBuilder()
    .setName("publishupdate")
    .setDescription("Publish a MatchIntel client, backend, bot, or website update")
    .addStringOption(option => option.setName("component").setDescription("What changed").setRequired(true).addChoices(
      { name: "Client", value: "Client" },
      { name: "Backend", value: "Backend" },
      { name: "Discord bot", value: "Discord bot" },
      { name: "Website", value: "Website" },
      { name: "Multiple components", value: "Multiple components" }
    ))
    .addStringOption(option => option.setName("version").setDescription("Version label, such as 0.7.4").setRequired(true).setMaxLength(50))
    .addStringOption(option => option.setName("summary").setDescription("Full update notes").setRequired(true).setMaxLength(4000))
    .addAttachmentOption(option => option.setName("file").setDescription("Optional release file or image"))
    .addChannelOption(option => option.setName("channel").setDescription("Defaults to the configured MatchIntel updates channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
]

export const commands = commandBuilders.map(command => command.toJSON());

export const publicCommands = [
  new SlashCommandBuilder()
    .setName("whatsmykey")
    .setDescription("Privately show every MatchIntel key linked to your Discord account")
    .setDMPermission(true)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("whatsmytrialkey")
    .setDescription("Recover the exact free-trial key issued to you by the MatchIntel website")
    .setDMPermission(true)
    .toJSON()
];
