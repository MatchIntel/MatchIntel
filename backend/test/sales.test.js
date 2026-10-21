import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = 'sales-fixture-'.repeat(8);
process.env.ADMIN_API_KEY = 'fixture-sales-admin';
process.env.DEVICE_HASH_PEPPER = 'fixture-sales-pepper';
const { createSalesService, createSalesRouter, moneyToCents } = await import('../src/sales.js');
const { createQuiltedAdminRouter } = await import('../src/quiltedAdmin.js');
const db = new PGlite();
for (const name of ['001_init.sql', '009_qt_optimizer_licenses.sql', '010_qt_sales_ledger.sql', '012_qt_expenses.sql']) await db.exec(await fs.readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
const adapt = c => ({ query: async (sql, args) => { const r = await c.query(sql, args); return { rows: r.rows, rowCount: r.rows.length }; } });
const execute = adapt(db).query, transaction = fn => db.transaction(c => fn(adapt(c)));
let clock = new Date('2026-10-20T01:30:00Z'); // Oct 19 in New York.
const service = createSalesService({ execute, transaction, now: () => clock });
const guild = '111111111111111111', otherGuild = '222222222222222222', actor = '333333333333333333';
let productId, saleId;
const app = express(); app.use(express.json());
// Exercise the actual production mount, not only the standalone sales router.
app.use('/v1/qt-admin', createQuiltedAdminRouter({ execute, transaction }));
app.use('/fixture/:guildId', createSalesRouter({ service }));
const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(path, { body, method = body ? 'POST' : 'GET', secret = 'fixture-sales-admin', who = actor, status = 200 } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': secret, 'X-Admin-Actor': who }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await r.json(); assert.equal(r.status, status, JSON.stringify(result));
  assert.equal(r.headers.get('cache-control'), r.status === 403 ? null : 'no-store');
  return result;
}
test('money parsing is exact; invalid, non-cent, negative and oversized amounts fail', () => {
  for (const [value, expected] of [[0, 0], [0.1, 10], ['19.99', 1999], ['00025.00', 2500], [1000000, 100000000]]) assert.equal(moneyToCents(value), expected);
  for (const value of [-1, 0.001, 1.234, Infinity, NaN, true, null, {}, '1e2', '1,000', 1000000.01, '9'.repeat(300)]) assert.throws(() => moneyToCents(value), e => e.status === 400);
});
test('sales API requires admin secret and a real staff actor, including on production mount', async () => {
  const path = `/v1/qt-admin/sales/guilds/${guild}/products`;
  await call(path, { secret: 'wrong', status: 403 });
  await call(path, { who: 'discord-self:' + actor, status: 400 });
  await call('/fixture/bad/products', { status: 400 });
  assert.deepEqual((await call(path)).products, []);
});
test('add/list/edit products; enforce names and server isolation', async () => {
  const first = await call(`/fixture/${guild}/products`, { body: { name: 'QT Premium Utility', price: 25, cost: 2.5 } });
  productId = first.product.id; assert.equal(first.product.priceCents, 2500); assert.equal(first.product.costCents, 250);
  await call(`/fixture/${guild}/products`, { body: { name: 'qt premium utility', price: 10 }, status: 409 });
  await call(`/fixture/${guild}/products`, { body: { name: 'Bad\nname', price: 10 }, status: 400 });
  assert.equal((await call(`/fixture/${guild}/products?search=Premium`)).products.length, 1);
  assert.equal((await call(`/fixture/${otherGuild}/products`)).products.length, 0);
  await call(`/fixture/${otherGuild}/products/${productId}`, { method: 'PATCH', body: { price: 1 }, status: 404 });
  await call(`/fixture/${guild}/products/${productId}`, { method: 'PATCH', body: {}, status: 400 });
});
test('confirm defaults/overrides, exact profit, retries and duplicate payment references', async () => {
  const body = { productId, quantity: 2, fee: 1.5, interactionId: '444444444444444444', paymentReference: 'TX-1' };
  const result = await call(`/fixture/${guild}/confirm`, { body }); saleId = result.sale.id;
  assert.equal(result.sale.revenueCents, 5000); assert.equal(result.sale.costCents, 500); assert.equal(result.sale.profitCents, 4350); assert.equal(result.duplicate, false);
  const retry = await call(`/fixture/${guild}/confirm`, { body }); assert.equal(retry.sale.id, saleId); assert.equal(retry.duplicate, true);
  await call(`/fixture/${guild}/confirm`, { body: { ...body, price: 10 }, status: 409 });
  await call(`/fixture/${guild}/confirm`, { body: { ...body, interactionId: '444444444444444445', paymentReference: 'tx-1' }, status: 409 });
  await call(`/fixture/${otherGuild}/confirm`, { body: { ...body }, status: 404 });
  const override = await call(`/fixture/${guild}/confirm`, { body: { productId, price: 20.01, cost: 1.01, fee: 0.31, interactionId: '444444444444444446', soldOn: '2026-10-18' } });
  assert.equal(override.sale.profitCents, 1869);
});
test('product edits/archive do not rewrite history; archive filters and reopen work', async () => {
  await service.editProduct(guild, actor, productId, { name: 'QT Utility Updated', price: 40, cost: 4, active: false });
  assert.equal((await service.products(guild, actor)).products.length, 0);
  assert.equal((await service.products(guild, actor, { includeArchived: true })).products[0].priceCents, 4000);
  const old = (await service.sales(guild, actor)).sales.find(s => s.id === saleId);
  assert.equal(old.productName, 'QT Premium Utility'); assert.equal(old.unitPriceCents, 2500);
  await assert.rejects(() => service.confirm(guild, actor, { productId, interactionId: '444444444444444447' }), e => e.code === 'QT-PRODUCT-ARCHIVED');
  const retry = await service.confirm(guild, actor, { productId, quantity: 2, fee: 1.5, interactionId: '444444444444444444', paymentReference: 'TX-1' });
  assert.equal(retry.duplicate, true);
  await service.editProduct(guild, actor, productId, { active: true });
  const next = await service.confirm(guild, actor, { productId, interactionId: '444444444444444448', soldOn: '2026-09-01' });
  assert.equal(next.sale.revenueCents, 4000);
});
test('dashboard totals, trends, product filters and timezone use consistent sale snapshots', async () => {
  const result = await call(`/fixture/${guild}/dashboard?period=30d`);
  assert.equal(result.timezone, 'America/New_York'); assert.equal(result.end, '2026-10-19'); assert.equal(result.start, '2026-09-20');
  assert.deepEqual(result.totals, { orders: 2, units: 3, revenueCents: 7001, costCents: 601, feeCents: 181, expenseCents: 0, expenseCount: 0, saleProfitCents: 6219, profitCents: 6219, averageOrderCents: 3501 });
  assert.equal(result.series.length, 30); assert.equal(result.series.at(-1).date, '2026-10-19'); assert.equal(result.series.at(-1).revenueCents, 5000);
  assert.equal(result.series.reduce((s, d) => s + d.revenueCents, 0), result.totals.revenueCents);
  assert.equal(result.topProducts[0].name, 'QT Utility Updated');
  const all = await service.dashboard(guild, actor, { period: 'all', productId }); assert.equal(all.totals.orders, 3); assert.equal(all.totals.revenueCents, 11001); assert.equal(all.series.length, 30);
  assert.equal(all.series.reduce((s, d) => s + d.orders, 0), 2);
  const empty = await service.dashboard(otherGuild, actor); assert.equal(empty.totals.orders, 0); assert.equal(empty.totals.averageOrderCents, 0);
  await call(`/fixture/${guild}/dashboard?period=bad`, { status: 400 });
  await service.addProduct(otherGuild, actor, { name: 'Other server product', price: 1 });
  await assert.rejects(() => service.dashboard(otherGuild, actor, { productId }), e => e.status === 404);
});
test('voiding is auditable, retry-safe and excludes sales from totals; reference can be corrected', async () => {
  await call(`/fixture/${otherGuild}/records/${saleId}/void`, { body: { reason: 'Wrong server' }, status: 404 });
  const voided = await call(`/fixture/${guild}/records/${saleId}/void`, { body: { reason: 'Wrong price; re-recording' } });
  assert.equal(voided.alreadyVoided, false); assert.ok(voided.sale.voidedAt);
  assert.equal((await service.voidSale(guild, actor, saleId, 'Retry')).alreadyVoided, true);
  const d = await service.dashboard(guild, actor); assert.equal(d.totals.orders, 1); assert.equal(d.totals.revenueCents, 2001);
  assert.equal((await service.sales(guild, actor)).sales.length, 2); assert.equal((await service.sales(guild, actor, { includeVoided: true })).sales.length, 3);
  const corrected = await service.confirm(guild, actor, { productId, interactionId: '444444444444444449', paymentReference: 'TX-1' }); assert.equal(corrected.sale.unitPriceCents, 4000);
  assert.equal((await execute("SELECT count(*)::int AS n FROM audit_logs WHERE action='qt.sales.voided'")).rows[0].n, 1);
});
test('invalid sale input cannot create partial entries; negative profit is supported', async () => {
  for (const extra of [{ quantity: 0 }, { quantity: 1.2 }, { quantity: 1001 }, { price: -1 }, { price: null }, { price: 1.234 }, { fee: -2 }, { customerId: 'bad' }, { soldOn: '2026-02-30' }, { soldOn: '2026-10-20' }, { note: 'bad\ntext' }]) await assert.rejects(() => service.confirm(guild, actor, { productId, interactionId: '555555555555555555', ...extra }), e => e.status === 400);
  const loss = await service.confirm(guild, actor, { productId, interactionId: '555555555555555555', price: 1, cost: 5, fee: 1 }); assert.equal(loss.sale.profitCents, -500);
  await call(`/fixture/${guild}/records?limit=200`, { status: 400 });
  assert.throws(() => createSalesService({ timezone: 'invalid/zone' }), /SALES_TIMEZONE/);
});
test('DST boundaries count local calendar days; ledger survives service reconstruction', async () => {
  const dstGuild = '666666666666666666';
  const p = await service.addProduct(dstGuild, actor, { name: 'DST Test', price: 3 });
  clock = new Date('2026-11-01T05:30:00Z');
  await service.confirm(dstGuild, actor, { productId: p.product.id, interactionId: '777777777777777770' });
  clock = new Date('2026-11-01T06:30:00Z');
  await service.confirm(dstGuild, actor, { productId: p.product.id, interactionId: '777777777777777771' });
  const fresh = createSalesService({ execute, transaction, now: () => clock });
  const d = await fresh.dashboard(dstGuild, actor, { period: '7d' }); assert.equal(d.totals.orders, 2); assert.equal(d.series.at(-1).orders, 2); assert.equal(d.end, '2026-11-01');
});
test('audit failure rolls back the sale and its totals', async () => {
  const badTx = fn => transaction(c => fn({ query: (sql, args) => { if (sql.startsWith('INSERT INTO audit_logs')) throw new Error('fixture audit failure'); return c.query(sql, args); } }));
  const svc = createSalesService({ execute, transaction: badTx });
  await assert.rejects(() => svc.confirm(guild, actor, { productId, interactionId: '888888888888888888' }), /fixture audit failure/);
  assert.equal((await execute('SELECT * FROM qt_sales WHERE interaction_id=$1', ['888888888888888888'])).rows.length, 0);
});
test.after(async () => { await new Promise(r => server.close(r)); await db.close(); });
