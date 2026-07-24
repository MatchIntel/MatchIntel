import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from "discord.js";
import { api } from "./api.js";
import { canUse, accessLevel } from "./access.js";
import { config } from "./config.js";
import { COLORS, discordTime, truncate } from "./format.js";

const settingsCache = new Map();
const SETTINGS_TTL_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanChannelName(value) {
  return String(value || "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "user";
}

function defaultGuildSettings(guildId) {
  return {
    guildId,
    welcomeChannelId: "",
    autoRoleId: "",
    welcomeTitle: "Welcome to MatchIntel",
    welcomeMessage: "Welcome {member} to **{server}**! You are member **#{memberCount}**. Check the download and support channels to get started.",
    ticketCategoryId: "",
    ticketPanelChannelId: "",
    ticketStaffRoleIds: [],
    updatesChannelId: config.updatesChannelId
  };
}

export async function getGuildSettings(guildId, { fresh = false } = {}) {
  const cached = settingsCache.get(guildId);
  if (!fresh && cached && Date.now() - cached.savedAt < SETTINGS_TTL_MS) return cached.value;
  const result = await api(`/v1/admin/discord/guilds/${guildId}/settings`, { actor: "discord-bot" });
  const value = { ...defaultGuildSettings(guildId), ...(result.settings || {}) };
  settingsCache.set(guildId, { value, savedAt: Date.now() });
  return value;
}

async function saveGuildSettings(guildId, patch, actor) {
  const result = await api(`/v1/admin/discord/guilds/${guildId}/settings`, {
    method: "PUT",
    actor,
    body: JSON.stringify(patch)
  });
  const value = { ...defaultGuildSettings(guildId), ...(result.settings || {}) };
  settingsCache.set(guildId, { value, savedAt: Date.now() });
  return value;
}

function welcomeText(template, member) {
  return String(template || "")
    .replaceAll("{member}", `<@${member.id}>`)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", String(member.guild.memberCount));
}

function welcomeEmbed(settings, member) {
  return new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle(settings.welcomeTitle || "Welcome to MatchIntel")
    .setDescription(welcomeText(settings.welcomeMessage, member))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.guild.name} • Member #${member.guild.memberCount}` })
    .setTimestamp();
}

async function sendWelcome(member, settings) {
  if (!settings.welcomeChannelId) return false;
  const channel = member.guild.channels.cache.get(settings.welcomeChannelId)
    || await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") return false;
  await channel.send({
    content: `<@${member.id}>`,
    embeds: [welcomeEmbed(settings, member)],
    allowedMentions: { users: [member.id], roles: [], parse: [] }
  });
  return true;
}

export async function handleSetupWelcome(interaction) {
  const channel = interaction.options.getChannel("channel", true);
  const role = interaction.options.getRole("role", true);
  if (!interaction.guild || role.guild.id !== interaction.guild.id) throw new Error("This command must be used in the MatchIntel server.");
  if (role.id === interaction.guild.id) throw new Error("Choose a normal member role, not @everyone.");
  if (role.managed) throw new Error("That role is managed by another integration and cannot be assigned automatically.");
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  if (role.position >= me.roles.highest.position) {
    throw new Error("Move the MatchIntel Helper role above the automatic role in Server Settings → Roles.");
  }
  const settings = await saveGuildSettings(interaction.guild.id, {
    welcomeChannelId: channel.id,
    autoRoleId: role.id,
    welcomeTitle: interaction.options.getString("title") || "Welcome to MatchIntel",
    welcomeMessage: interaction.options.getString("message") || defaultGuildSettings(interaction.guild.id).welcomeMessage
  }, interaction.user.id);

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.green)
      .setTitle("Welcome system configured")
      .setDescription(`New members will receive ${role} and a welcome message will be sent in ${channel}.`)
      .addFields(
        { name: "Title", value: settings.welcomeTitle },
        { name: "Message", value: truncate(settings.welcomeMessage, 1024) },
        { name: "Placeholders", value: "`{member}` `{server}` `{memberCount}`" }
      )]
  });
}

export async function handleTestWelcome(interaction) {
  const settings = await getGuildSettings(interaction.guildId, { fresh: true });
  if (!settings.welcomeChannelId) throw new Error("Run `/setupwelcome` first.");
  const member = interaction.guild.members.cache.get(interaction.user.id)
    || await interaction.guild.members.fetch(interaction.user.id);
  const sent = await sendWelcome(member, settings);
  if (!sent) throw new Error("The configured welcome channel could not be found or is not writable.");
  await interaction.editReply("Welcome preview sent.");
}

