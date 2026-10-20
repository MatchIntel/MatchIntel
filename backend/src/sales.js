import { createHash } from 'node:crypto';
import { Router } from 'express';
import { query, tx } from './db.js';
import { requireAdmin } from './auth.js';
import { randomUuid } from './security.js';

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const uuid = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value));
const owns = (o, key) => Object.hasOwn(o, key);
function discordId(value, label) {
  if (typeof value !== 'string' || !/^\d{15,25}$/.test(value)) fail(400, 'QT-SALES-ID', `${label} must be a Discord ID.`);
  return value;
}
function text(value, label, max, empty = false) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail(400, 'QT-SALES-TEXT', `${label} must be plain text.`);
  const result = value.normalize('NFKC').trim();
  if ((!empty && !result) || result.length > max) fail(400, 'QT-SALES-TEXT', `${label} must be ${empty ? '0' : '1'}–${max} characters.`);
  return result;
}
export function moneyToCents(value, label = 'Amount', maxCents = 100000000) {
  if (!['number', 'string'].includes(typeof value)) fail(400, 'QT-SALES-MONEY', `${label} must be a nonnegative USD amount.`);
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) fail(400, 'QT-SALES-MONEY', `${label} must have at most two decimal places.`);
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > maxCents) fail(400, 'QT-SALES-MONEY', `${label} is too large.`);
  return cents;
}
const asNumber = value => {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number)) fail(500, 'QT-SALES-TOTAL', 'The sales total exceeds the reporting limit.');
  return number;
};
const productJson = row => ({ id: row.id, name: row.name, priceCents: asNumber(row.price_cents), costCents: asNumber(row.cost_cents), currency: row.currency, active: row.active });
function saleJson(row) {
  const price = asNumber(row.unit_price_cents), cost = asNumber(row.unit_cost_cents), quantity = row.quantity, fee = asNumber(row.fee_cents);
  return { id: row.id, productId: row.product_id, productName: row.product_name, unitPriceCents: price, unitCostCents: cost, quantity, feeCents: fee, revenueCents: price * quantity, costCents: cost * quantity, profitCents: (price - cost) * quantity - fee, currency: row.currency, customerId: row.customer_id, paymentReference: row.payment_reference, note: row.note, soldAt: row.sold_at, recordedBy: row.recorded_by, voidedAt: row.voided_at, voidReason: row.void_reason };
}
function dateInZone(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const shiftDate = (date, delta) => new Date(Date.parse(date + 'T00:00:00Z') + delta * 86400000).toISOString().slice(0, 10);
function saleDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > today) fail(400, 'QT-SALES-DATE', 'Use an existing date from 2000 onward in YYYY-MM-DD format; future sales are not allowed.');
  return value;
}

