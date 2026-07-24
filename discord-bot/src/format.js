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

export function durationText(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "Not configured";
  const units = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [604_800, "week"],
    [86_400, "day"],
    [3_600, "hour"]
  ];
  for (const [size, name] of units) {
    if (value % size === 0) {
      const amount = value / size;
      return `${amount} ${name}${amount === 1 ? "" : "s"}`;
    }
  }
  return `${Math.round(value / 3600)} hours`;
}

export function licenseStatusText(license) {
  if (license.status === "revoked") return "Revoked";
  if (license.pendingActivation) return "Awaiting first activation";
  if (license.expiresAt && new Date(license.expiresAt) <= new Date()) return "Expired";
  return "Active";
}

export function licenseExpiryText(license) {
  if (license.plan === "lifetime") return "Lifetime";
  if (license.pendingActivation) return "Starts on first successful app activation";
  return license.expiresAt ? discordTime(license.expiresAt) : "Not activated";
}

export function licenseLabel(license) {
  return `\`${license.keyPrefix}…\` • **${license.plan}** • ${licenseStatusText(license)} • ${license.deviceCount}/${license.maxDevices} devices • ID \`${license.id}\``;
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
    { name: "Status", value: licenseStatusText(license), inline: true },
    { name: "Devices", value: `${license.deviceCount}/${license.maxDevices}`, inline: true },
    { name: "Expires", value: licenseExpiryText(license), inline: true },
    { name: "Key prefix", value: `\`${license.keyPrefix}…\``, inline: true },
    { name: "License ID", value: `\`${license.id}\`` }
  ];

  if (license.plan === "trial" && license.activationDurationSeconds) {
    fields.splice(4, 0, {
      name: "Timed access",
      value: durationText(license.activationDurationSeconds),
      inline: true
    });
  }
  if (license.activatedAt) {
    fields.push({ name: "First activated", value: discordTime(license.activatedAt), inline: true });
  }
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
