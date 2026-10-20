import { AttachmentBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { canUse } from './access.js';
import { salesCommandNames } from './salesCommands.js';
import { formatMoney, renderDashboardPng } from './salesDashboard.js';

const money = formatMoney;
const safe = value => escapeMarkdown(String(value)).replace(/@/g, '@\u200b');
const omitNulls = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v != null));
const card = (title, description) => new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x42d6aa).setTimestamp();
function listText(entries, empty) {
  if (!entries.length) return empty;
  const shown = [];
  for (const entry of entries) {
    if ([...shown, entry].join('\n\n').length > 3700) break;
    shown.push(entry);
  }
  return shown.join('\n\n') + (shown.length < entries.length ? '\n\nMore matches are available. Narrow your search or use a smaller limit.' : '');
}
export const SALES_ADMIN_COMMANDS = ['addproduct', 'editproduct', 'dashboard', 'sales', 'voidsale'];

export function createSalesHandlers({ request = api, render = renderDashboardPng, authorize = canUse, guildId = config.guildId } = {}) {
  function check(interaction, level = 'admin') {
    if (!interaction.guildId || interaction.guildId !== guildId) throw new Error('Sales commands are only available in the configured Quilted Tweaks server.');
    if (!authorize(interaction, level)) throw new Error(`This sales command requires the configured ${level} role.`);
  }
  const path = i => `/v1/admin/sales/guilds/${i.guildId}`;
  const call = (i, suffix, options = {}) => request(path(i) + suffix, { actor: i.user.id, ...options });
  const reply = (i, title, description) => i.editReply({ embeds: [card(title, description)], allowedMentions: { parse: [] } });
  return {
    async addproduct(i) {
      check(i);
      const b = omitNulls({ name: i.options.getString('name', true), price: i.options.getNumber('price', true), cost: i.options.getNumber('cost') });
      const { product: p } = await call(i, '/products', { method: 'POST', body: JSON.stringify(b) });
      return reply(i, 'Product added', `**${safe(p.name)}**\nPrice: **${money(p.priceCents)}** per unit\nCost: ${money(p.costCents)} per unit\n\nRecord a sale with \`/confirm\` and choose this product.\nProduct ID: \`${p.id}\``);
    },
    async editproduct(i) {
      check(i);
      const id = i.options.getString('product', true);
      const b = omitNulls({ name: i.options.getString('name'), price: i.options.getNumber('price'), cost: i.options.getNumber('cost'), active: i.options.getBoolean('active') });
      if (!Object.keys(b).length) throw new Error('Provide a new name, price, cost, or active setting.');
      const { product: p } = await call(i, `/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(b) });
      return reply(i, 'Product updated', `**${safe(p.name)}**\nPrice: **${money(p.priceCents)}** per unit\nCost: ${money(p.costCents)} per unit\nStatus: **${p.active ? 'Available' : 'Archived'}**\n\nEarlier sales keep their original names, prices, and costs.`);
    },
    async products(i) {
      check(i, 'staff');
      const params = new URLSearchParams({ archived: String(i.options.getBoolean('archived') ?? false), search: i.options.getString('search') ?? '', limit: '25' });
      const result = await call(i, '/products?' + params);
      return reply(i, 'Quilted Tweaks products', listText(result.products.map(p => `**${safe(p.name)}**${p.active ? '' : ' · Archived'} — ${money(p.priceCents)} / unit\n\`${p.id}\``), 'No matching products yet. An admin can add one with `/addproduct`.'));
    },
    async confirm(i) {
      check(i, 'staff');
      const b = omitNulls({ productId: i.options.getString('product', true), price: i.options.getNumber('price'), quantity: i.options.getInteger('quantity'), cost: i.options.getNumber('cost'), fee: i.options.getNumber('fee'), customerId: i.options.getUser('customer')?.id, paymentReference: i.options.getString('reference'), soldOn: i.options.getString('sold_on'), note: i.options.getString('note'), interactionId: i.id });
      const { sale: s, duplicate } = await call(i, '/confirm', { method: 'POST', body: JSON.stringify(b) });
      return reply(i, duplicate ? 'Sale already recorded' : 'Sale recorded', `**${safe(s.productName)}** · ${s.quantity} unit${s.quantity === 1 ? '' : 's'} × ${money(s.unitPriceCents)}\nRevenue: **${money(s.revenueCents)}**\nRecorded costs: ${money(s.costCents)}\nPayment fee: ${money(s.feeCents)}\nRecorded profit: **${money(s.profitCents)}**\n\nSale ID: \`${s.id}\`${s.voidedAt ? '\n**This entry is voided and excluded from totals.**' : ''}\n\nThis records a payment you already received. License keys are managed with \`/genkey\`.`);
    },
    async dashboard(i) {
      check(i);
      const params = new URLSearchParams({ period: i.options.getString('period') ?? '30d' });
      const product = i.options.getString('product'); if (product) params.set('productId', product);
      const data = await call(i, '/dashboard?' + params);
      const png = await render(data, { serverName: i.guild?.name || 'Quilted Tweaks' });
      const name = 'quilted-tweaks-sales-dashboard.png';
      const attachment = new AttachmentBuilder(png, { name, description: `Quilted Tweaks ${data.period} sales: ${money(data.totals.revenueCents)} revenue, ${money(data.totals.profitCents)} recorded profit, ${data.totals.orders} orders.` });
      const e = card('Quilted Tweaks sales dashboard', `**${data.totals.orders} sales** · Revenue **${money(data.totals.revenueCents)}** · Recorded profit **${money(data.totals.profitCents)}**\nProfit uses the costs and fees entered with each sale. Reports use ${data.timezone}.`).setImage('attachment://' + name);
      return i.editReply({ embeds: [e], files: [attachment], allowedMentions: { parse: [] } });
    },
    async sales(i) {
      check(i);
      const params = new URLSearchParams({ limit: String(i.options.getInteger('limit') ?? 10), voided: String(i.options.getBoolean('voided') ?? false) });
      const result = await call(i, '/records?' + params);
      return reply(i, 'Recent recorded sales', listText(result.sales.map(s => `${s.voidedAt ? '**VOIDED** · ' : ''}**${safe(s.productName)}** · ${s.quantity} unit(s) · ${money(s.revenueCents)}\n${new Date(s.soldAt).toISOString().slice(0, 10)} · Profit ${money(s.profitCents)}\n\`${s.id}\``), 'No sales recorded yet. Use `/confirm` after receiving a payment.'));
    },
    async voidsale(i) {
      check(i);
      const id = i.options.getString('sale_id', true);
      const { sale: s, alreadyVoided } = await call(i, `/records/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({ reason: i.options.getString('reason', true) }) });
      return reply(i, alreadyVoided ? 'Sale already voided' : 'Sale voided', `**${safe(s.productName)}** · ${money(s.revenueCents)}\nSale ID: \`${s.id}\`\n\nExcluded from dashboard totals. Its record and audit history are preserved. This does not send a refund or revoke a license.`);
    },
    async autocomplete(i) {
      if (!salesCommandNames.has(i.commandName)) return i.respond([]);
      try {
        check(i, SALES_ADMIN_COMMANDS.includes(i.commandName) ? 'admin' : 'staff');
        const focused = i.options.getFocused(true);
        if (focused.name !== 'product') return i.respond([]);
        const params = new URLSearchParams({ search: String(focused.value).slice(0, 100), archived: String(i.commandName !== 'confirm'), limit: '25' });
        const result = await call(i, '/products?' + params, { timeoutMs: 1800 });
        return await i.respond(result.products.map(p => ({ name: `${p.name}${p.active ? '' : ' [Archived]'} · ${money(p.priceCents)}`.slice(0, 100), value: p.id })));
      } catch { if (!i.responded) return i.respond([]).catch(() => {}); }
    }
  };
}