export async function handleGuildMemberAdd(member) {
  if (member.user.bot) return;
  try {
    const settings = await getGuildSettings(member.guild.id);
    if (settings.autoRoleId) {
      const role = member.guild.roles.cache.get(settings.autoRoleId)
        || await member.guild.roles.fetch(settings.autoRoleId).catch(() => null);
      if (role) {
        await member.roles.add(role, "MatchIntel automatic member role").catch(error => {
          console.error(`[welcome-role] Failed for ${member.user.tag}:`, error.message || error);
        });
      }
    }
    await sendWelcome(member, settings);
  } catch (error) {
    console.error(`[welcome] Failed for ${member.user.tag}:`, error.message || error);
  }
}

function ticketTopic(userId, status = "open", claimedBy = "") {
  return `matchintel-ticket:${userId}:${status}${claimedBy ? `:${claimedBy}` : ""}`;
}

function parseTicketTopic(topic) {
  const match = /^matchintel-ticket:(\d{15,25}):(open|closed)(?::(\d{15,25}))?$/.exec(String(topic || ""));
  return match ? { userId: match[1], status: match[2], claimedBy: match[3] || "" } : null;
}

function ticketOpenButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mi_ticket_claim").setLabel("Claim ticket").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mi_ticket_close").setLabel("Close ticket").setStyle(ButtonStyle.Danger)
  );
}

function ticketClosedButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mi_ticket_reopen").setLabel("Reopen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mi_ticket_delete").setLabel("Delete permanently").setStyle(ButtonStyle.Danger)
  );
}

const TICKET_TYPES = Object.freeze({
  general: Object.freeze({
    key: "general",
    buttonId: "mi_ticket_create_general",
    label: "General Support",
    emoji: "🎫",
    style: ButtonStyle.Primary,
    channelPrefix: "general-support",
    title: "General Support Ticket",
    description: "Tell us what you need help with and attach any relevant screenshots or files."
  }),
  purchase: Object.freeze({
    key: "purchase",
    buttonId: "mi_ticket_create_purchase",
    label: "Purchase MatchIntel",
    emoji: "🛒",
    style: ButtonStyle.Success,
    channelPrefix: "purchase",
    title: "Purchase MatchIntel Ticket",
    description: "Tell us what you would like to purchase or ask about plans, payment, or getting started."
  }),
  bug: Object.freeze({
    key: "bug",
    buttonId: "mi_ticket_create_bug",
    label: "Report a Bug",
    emoji: "🐛",
    style: ButtonStyle.Danger,
    channelPrefix: "bug-report",
    title: "Bug Report Ticket",
    description: "Describe the bug, what you expected, what happened, and attach screenshots, logs, or steps to reproduce it."
  })
});

function ticketPanelButtons() {
  return new ActionRowBuilder().addComponents(
    ...Object.values(TICKET_TYPES).map(type => new ButtonBuilder()
      .setCustomId(type.buttonId)
      .setLabel(type.label)
      .setEmoji(type.emoji)
      .setStyle(type.style))
  );
}

function ticketTypeFromCustomId(customId) {
  return Object.values(TICKET_TYPES).find(type => type.buttonId === customId) || TICKET_TYPES.general;
}

export async function handleSetupTickets(interaction) {
  if (!interaction.guild || !interaction.channel || typeof interaction.channel.send !== "function") {
    throw new Error("Run this command in the server channel where the ticket panel should appear.");
  }
  let category = interaction.options.getChannel("category");
  if (!category) {
    category = await interaction.guild.channels.create({
      name: "MatchIntel Tickets",
      type: ChannelType.GuildCategory,
      reason: `Ticket system configured by ${interaction.user.tag}`
    });
  }
  const supportRole = interaction.options.getRole("support_role");
  const modRole = interaction.options.getRole("mod_role");
  if (supportRole?.id === interaction.guild.id || modRole?.id === interaction.guild.id) {
    throw new Error("Do not use @everyone as a ticket staff role.");
  }
  const ticketStaffRoleIds = unique([
    ...config.staffRoles,
    ...config.adminRoles,
    supportRole?.id,
    modRole?.id
  ]);
  await saveGuildSettings(interaction.guild.id, {
    ticketCategoryId: category.id,
    ticketPanelChannelId: interaction.channel.id,
    ticketStaffRoleIds,
    updatesChannelId: config.updatesChannelId
  }, interaction.user.id);

  const panel = await interaction.channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.blue)
      .setTitle(interaction.options.getString("title") || "MatchIntel Support")
      .setDescription(interaction.options.getString("message") || "Choose the option below that best matches what you need. Please open one ticket per issue.")
      .setFooter({ text: "A MatchIntel staff member will respond as soon as possible." })],
    components: [ticketPanelButtons()]
  });
  await interaction.editReply(`Ticket panel created: ${panel.url}`);
}

