import { AttachmentBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { canUse } from './access.js';

const keyPattern = /^QT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/;
const batchPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function websiteKeysText(keys) {
  if (!Array.isArray(keys) || keys.length > 1000 || keys.some(key => typeof key !== 'string' || !keyPattern.test(key)) || new Set(keys).size !== keys.length) throw new Error('The backend returned an invalid website-key export. Use /websitebatches to recover the batch.');
  return keys.length ? keys.join('\r\n') + '\r\n' : '';
}
const planLabel = b => b.plan === 'lifetime' ? 'Lifetime' : `${Math.round(b.durationSeconds / 86400)} days from first activation`;
const safe = text => escapeMarkdown(String(text)).replace(/@/g, '@\u200b');
const e = (title, description) => new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x42d6aa).setTimestamp();

export function createWebsiteKeyHandlers({ request = api, authorize = canUse, guildId = config.guildId } = {}) {
  const check = i => {
    if (!i.guildId || i.guildId !== guildId) throw new Error('Website-key commands are only available in the configured Quilted Tweaks server.');
    if (!authorize(i, 'admin')) throw new Error('Website-key generation and exports require the configured admin role or an owner account.');
  };
  const call = (i, suffix, options = {}) => request('/v1/admin/website-keys/batches' + suffix, { actor: i.user.id, ...options });
  async function sendExport(i, result, generated = false) {
    const b = result.batch;
    if (!b || !batchPattern.test(b.id)) throw new Error('The backend returned an invalid batch ID. Use /websitebatches to recover it.');
    try {
      const content = websiteKeysText(result.keys);
      const warning = result.unusedOnly === false ? '\n**Full recovery export:** this can include already used, linked, or revoked keys. Do not import it as fresh stock.' : '\nOnly active, unactivated, unlinked keys are included.';
      const description = `Batch: \`${b.id}\`\nPlan: **${planLabel(b)}**\nKeys in this file: **${result.keys.length}** · Originally generated: ${b.count}\n\n**One PC per key. No Discord customer required.**${warning}\n\nImport the TXT contents as one key/serial per stock item. Import each key only once.\nGenerating or exporting stock does not record a sale.`;
      const attachment = content ? new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: `QT-Website-Keys-${b.id}.txt`, description: 'Private website stock: one QT one-PC license key per line.' }) : null;
      return await i.editReply({ embeds: [e(generated ? (result.duplicate ? 'Existing website batch recovered' : 'Website keys generated') : 'Website key export', description)], files: attachment ? [attachment] : [], allowedMentions: { parse: [] } });
    } catch {
      throw new Error(`Website key batch ${b.id} is saved, but its TXT could not be delivered. Use /exportwebsitekeys batch_id:${b.id} to recover it; do not generate replacement stock. Check the bot's Attach Files and Embed Links permissions.`);
    }
  }
  return {
    async genwebsitekeys(i) {
      check(i);
      const count = i.options.getInteger('count', true), plan = i.options.getString('plan', true);
      if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Choose 1 to 1000 keys.');
      if (!['trial', 'lifetime'].includes(plan)) throw new Error('Choose lifetime or timed access.');
      const body = { count, plan, requestId: i.id, maxDevices: 1 };
      if (plan === 'trial') body.trialDays = i.options.getInteger('trial_days') ?? 3;
      const note = i.options.getString('note'); if (note != null) body.note = note;
      let result;
      try { result = await call(i, '', { method: 'POST', timeoutMs: 60000, body: JSON.stringify(body) }); }
      catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError' || !error.status) throw new Error('The generation request did not finish on the bot. A batch may already be saved. Check /websitebatches and use /exportwebsitekeys before generating more.');
        throw error;
      }
      return sendExport(i, result, true);
    },
    async websitebatches(i) {
      check(i);
      const limit = i.options.getInteger('limit') ?? 10;
      const { batches } = await call(i, '?limit=' + limit);
      const entries = batches.map(b => `**${planLabel(b)}** · ${b.unusedCount} unused / ${b.count} generated · ${b.activatedCount} activated\n\`${b.id}\`${b.note ? '\n' + safe(b.note).slice(0, 120) : ''}`);
      const shown = [];
      for (const entry of entries) { if ([...shown, entry].join('\n\n').length > 3700) break; shown.push(entry); }
      const content = shown.join('\n\n') || 'No website-key batches yet. Use `/genwebsitekeys`.';
      return i.editReply({ embeds: [e('Website key batches', content + (shown.length < entries.length ? '\n\nUse a smaller limit to view complete batch details.' : ''))], allowedMentions: { parse: [] } });
    },
    async exportwebsitekeys(i) {
      check(i);
      const id = i.options.getString('batch_id', true);
      if (!batchPattern.test(id)) throw new Error('Copy the full batch ID from /websitebatches.');
      const only = i.options.getBoolean('unused_only') ?? true;
      const result = await call(i, '/' + encodeURIComponent(id) + '?unusedOnly=' + only, { timeoutMs: 60000 });
      return sendExport(i, result);
    }
  };
}
