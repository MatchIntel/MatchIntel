import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
process.env.JWT_SECRET = 'keyinfo-fixture-'.repeat(8);
process.env.ADMIN_API_KEY = 'keyinfo-test-admin';
process.env.DEVICE_HASH_PEPPER = 'keyinfo-test-pepper';
const { createQtService } = await import('../src/qtLicenses.js');
const { createQuiltedAdminRouter } = await import('../src/quiltedAdmin.js');
const { createWebsiteKeyService } = await import('../src/websiteKeys.js');
const db = new PGlite();
for (const name of ['001_init.sql', '009_qt_optimizer_licenses.sql', '011_qt_website_key_batches.sql', '013_qt_discord_link.sql']) {
  await db.exec(await fs.readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
}
const adapt = c => ({ query: async (sql, args) => { const r = await c.query(sql, args); return { rows: r.rows, rowCount: r.rows.length }; } });
const execute = adapt(db).query, transaction = fn => db.transaction(c => fn(adapt(c)));
const service = createQtService({ execute, transaction });
const stock = createWebsiteKeyService({ execute, transaction });
const actor = '111111111111111111', owner = '222222222222222222', other = '333333333333333333';
const app = express(); app.use(express.json()); app.use('/v1/qt-admin', createQuiltedAdminRouter({ execute, transaction, service }));
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
async function lookup(body, status = 200, headers = {}) {
  const response = await fetch(base + '/v1/qt-admin/keyinfo', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Admin-Key': process.env.ADMIN_API_KEY, 'X-Admin-Actor': actor, ...headers
  }, body: JSON.stringify(body) });
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
}
const expected = new Set(); let websiteKey;
test('every linked key is reachable beyond the old 20-key limit, including website, expired and revoked keys', async () => {
  for (let n = 0; n < 25; n++) {
    const generated = await service.generate({ plan: n === 1 ? 'trial' : 'lifetime', trialDays: 3, discordUserId: owner }, actor);
    expected.add(generated.license.id);
    if (n === 0) await service.manage(generated.license.id, 'revoke', { reason: 'fixture' }, actor);
    if (n === 1) await execute("UPDATE qt_licenses SET activated_at=NOW()-INTERVAL '5 days',expires_at=NOW()-INTERVAL '2 days' WHERE id=$1", [generated.license.id]);
  }
  const batch = await stock.generate({ count: 2, plan: 'lifetime', maxDevices: 1, requestId: '900000000000000001' }, actor);
  websiteKey = batch.keys[0];
  expected.add((await service.manage(websiteKey, 'transfer', { discordUserId: owner }, actor)).license.id);
  await service.generate({ plan: 'lifetime', discordUserId: other }, actor);
  // Equal timestamps exercise deterministic UUID ordering.
  await execute("UPDATE qt_licenses SET created_at='2026-01-01T00:00:00Z'");
  const found = [];
  for (let page = 1; page <= 6; page++) {
    const result = await lookup({ discordUserId: owner, page, limit: 5 });
    assert.equal(result.matchType, 'user'); assert.equal(result.total, 26); assert.equal(result.totalPages, 6); assert.equal(result.page, page);
    assert.equal(result.licenses.length, page === 6 ? 1 : 5);
    assert.ok(result.licenses.every(l => l.discordUserId === owner && l.fullKey));
    found.push(...result.licenses);
  }
  assert.equal(found.length, 26); assert.deepEqual(new Set(found.map(l => l.id)), expected);
  assert.ok(found.some(l => l.source === 'website' && l.fullKey === websiteKey));
  assert.ok(found.some(l => l.status === 'revoked')); assert.ok(found.some(l => l.expiresAt && new Date(l.expiresAt) < new Date()));
});
test('zero results and out-of-range pages return usable pagination', async () => {
  const none = await lookup({ discordUserId: '444444444444444444', page: 1, limit: 5 });
  assert.equal(none.total, 0); assert.equal(none.totalPages, 1); assert.deepEqual(none.licenses, []);
  const last = await lookup({ discordUserId: owner, page: 1000, limit: 5 });
  assert.equal(last.page, 6); assert.equal(last.licenses.length, 1);
});
test('invalid IDs, pages, limits and ambiguous user/reference inputs are rejected', async () => {
  for (const body of [{ discordUserId: 'bad' }, { discordUserId: owner, reference: websiteKey },
    ...[0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1].map(page => ({ discordUserId: owner, page })),
    ...[0, 11, 1.5, '5'].map(limit => ({ discordUserId: owner, limit }))]) await lookup(body, 400);
});
test('user lookup requires admin authentication and cannot use customer self-recovery headers', async () => {
  await lookup({ discordUserId: owner }, 403, { 'X-Admin-Key': 'wrong' });
  await lookup({ discordUserId: owner }, 403, { 'X-Admin-Actor': 'discord-self:' + other });
  await lookup({ discordUserId: owner }, 400, { 'X-Admin-Actor': '' });
});
test('existing key references still work and paginated reveals are audited without plaintext keys', async () => {
  const direct = await lookup({ reference: websiteKey }); assert.equal(direct.matchType, 'license');
  assert.equal(direct.licenses[0].fullKey, websiteKey);
  const records = await execute("SELECT * FROM audit_logs WHERE action='qt.reveal_user'");
  assert.ok(records.rows.some(r => r.target === owner && r.details.total === 26 && r.details.page === 6));
  assert.ok(!JSON.stringify(records.rows).includes(websiteKey));
});
test.after(async () => { await new Promise(r => server.close(r)); await db.close(); });