async function createTicket(interaction, ticketType = TICKET_TYPES.general) {
  const guild = interaction.guild;
  const settings = await getGuildSettings(guild.id, { fresh: true });
  if (!settings.ticketCategoryId) {
    return interaction.reply({ content: "The ticket system has not been configured yet.", ephemeral: true });
  }
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const existing = guild.channels.cache.find(channel => {
    const parsed = parseTicketTopic(channel.topic);
    return parsed?.userId === interaction.user.id && parsed.status === "open";
  });
  if (existing) {
    return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
  }

  const permissionMap = new Map();
  permissionMap.set(guild.roles.everyone.id, { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
  permissionMap.set(interaction.user.id, {
    id: interaction.user.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks
    ]
  });
  permissionMap.set(interaction.client.user.id, {
    id: interaction.client.user.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks
    ]
  });
  for (const id of unique([...settings.ticketStaffRoleIds, ...config.staffRoles, ...config.adminRoles])) {
    if (id === guild.roles.everyone.id || !guild.roles.cache.has(id)) continue;
    permissionMap.set(id, {
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
    });
  }
  for (const ownerId of config.owners) {
    const ownerMember = guild.members.cache.get(ownerId)
      || await guild.members.fetch(ownerId).catch(() => null);
    if (!ownerMember) continue;
    permissionMap.set(ownerId, {
      id: ownerId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
    });
  }

  const base = cleanChannelName(interaction.user.globalName || interaction.user.username);
  const channel = await guild.channels.create({
    name: `${ticketType.channelPrefix}-${base}-${String(Date.now()).slice(-4)}`,
    type: ChannelType.GuildText,
    parent: settings.ticketCategoryId,
    topic: ticketTopic(interaction.user.id),
    permissionOverwrites: [...permissionMap.values()],
    reason: `MatchIntel ${ticketType.label.toLowerCase()} ticket opened by ${interaction.user.tag}`
  });

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [new EmbedBuilder()
      .setColor(COLORS.blue)
      .setTitle(ticketType.title)
      .setDescription(`${ticketType.description} A staff member can claim the ticket and respond here.`)
      .addFields(
        { name: "Ticket type", value: `${ticketType.emoji} ${ticketType.label}`, inline: true },
        { name: "Opened by", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Created", value: discordTime(new Date()), inline: true }
      )
      .setFooter({ text: "Never post your license key publicly. Use /whatsmykey only in the bot's DMs." })],
    components: [ticketOpenButtons()],
    allowedMentions: { users: [interaction.user.id], parse: [] }
  });
  await interaction.reply({ content: `Your private ticket is ready: ${channel}`, ephemeral: true });
}

async function claimTicket(interaction) {
  if (!canUse(interaction, "staff")) return interaction.reply({ content: "Only MatchIntel staff can claim tickets.", ephemeral: true });
  const parsed = parseTicketTopic(interaction.channel?.topic);
  if (!parsed || parsed.status !== "open") return interaction.reply({ content: "This is not an open MatchIntel ticket.", ephemeral: true });
  await interaction.channel.setTopic(ticketTopic(parsed.userId, "open", interaction.user.id));
  await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`✅ Ticket claimed by <@${interaction.user.id}>.`)] });
  await interaction.reply({ content: "Ticket claimed.", ephemeral: true });
}

async function closeTicket(interaction) {
  const parsed = parseTicketTopic(interaction.channel?.topic);
  if (!parsed || parsed.status !== "open") return interaction.reply({ content: "This is not an open MatchIntel ticket.", ephemeral: true });
  const isOwner = parsed.userId === interaction.user.id;
  if (!isOwner && !canUse(interaction, "staff")) return interaction.reply({ content: "Only the ticket opener or MatchIntel staff can close this ticket.", ephemeral: true });
  await interaction.channel.permissionOverwrites.edit(parsed.userId, { ViewChannel: true, SendMessages: false });
  await interaction.channel.setTopic(ticketTopic(parsed.userId, "closed", parsed.claimedBy));
  if (!interaction.channel.name.startsWith("closed-")) await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100));
  await interaction.channel.send({
    embeds: [new EmbedBuilder().setColor(COLORS.yellow).setDescription(`🔒 Ticket closed by <@${interaction.user.id}>.`)],
    components: [ticketClosedButtons()]
  });
  await interaction.reply({ content: "Ticket closed.", ephemeral: true });
}

