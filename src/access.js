import { config } from "./config.js";

function memberRoleIds(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return new Set();
  if (roles.cache?.keys) return new Set(roles.cache.keys());
  if (Array.isArray(roles)) return new Set(roles);
  return new Set();
}

export function accessLevel(interaction) {
  if (config.owners.has(interaction.user.id)) return "owner";
  const roles = memberRoleIds(interaction);
  if ([...config.adminRoles].some(id => roles.has(id))) return "admin";
  if ([...config.staffRoles].some(id => roles.has(id))) return "staff";
  return "none";
}

export function canUse(interaction, required = "staff") {
  const level = accessLevel(interaction);
  const score = { none: 0, staff: 1, admin: 2, owner: 3 };
  return score[level] >= score[required];
}
