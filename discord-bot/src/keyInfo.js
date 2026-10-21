import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { api } from './api.js';
import { canUse } from './access.js';
import { config } from './config.js';
import { COLORS, embed, licenseFields, licenseExpiryText, licenseStatusText, truncate } from './format.js';

const PAGE_SIZE = 5;
const userIdPattern = /^\d{15,25}$/;
const buttonPattern = /^qt_keyinfo:(\d{15,25}):(\d{15,25}):([1-9]\d{0,8})$/;

export function createKeyInfoHandlers({ request = api, authorize = canUse, guildId = config.guildId } = {}) {
  function check(i) {
    if (i.guildId !== guildId || !authorize(i, 'staff')) {
      throw new Error('Key information is only available to configured staff in the Quilted Tweaks server.');
    }
  }

  async function showUser(i, targetId, page = 1) {
    const result = await request('/v1/admin/keyinfo', {
      method: 'POST', actor: i.user.id,
      body: JSON.stringify({ discordUserId: targetId, page, limit: PAGE_SIZE })
    }).catch(error => {
      if (error.code === 'QT-REFERENCE') throw new Error('Deploy Quilted Tweaks backend 0.12.1 first; its Discord key lookup is required.');
      throw error;
    });
    if (result.matchType !== 'user' || result.discordUserId !== targetId || !Array.isArray(result.licenses) ||
        !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.page) ||
        !Number.isSafeInteger(result.totalPages) || result.page < 1 || result.page > result.totalPages ||
        result.limit !== PAGE_SIZE || result.totalPages !== Math.max(1, Math.ceil(result.total / PAGE_SIZE)) ||
        result.licenses.length !== Math.min(PAGE_SIZE, Math.max(0, result.total - (result.page - 1) * PAGE_SIZE)) ||
        result.licenses.some(l => l.discordUserId !== targetId)) {
      throw new Error('Deploy Quilted Tweaks backend 0.12.1 first; its paginated Discord key lookup is required.');
    }
    const fields = result.licenses.map((license, index) => ({
      name: `Key ${(result.page - 1) * PAGE_SIZE + index + 1}`,
      value: [
        license.fullKey ? `\`${license.fullKey}\`` : `\`${license.keyPrefix}…\` (legacy key; use /reissuekey)`,
        `Plan: **${license.plan}** · ${licenseStatusText(license)}`,
        `Expires: ${licenseExpiryText(license)}`,
        `PC: ${license.deviceCount}/${license.maxDevices} bound`,
        `Source: ${license.source === 'website' ? 'Website purchase' : 'Discord-issued'}`,
        `License ID: \`${license.id}\``
      ].join('\n')
    }));
    const card = embed('Quilted Tweaks · linked keys', fields, result.total ? 0x42d6aa : COLORS.yellow)
      .setDescription(`<@${targetId}> · \`${targetId}\`\n**${result.total} linked key${result.total === 1 ? '' : 's'}**` +
        (result.total ? '' : '\nNo keys are linked to this account yet. Website keys appear after Discord linking is confirmed in QT.'))
      .setFooter({ text: `Page ${result.page} of ${result.totalPages} · Private staff lookup` });
    const components = result.totalPages > 1 ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`qt_keyinfo:${i.user.id}:${targetId}:${Math.max(1, result.page - 1)}`)
        .setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(result.page === 1),
      new ButtonBuilder().setCustomId(`qt_keyinfo:${i.user.id}:${targetId}:${result.page}`)
        .setLabel(`${result.page} / ${result.totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`qt_keyinfo:${i.user.id}:${targetId}:${Math.min(result.totalPages, result.page + 1)}`)
        .setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(result.page === result.totalPages)
    )] : [];
    return i.editReply({ content: null, embeds: [card], components, allowedMentions: { parse: [] } });
  }

  return {
    async keyinfo(i) {
      check(i);
      const target = i.options.getUser('user');
      const reference = (i.options.getString('reference') || '').trim();
      if ((!target && !reference) || (target && reference)) throw new Error('Choose user:@someone or enter a reference, using one option at a time.');
      if (target) return showUser(i, target.id);
      const mention = /^<@!?(\d{15,25})>$/.exec(reference);
      if (mention || userIdPattern.test(reference)) return showUser(i, mention ? mention[1] : reference);

      const result = await request('/v1/admin/keyinfo', {
        method: 'POST', actor: i.user.id, body: JSON.stringify({ reference })
      });
      if (result.licenses.length === 1) {
        return i.editReply({ embeds: [embed(
          result.matchType === 'device' ? 'Quilted Tweaks key found by Device ID' : 'Quilted Tweaks key information',
          licenseFields(result.licenses[0], { showRecoveryNote: true }), COLORS.blue
        )], components: [], allowedMentions: { parse: [] } });
      }
      const fields = result.licenses.slice(0, 10).map((license, index) => ({
        name: `License ${index + 1}`,
        value: truncate([
          license.fullKey ? `Key: \`${license.fullKey}\`` : `Key: \`${license.keyPrefix}…\` (legacy; use /reissuekey)`,
          `ID: \`${license.id}\``, `Plan: ${license.plan} · ${licenseStatusText(license)}`,
          `Owner: ${license.discordUserId ? `<@${license.discordUserId}>` : 'Unlinked'}`
        ].join('\n'), 1024)
      }));
      return i.editReply({ embeds: [embed(`Device ID is linked to ${result.licenses.length} licenses`, fields, COLORS.yellow)], components: [], allowedMentions: { parse: [] } });
    },
    async button(i) {
      const match = buttonPattern.exec(i.customId);
      if (!match || match[1] !== i.user.id) {
        return i.reply({ content: 'Run your own /keyinfo lookup to view these pages.', ephemeral: true });
      }
      // Recheck current staff membership before acknowledging or loading any keys.
      check(i);
      await i.deferUpdate();
      return showUser(i, match[2], Number(match[3]));
    }
  };
}