async function reopenTicket(interaction) {
  if (!canUse(interaction, "staff")) return interaction.reply({ content: "Only MatchIntel staff can reopen tickets.", ephemeral: true });
  const parsed = parseTicketTopic(interaction.channel?.topic);
  if (!parsed || parsed.status !== "closed") return interaction.reply({ content: "This is not a closed MatchIntel ticket.", ephemeral: true });
  await interaction.channel.permissionOverwrites.edit(parsed.userId, { ViewChannel: true, SendMessages: true });
  await interaction.channel.setTopic(ticketTopic(parsed.userId, "open", parsed.claimedBy));
  await interaction.channel.setName(interaction.channel.name.replace(/^closed-/, "").slice(0, 100));
  await interaction.channel.send({
    embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`🔓 Ticket reopened by <@${interaction.user.id}>.`)],
    components: [ticketOpenButtons()]
  });
  await interaction.reply({ content: "Ticket reopened.", ephemeral: true });
}

async function deleteTicket(interaction) {
  if (accessLevel(interaction) !== "owner" && !canUse(interaction, "admin")) {
    return interaction.reply({ content: "Only MatchIntel admins or owners can permanently delete tickets.", ephemeral: true });
  }
  const parsed = parseTicketTopic(interaction.channel?.topic);
  if (!parsed) return interaction.reply({ content: "This is not a MatchIntel ticket.", ephemeral: true });
  await interaction.reply({ content: "Deleting this ticket in 4 seconds…", ephemeral: true });
  setTimeout(() => interaction.channel.delete(`Ticket deleted by ${interaction.user.tag}`).catch(console.error), 4000);
}

export async function handleTicketButton(interaction) {
  switch (interaction.customId) {
    case "mi_ticket_create": return createTicket(interaction, TICKET_TYPES.general); // Backward compatibility for older panels.
    case "mi_ticket_create_general":
    case "mi_ticket_create_purchase":
    case "mi_ticket_create_bug":
      return createTicket(interaction, ticketTypeFromCustomId(interaction.customId));
    case "mi_ticket_claim": return claimTicket(interaction);
    case "mi_ticket_close": return closeTicket(interaction);
    case "mi_ticket_reopen": return reopenTicket(interaction);
    case "mi_ticket_delete": return deleteTicket(interaction);
    default: return false;
  }
}

async function attachmentPayload(attachment) {
  if (!attachment) return null;
  if (attachment.size > MAX_ATTACHMENT_BYTES) throw new Error(`${attachment.name} is larger than the 24 MB bot upload limit.`);
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not download ${attachment.name} from Discord.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error(`${attachment.name} is larger than the 24 MB bot upload limit.`);
  return { attachment: data, name: attachment.name || "attachment" };
}

async function collectAttachments(interaction, names) {
  const files = [];
  let total = 0;
  for (const name of names) {
    const attachment = interaction.options.getAttachment(name);
    if (!attachment) continue;
    total += attachment.size || 0;
    if (total > MAX_ATTACHMENT_BYTES) throw new Error("The combined files are larger than the 24 MB bot upload limit.");
    files.push(await attachmentPayload(attachment));
  }
  return files;
}

export async function handleSendThisMessage(interaction) {
  if (!interaction.channel || typeof interaction.channel.send !== "function") throw new Error("This channel cannot receive bot messages.");
  const message = interaction.options.getString("message") || "";
  const title = interaction.options.getString("title") || "";
  const files = await collectAttachments(interaction, ["file_1", "file_2", "file_3"]);
  if (!message && !title && !files.length) throw new Error("Add a message, title, image, or file.");
  const allowMentions = interaction.options.getBoolean("allow_mentions") === true;
  const payload = {
    files,
    allowedMentions: allowMentions ? { parse: ["users", "roles", "everyone"] } : { parse: [] }
  };
  if (title || message.length > 2000) {
    const builder = new EmbedBuilder()
      .setColor(COLORS.blue)
      .setTitle(title || "MatchIntel")
      .setFooter({ text: "MatchIntel Helper" })
      .setTimestamp();
    if (message) builder.setDescription(message);
    payload.embeds = [builder];
  } else {
    payload.content = message;
  }
  const sent = await interaction.channel.send(payload);
  await interaction.editReply(`Message sent: ${sent.url}`);
}