export function createSalesService({ execute = query, transaction = tx, now = () => new Date(), timezone = process.env.SALES_TIMEZONE || 'America/New_York' } = {}) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
  catch { throw new Error('SALES_TIMEZONE must be a valid IANA timezone, such as America/New_York.'); }
  const audit = (c, action, actor, target, details) => c.query('INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)', [randomUuid(), 'qt.sales.' + action, actor, target, JSON.stringify(details)]);
  const scope = (guild, actor) => { discordId(guild, 'Server'); discordId(actor, 'Staff actor'); };
  async function product(c, guild, id, lock = false) {
    if (!uuid(id)) fail(400, 'QT-PRODUCT-ID', 'Choose a product from autocomplete or /products.');
    const row = (await c.query('SELECT * FROM qt_sales_products WHERE guild_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''), [guild, id])).rows[0];
    if (!row) fail(404, 'QT-PRODUCT-NOT-FOUND', 'Product not found in this server.');
    return row;
  }
  return {
    async products(guild, actor, { search = '', includeArchived = false, limit = 25 } = {}) {
      scope(guild, actor);
      if (typeof includeArchived !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'QT-SALES-FILTER', 'Invalid product filter.');
      const term = text(search, 'Search', 100, true).toLowerCase();
      const result = await execute(`SELECT * FROM qt_sales_products WHERE guild_id=$1 AND ($2::boolean OR active) AND strpos(lower(name),$3)>0 ORDER BY active DESC,lower(name),id LIMIT $4`, [guild, includeArchived, term, limit]);
      return { products: result.rows.map(productJson), currency: 'USD' };
    },
    async addProduct(guild, actor, body) {
      scope(guild, actor);
      const name = text(body.name, 'Product name', 80), price = moneyToCents(body.price, 'Default unit price'), cost = moneyToCents(body.cost ?? 0, 'Default unit cost');
      try {
        return await transaction(async c => {
          const row = (await c.query('INSERT INTO qt_sales_products(id,guild_id,name,name_key,price_cents,cost_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [randomUuid(), guild, name, name.toLowerCase(), price, cost, actor])).rows[0];
          await audit(c, 'product_added', actor, row.id, { guildId: guild, name, priceCents: price, costCents: cost });
          return { product: productJson(row) };
        });
      } catch (e) { if (e.code === '23505') fail(409, 'QT-PRODUCT-EXISTS', 'A product with that name already exists, including archived products. Use /editproduct.'); throw e; }
    },
    async editProduct(guild, actor, id, body) {
      scope(guild, actor);
      if (!['name', 'price', 'cost', 'active'].some(k => owns(body, k))) fail(400, 'QT-PRODUCT-EDIT', 'Provide a new name, price, cost, or active setting.');
      if (owns(body, 'active') && typeof body.active !== 'boolean') fail(400, 'QT-PRODUCT-EDIT', 'Active must be true or false.');
      try {
        return await transaction(async c => {
          const previous = await product(c, guild, id, true);
          const name = owns(body, 'name') ? text(body.name, 'Product name', 80) : previous.name;
          const price = owns(body, 'price') ? moneyToCents(body.price, 'Default unit price') : asNumber(previous.price_cents);
          const cost = owns(body, 'cost') ? moneyToCents(body.cost, 'Default unit cost') : asNumber(previous.cost_cents);
          const row = (await c.query('UPDATE qt_sales_products SET name=$3,name_key=$4,price_cents=$5,cost_cents=$6,active=$7,updated_at=NOW() WHERE guild_id=$1 AND id=$2 RETURNING *', [guild, id, name, name.toLowerCase(), price, cost, body.active ?? previous.active])).rows[0];
          await audit(c, 'product_edited', actor, id, { guildId: guild, before: productJson(previous), after: productJson(row) });
          return { product: productJson(row) };
        });
      } catch (e) { if (e.code === '23505') fail(409, 'QT-PRODUCT-EXISTS', 'A product with that name already exists.'); throw e; }
    },
    async confirm(guild, actor, body) {
      scope(guild, actor);
      const interactionId = discordId(body.interactionId, 'Interaction');
      const quantity = body.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) fail(400, 'QT-SALES-QUANTITY', 'Quantity must be 1–1000.');
      if (!uuid(body.productId)) fail(400, 'QT-PRODUCT-ID', 'Choose a product from autocomplete or /products.');
      const normalized = { productId: body.productId.toLowerCase(), quantity,
        price: owns(body, 'price') ? moneyToCents(body.price, 'Unit price') : null,
        cost: owns(body, 'cost') ? moneyToCents(body.cost, 'Unit cost') : null,
        fee: moneyToCents(body.fee ?? 0, 'Total payment fee', 100000000000),
        customerId: body.customerId == null ? null : discordId(body.customerId, 'Customer'),
        paymentReference: body.paymentReference == null ? null : text(body.paymentReference, 'Payment reference', 120),
        note: text(body.note ?? '', 'Note', 500, true),
        soldOn: body.soldOn == null ? null : saleDate(body.soldOn, dateInZone(now(), timezone)) };
      const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      try {
        return await transaction(async c => {
          // Serializes retries of one Discord interaction, including requests arriving concurrently.
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [guild + ':' + interactionId]);
          const existing = (await c.query('SELECT * FROM qt_sales WHERE guild_id=$1 AND interaction_id=$2', [guild, interactionId])).rows[0];
          if (existing) {
            if (existing.request_hash !== hash || existing.recorded_by !== actor) fail(409, 'QT-SALES-RETRY', 'This interaction already recorded different sale details.');
            return { sale: saleJson(existing), duplicate: true };
          }
          const p = await product(c, guild, normalized.productId, true);
          if (!p.active) fail(409, 'QT-PRODUCT-ARCHIVED', 'This product is archived. Re-enable it with /editproduct before recording new sales.');
          const price = normalized.price ?? asNumber(p.price_cents), cost = normalized.cost ?? asNumber(p.cost_cents);
          const row = (await c.query(`INSERT INTO qt_sales(id,guild_id,product_id,product_name,unit_price_cents,unit_cost_cents,quantity,fee_cents,customer_id,payment_reference,note,interaction_id,request_hash,recorded_by,sold_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $15::text IS NULL THEN $16::timestamptz ELSE ($15::date+TIME '12:00') AT TIME ZONE $17 END) RETURNING *`,
          [randomUuid(), guild, p.id, p.name, price, cost, quantity, normalized.fee, normalized.customerId, normalized.paymentReference, normalized.note, interactionId, hash, actor, normalized.soldOn, now().toISOString(), timezone])).rows[0];
          await audit(c, 'confirmed', actor, row.id, { guildId: guild, productId: p.id, quantity, revenueCents: price * quantity, costCents: cost * quantity, feeCents: normalized.fee });
          return { sale: saleJson(row), duplicate: false };
        });
      } catch (e) { if (e.code === '23505') fail(409, 'QT-SALES-DUPLICATE', 'That payment reference is already recorded in this server. Check /sales before confirming it again.'); throw e; }
    },
    async voidSale(guild, actor, id, reason) {
      scope(guild, actor);
      if (!uuid(id)) fail(400, 'QT-SALE-ID', 'Use a full sale ID from /confirm or /sales.');
      reason = text(reason, 'Void reason', 300);
      return transaction(async c => {
        const old = (await c.query('SELECT * FROM qt_sales WHERE guild_id=$1 AND id=$2 FOR UPDATE', [guild, id])).rows[0];
        if (!old) fail(404, 'QT-SALE-NOT-FOUND', 'Sale not found in this server.');
        if (old.voided_at) return { sale: saleJson(old), alreadyVoided: true };
        const row = (await c.query('UPDATE qt_sales SET voided_at=NOW(),voided_by=$3,void_reason=$4 WHERE guild_id=$1 AND id=$2 RETURNING *', [guild, id, actor, reason])).rows[0];
        await audit(c, 'voided', actor, id, { guildId: guild, reason });
        return { sale: saleJson(row), alreadyVoided: false };
      });
    },
    async sales(guild, actor, { limit = 10, includeVoided = false } = {}) {
      scope(guild, actor);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || typeof includeVoided !== 'boolean') fail(400, 'QT-SALES-FILTER', 'Use a limit from 1 to 20.');
      const rows = await execute('SELECT * FROM qt_sales WHERE guild_id=$1 AND ($2::boolean OR voided_at IS NULL) ORDER BY sold_at DESC,created_at DESC,id LIMIT $3', [guild, includeVoided, limit]);
      return { sales: rows.rows.map(saleJson), currency: 'USD' };
    },
    async dashboard(guild, actor, { period = '30d', productId = null } = {}) {
      scope(guild, actor);
      if (!['7d', '30d', '90d', 'all'].includes(period)) fail(400, 'QT-SALES-PERIOD', 'Choose 7d, 30d, 90d, or all.');
      const today = dateInZone(now(), timezone), days = period === 'all' ? 30 : Number(period.slice(0, -1));
      const start = shiftDate(today, 1 - days), end = shiftDate(today, 1);
      // One repeatable database snapshot keeps cards, trends and product totals consistent.
      return transaction(async c => {
        await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const p = productId == null ? null : await product(c, guild, productId);
        const args = [guild, p?.id ?? null, period === 'all' ? null : start, end, timezone];
        const where = `guild_id=$1 AND voided_at IS NULL AND ($2::uuid IS NULL OR product_id=$2) AND ($3::date IS NULL OR sold_at>=($3::date::timestamp AT TIME ZONE $5)) AND sold_at<($4::date::timestamp AT TIME ZONE $5)`;
        const totals = (await c.query(`SELECT count(*) AS orders,COALESCE(sum(quantity),0) AS units,COALESCE(sum(unit_price_cents*quantity),0) AS revenue,COALESCE(sum(unit_cost_cents*quantity),0) AS costs,COALESCE(sum(fee_cents),0) AS fees FROM qt_sales WHERE ${where}`, args)).rows[0];
        const best = (await c.query(`SELECT product_id,count(*) AS orders,sum(quantity) AS units,sum(unit_price_cents*quantity) AS revenue,sum((unit_price_cents-unit_cost_cents)*quantity-fee_cents) AS profit FROM qt_sales WHERE ${where} GROUP BY product_id ORDER BY revenue DESC,product_id LIMIT 5`, args)).rows;
        for (const row of best) row.name = (await c.query('SELECT name FROM qt_sales_products WHERE id=$1 AND guild_id=$2', [row.product_id, guild])).rows[0].name;
        const chartRows = (await c.query(`SELECT to_char(sold_at AT TIME ZONE $5,'YYYY-MM-DD') AS day,count(*) AS orders,sum(unit_price_cents*quantity) AS revenue,sum((unit_price_cents-unit_cost_cents)*quantity-fee_cents) AS profit FROM qt_sales WHERE ${where} AND sold_at>=($6::date::timestamp AT TIME ZONE $5) GROUP BY day ORDER BY day`, [...args, start])).rows;
        const byDay = new Map(chartRows.map(row => [row.day, row]));
        const series = Array.from({ length: days }, (_, i) => { const date = shiftDate(start, i), row = byDay.get(date); return { date, orders: asNumber(row?.orders), revenueCents: asNumber(row?.revenue), profitCents: asNumber(row?.profit) }; });
        const revenue = asNumber(totals.revenue), costs = asNumber(totals.costs), fees = asNumber(totals.fees), orders = asNumber(totals.orders);
        return { currency: 'USD', timezone, period, start: period === 'all' ? null : start, end: today, chartStart: start, generatedAt: now().toISOString(), product: p ? productJson(p) : null,
          totals: { orders, units: asNumber(totals.units), revenueCents: revenue, costCents: costs, feeCents: fees, profitCents: revenue - costs - fees, averageOrderCents: orders ? Math.round(revenue / orders) : 0 },
          topProducts: best.map(row => ({ id: row.product_id, name: row.name, orders: asNumber(row.orders), units: asNumber(row.units), revenueCents: asNumber(row.revenue), profitCents: asNumber(row.profit) })), series };
      });
    }
  };
}

