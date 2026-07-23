import { query, tx } from "./db.js";
import { randomUuid } from "./security.js";

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function discordId(value, label = "Discord ID", { allowBlank = false } = {}) {
  const id = clean(value, 40).replace(/[<@!#&>]/g, "");
  if (!id && allowBlank) return "";
  if (!/^\d{15,25}$/.test(id)) throw httpError(400, "MI-DISCORD-ID", `${label} is invalid.`);
  return id;
}

function roleIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw httpError(400, "MI-DISCORD-ROLES", "Ticket staff role IDs must be an array.");
  return [...new Set(value.map(item => discordId(item, "Role ID")).slice(0, 25))];
}

function defaults(guildId) {
  return {
    guildId,
    welcomeChannelId: "",
    autoRoleId: "",
    welcomeTitle: "Welcome to MatchIntel",
    welcomeMessage: "Welcome {member} to **{server}**! You are member **#{memberCount}**. Check the download and support channels to get started.",
    ticketCategoryId: "",
    ticketPanelChannelId: "",
    ticketStaffRoleIds: [],
    updatesChannelId: "",
    updatedAt: null
  };
}

function serialize(row, guildId) {
  if (!row) return defaults(guildId);
  return {
    guildId: row.guild_id,
    welcomeChannelId: row.welcome_channel_id || "",
    autoRoleId: row.auto_role_id || "",
    welcomeTitle: row.welcome_title || defaults(guildId).welcomeTitle,
    welcomeMessage: row.welcome_message || defaults(guildId).welcomeMessage,
    ticketCategoryId: row.ticket_category_id || "",
    ticketPanelChannelId: row.ticket_panel_channel_id || "",
    ticketStaffRoleIds: Array.isArray(row.ticket_staff_role_ids) ? row.ticket_staff_role_ids : [],
    updatesChannelId: row.updates_channel_id || "",
    updatedAt: row.updated_at
  };
}

function sendError(res, error) {
  res.status(error.status || 400).json({ code: error.code || "MI-DISCORD-BOT", message: error.message });
}

export async function getGuildSettings(req, res) {
  try {
    const guildId = discordId(req.params.guildId, "Guild ID");
    const result = await query("SELECT * FROM discord_guild_settings WHERE guild_id=$1", [guildId]);
    res.json({ settings: serialize(result.rows[0], guildId) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function updateGuildSettings(req, res) {
  try {
    const guildId = discordId(req.params.guildId, "Guild ID");
    const actor = clean(req.headers["x-admin-actor"] || "discord-bot", 200);
    const body = req.body || {};
    const existing = await query("SELECT * FROM discord_guild_settings WHERE guild_id=$1", [guildId]);
    const current = serialize(existing.rows[0], guildId);
    const next = {
      ...current,
      ...(Object.hasOwn(body, "welcomeChannelId") ? { welcomeChannelId: discordId(body.welcomeChannelId, "Welcome channel ID", { allowBlank: true }) } : {}),
      ...(Object.hasOwn(body, "autoRoleId") ? { autoRoleId: discordId(body.autoRoleId, "Automatic role ID", { allowBlank: true }) } : {}),
      ...(Object.hasOwn(body, "welcomeTitle") ? { welcomeTitle: clean(body.welcomeTitle, 200) || defaults(guildId).welcomeTitle } : {}),
      ...(Object.hasOwn(body, "welcomeMessage") ? { welcomeMessage: clean(body.welcomeMessage, 2000) || defaults(guildId).welcomeMessage } : {}),
      ...(Object.hasOwn(body, "ticketCategoryId") ? { ticketCategoryId: discordId(body.ticketCategoryId, "Ticket category ID", { allowBlank: true }) } : {}),
      ...(Object.hasOwn(body, "ticketPanelChannelId") ? { ticketPanelChannelId: discordId(body.ticketPanelChannelId, "Ticket panel channel ID", { allowBlank: true }) } : {}),
      ...(Object.hasOwn(body, "ticketStaffRoleIds") ? { ticketStaffRoleIds: roleIds(body.ticketStaffRoleIds) } : {}),
      ...(Object.hasOwn(body, "updatesChannelId") ? { updatesChannelId: discordId(body.updatesChannelId, "Updates channel ID", { allowBlank: true }) } : {})
    };

    const answer = await tx(async client => {
      const changed = await client.query(
        `INSERT INTO discord_guild_settings(
          guild_id,welcome_channel_id,auto_role_id,welcome_title,welcome_message,
          ticket_category_id,ticket_panel_channel_id,ticket_staff_role_ids,updates_channel_id,updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT(guild_id) DO UPDATE SET
          welcome_channel_id=EXCLUDED.welcome_channel_id,
          auto_role_id=EXCLUDED.auto_role_id,
          welcome_title=EXCLUDED.welcome_title,
          welcome_message=EXCLUDED.welcome_message,
          ticket_category_id=EXCLUDED.ticket_category_id,
          ticket_panel_channel_id=EXCLUDED.ticket_panel_channel_id,
          ticket_staff_role_ids=EXCLUDED.ticket_staff_role_ids,
          updates_channel_id=EXCLUDED.updates_channel_id,
          updated_at=NOW()
        RETURNING *`,
        [
          guildId,
          next.welcomeChannelId || null,
          next.autoRoleId || null,
          next.welcomeTitle,
          next.welcomeMessage,
          next.ticketCategoryId || null,
          next.ticketPanelChannelId || null,
          JSON.stringify(next.ticketStaffRoleIds),
          next.updatesChannelId || null
        ]
      );
      await client.query(
        "INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)",
        [randomUuid(), "discord.settings.update", actor, guildId, JSON.stringify({ changedFields: Object.keys(body) })]
      );
      return changed.rows[0];
    });
    res.json({ settings: serialize(answer, guildId) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function claimReleaseAnnouncement(req, res) {
  try {
    const releaseKey = clean(req.body?.releaseKey, 500);
    if (!releaseKey) throw httpError(400, "MI-RELEASE-KEY", "A release key is required.");
    const guildId = discordId(req.body?.guildId, "Guild ID");
    const channelId = discordId(req.body?.channelId, "Channel ID");
    const result = await query(
      `INSERT INTO discord_release_announcements(
        release_key,guild_id,channel_id,version,components,notes
      ) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(release_key) DO NOTHING
      RETURNING release_key`,
      [
        releaseKey,
        guildId,
        channelId,
        clean(req.body?.version, 50) || null,
        clean(req.body?.components, 200) || null,
        clean(req.body?.notes, 4000) || null
      ]
    );
    res.json({ claimed: result.rowCount === 1, releaseKey });
  } catch (error) {
    sendError(res, error);
  }
}