export async function handlePublishUpdate(interaction) {
  const selected = interaction.options.getChannel("channel");
  const channelId = selected?.id || config.updatesChannelId;
  const channel = selected || await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") throw new Error(`Could not access the updates channel (${channelId}).`);
  const component = interaction.options.getString("component", true);
  const version = interaction.options.getString("version", true);
  const summary = interaction.options.getString("summary", true);
  const files = await collectAttachments(interaction, ["file"]);
  const sent = await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.blue)
      .setTitle(`MatchIntel ${component} update — v${version}`)
      .setDescription(summary)
      .addFields({ name: "Published by", value: `<@${interaction.user.id}>` })
      .setFooter({ text: `MatchIntel release • ${component} • ${version}` })
      .setTimestamp()],
    files,
    allowedMentions: { parse: [] }
  });
  await interaction.editReply(`Update published: ${sent.url}`);
}

export async function handleWhatsMyKey(interaction) {
  if (interaction.inGuild()) {
    return interaction.reply({
      content: "For your security, open my Discord profile, press **Message**, and use `/whatsmykey` in our private DM.",
      ephemeral: true
    });
  }
  await interaction.deferReply();
  const result = await api(`/v1/admin/users/${interaction.user.id}/licenses/reveal`, {
    actor: `discord-self:${interaction.user.id}`
  });
  const licenses = Array.isArray(result.licenses) ? result.licenses : [];
  if (!licenses.length) {
    return interaction.editReply("No MatchIntel key is linked to this Discord account. Open a support ticket if you believe this is incorrect.");
  }
  const ordered = [...licenses].sort((a, b) => Number(Boolean(b.isUsable)) - Number(Boolean(a.isUsable)));
  const embeds = ordered.slice(0, 10).map((license, index) => {
    const status = license.isUsable ? "Active" : license.status === "revoked" ? "Revoked" : "Expired";
    const description = license.fullKey
      ? `\`\`\`text\n${license.fullKey}\n\`\`\``
      : "This older key was issued before secure key recovery was enabled. Staff must reissue it before the complete value can be shown.";
    const builder = new EmbedBuilder()
      .setColor(license.isUsable ? COLORS.green : COLORS.yellow)
      .setTitle(`${license.plan === "lifetime" ? "Lifetime" : "Trial"} MatchIntel key`)
      .setDescription(description)
      .addFields(
        { name: "Status", value: status, inline: true },
        { name: "Expires", value: discordTime(license.expiresAt), inline: true },
        { name: "Devices", value: `${license.deviceCount}/${license.maxDevices}`, inline: true }
      );
    if (index === 0) builder.setAuthor({ name: "PRIVATE — do not share your MatchIntel key with anyone" });
    return builder;
  });
  await interaction.editReply({
    content: "⚠️ **Keep this DM private. Never send your key to another person, post it in a server, or show it on stream.**",
    embeds,
    allowedMentions: { parse: [] }
  });
}

export async function announceReleaseOnce(client) {
  if (!config.updatesChannelId || !config.releaseVersion) return true;
  try {
    const channel = await client.channels.fetch(config.updatesChannelId);
    if (!channel || typeof channel.send !== "function") throw new Error("updates channel is not writable");
    const releaseKey = `${config.releaseComponents}:${config.releaseVersion}:${config.releaseNotes}`.slice(0, 500);
    const claimed = await api("/v1/admin/discord/releases/claim", {
      method: "POST",
      actor: "discord-bot",
      body: JSON.stringify({
        releaseKey,
        guildId: config.guildId,
        channelId: config.updatesChannelId,
        version: config.releaseVersion,
        components: config.releaseComponents,
        notes: config.releaseNotes
      })
    });
    if (!claimed.claimed) return true;
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.blue)
        .setTitle(`MatchIntel update — v${config.releaseVersion}`)
        .setDescription(config.releaseNotes)
        .addFields({ name: "Components", value: config.releaseComponents })
        .setFooter({ text: `MatchIntel automatic release announcement • ${config.releaseVersion}` })
        .setTimestamp()],
      allowedMentions: { parse: [] }
    });
    return true;
  } catch (error) {
    console.error("[release-announcement]", error.message || error);
    return false;
  }
}
