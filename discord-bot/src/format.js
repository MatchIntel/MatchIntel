import { EmbedBuilder } from "discord.js";

export const COLORS = {
  blue: 0x168cff,
  green: 0x41d56e,
  yellow: 0xffc857,
  red: 0xff5964,
  purple: 0x8f47ff
};

export function embed(title, fields = [], color = COLORS.blue) {
  return new EmbedBuilder().setTitle(title).setColor(color).addFields(fields).setTimestamp();
}

export function discordTime(value, style = "R") {
  if (!value) return "Lifetime";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function licenseLabel(license) {
  const status = license.isUsable ? "Active" : license.status === "revoked" ? "Revoked" : "Expired";
  return `\`${license.keyPrefix}…\` • **${license.plan}** • ${status} • ${license.deviceCount}/${license.maxDevices} devices • ID \`${license.id}\``;
}

export function licenseFields(license, { showRecoveryNote = false } = {}) {
  const fields = [
    ...(license.fullKey ? [{
      name: "Full license key",
      value: `\`${license.fullKey}\``
    }] : showRecoveryNote ? [{
      name: "Full license key",
      value: "Not recoverable for this older key. Use `/reissuekey` to replace it with a new recoverable key."
    }] : []),
    { name: "Owner", value: license.discordUserId ? `<@${license.discordUserId}> (\`${license.discordUserId}\`)` : "Unlinked" },
    { name: "Plan", value: license.plan, inline: true },
    { name: "Status", value: license.isUsable ? "Active" : license.status, inline: true },
    { name: "Devices", value: `${license.deviceCount}/${license.maxDevices}`, inline: true },
    { name: "Expires", value: discordTime(license.expiresAt), inline: true },
    { name: "Key prefix", value: `\`${license.keyPrefix}…\``, inline: true },
    { name: "License ID", value: `\`${license.id}\`` }
  ];

  if (license.matchedDevice) {
    fields.push(
      { name: "Matched by", value: "Device ID", inline: true },
      { name: "Device name", value: license.matchedDevice.name || "Unknown device", inline: true },
      { name: "Device first used", value: discordTime(license.matchedDevice.firstSeenAt), inline: true },
      { name: "Device last used", value: discordTime(license.matchedDevice.lastSeenAt), inline: true }
    );
  }
  if (license.note) fields.push({ name: "Note", value: license.note.slice(0, 1024) });
  if (license.revokedReason) fields.push({ name: "Revoked reason", value: license.revokedReason.slice(0, 1024) });
  return fields;
}

export function truncate(value, max = 1024) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