export function createSalesRouter({ service = createSalesService() } = {}) {
  const router = Router({ mergeParams: true });
  router.use(requireAdmin);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const handle = fn => async (req, res) => {
    try { res.json(await fn(req, req.params.guildId, discordId(req.headers['x-admin-actor'], 'Staff actor'))); }
    catch (e) { if (!e.status) console.error('[sales]', e); res.status(e.status || 500).json({ code: e.status ? e.code : 'QT-SALES-UNAVAILABLE', message: e.status ? e.message : 'Sales reporting is temporarily unavailable.' }); }
  };
  router.get('/products', handle((req, guild, actor) => service.products(guild, actor, { search: req.query.search ?? '', includeArchived: req.query.archived === 'true', limit: Number(req.query.limit ?? 25) })));
  router.post('/products', handle((req, guild, actor) => service.addProduct(guild, actor, req.body || {})));
  router.patch('/products/:id', handle((req, guild, actor) => service.editProduct(guild, actor, req.params.id, req.body || {})));
  router.post('/confirm', handle((req, guild, actor) => service.confirm(guild, actor, req.body || {})));
  router.get('/records', handle((req, guild, actor) => service.sales(guild, actor, { limit: Number(req.query.limit ?? 10), includeVoided: req.query.voided === 'true' })));
  router.post('/records/:id/void', handle((req, guild, actor) => service.voidSale(guild, actor, req.params.id, req.body?.reason)));
  router.get('/dashboard', handle((req, guild, actor) => service.dashboard(guild, actor, { period: req.query.period ?? '30d', productId: req.query.productId ?? null })));
  return router;
}
