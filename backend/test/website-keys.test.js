import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
process.env.JWT_SECRET = 'website-key-fixture-'.repeat(5);
process.env.ADMIN_API_KEY = 'website-key-admin';
process.env.DEVICE_HASH_PEPPER = 'website-key-pepper';
process.env.QT_MINIMUM_APP_VERSION = '2.6.0';
const { createWebsiteKeyService } = await import('../src/websiteKeys.js');
const { createQtService } = await import('../src/qtLicenses.js');
const { createQuiltedAdminRouter } = await import('../src/quiltedAdmin.js');
const { sha256 } = await import('../src/security.js');
const db = new PGlite();
for (const f of ['001_init.sql', '009_qt_optimizer_licenses.sql']) await db.exec(await fs.readFile(new URL('../migrations/' + f, import.meta.url), 'utf8'));
const adapt = c => ({ query: async (sql, args) => { const r = await c.query(sql, args); return { rows: r.rows, rowCount: r.rows.length }; } });
const execute = adapt(db).query, transaction = fn => db.transaction(c => fn(adapt(c)));
const actor = '111111111111111111', owner = '222222222222222222', another = '333333333333333333';
const runtime = createQtService({discordRequired:false, execute, transaction });
// A real old license is issued and activated before the new migration.
const old = await runtime.generate({ plan: 'lifetime', discordUserId: owner }, actor);
const device = 'QT1-' + 'A'.repeat(64), otherDevice = 'QT1-' + 'B'.repeat(64);
const activation = key => ({ licenseKey: key, deviceId: device, deviceName: 'Website customer PC', appVersion: '2.9.0' });
const oldGrant = await runtime.activate(activation(old.licenseKey));
await db.exec(await fs.readFile(new URL('../migrations/011_qt_website_key_batches.sql', import.meta.url), 'utf8'));
const service = createWebsiteKeyService({ execute, transaction });
let counter = 800000000000000000n;
const next = () => String(++counter);
const body = extras => ({ count: 3, plan: 'lifetime', maxDevices: 1, requestId: next(), ...extras });
const app = express(); app.use(express.json()); app.use('/v1/qt-admin', createQuiltedAdminRouter({ execute, transaction, service: runtime }));
const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1/qt-admin`;
async function call(path, { payload, who = actor, secret = 'website-key-admin', status = 200, method = payload ? 'POST' : 'GET' } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': secret, 'X-Admin-Actor': who }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await r.json(); assert.equal(r.status, status, JSON.stringify(result));
  if (r.status !== 403) assert.equal(r.headers.get('cache-control'), 'no-store');
  return result;
}
test('migration preserves existing key, binding, refresh token and strict Discord-linked issuance', async () => {
  const row = (await execute('SELECT * FROM qt_licenses WHERE id=$1', [old.license.id])).rows[0];
  assert.equal(row.discord_user_id, owner); assert.equal(row.issuance_source, 'discord'); assert.equal(row.website_batch_id, null);
  assert.equal((await runtime.status(oldGrant.accessToken, device)).license.id, old.license.id);
  assert.ok((await runtime.refresh({ refreshToken: oldGrant.refreshToken, deviceId: device, appVersion: '2.9.0' })).accessToken);
  await assert.rejects(() => runtime.generate({ plan: 'lifetime' }, actor), e => e.code === 'QT-DISCORD-ID');
  await assert.rejects(() => execute("UPDATE qt_licenses SET discord_user_id=NULL WHERE id=$1", [old.license.id]), e => e.code === '23514');
});
test('website routes require admin secret and true staff actors, and validate batch inputs', async () => {
  const path = '/website-keys/batches';
  await call(path, { payload: body(), secret: 'wrong', status: 403 });
  await call(path, { who: 'discord-self:' + actor, status: 400 });
  for (const extra of [{ count: 0 }, { count: 1001 }, { count: 1.5 }, { count: '10' }, { plan: 'monthly' }, { maxDevices: 2 }, { maxDevices: '1' }, { discordUserId: owner }, { requestId: 'bad' }, { note: 'bad\ntext' }, { note: 'x'.repeat(501) }, { plan: 'trial', trialDays: 0 }, { plan: 'trial', trialDays: 31 }]) await call(path, { payload: body(extra), status: 400 });
  assert.equal((await execute('SELECT * FROM qt_website_key_batches')).rows.length, 0);
});
test('bulk issuance stores encrypted, unlinked, distinct one-PC keys and recovers identical request', async () => {
  const request = body({ count: 1000, note: 'SellAuth lifetime stock' });
  const batch = await call('/website-keys/batches', { payload: request });
  assert.equal(batch.keys.length, 1000); assert.equal(batch.exportedCount, 1000); assert.equal(new Set(batch.keys).size, 1000); assert.equal(batch.batch.count, 1000); assert.equal(batch.duplicate, false);
  for (const key of batch.keys) assert.match(key, /^QT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  const saved = (await execute('SELECT * FROM qt_licenses WHERE website_batch_id=$1 ORDER BY website_batch_position', [batch.batch.id])).rows;
  assert.equal(saved.length, 1000);
  for (const [i, r] of saved.entries()) { assert.equal(r.discord_user_id, null); assert.equal(r.issuance_source, 'website'); assert.equal(r.issued_by_discord_id, actor); assert.equal(r.activated_at, null); assert.equal(r.expires_at, null); assert.equal(r.key_hash, sha256(batch.keys[i])); assert.ok(!r.key_ciphertext.includes(batch.keys[i])); }
  const repeat = await call('/website-keys/batches', { payload: request }); assert.equal(repeat.duplicate, true); assert.deepEqual(repeat.keys, batch.keys); assert.equal(repeat.batch.id, batch.batch.id);
  await call('/website-keys/batches', { payload: { ...request, count: 999 }, status: 409 });
  await call('/website-keys/batches', { payload: request, who: another, status: 409 });
  assert.equal((await execute('SELECT COUNT(*)::int n FROM qt_website_key_batches')).rows[0].n, 1);
  const events = (await execute("SELECT * FROM audit_logs WHERE action LIKE 'qt.website_keys.%'")).rows;
  assert.ok(!JSON.stringify(events).includes(batch.keys[0]));
});
test('website key locks to first PC and rejects second PC, including simultaneous activation', async () => {
  const batch = await service.generate(body({ count: 2 }), actor);
  const key = batch.keys[0];
  const grant = await runtime.activate(activation(key)); assert.equal(grant.license.maxDevices, 1); assert.equal(grant.license.deviceCount, 1);
  await assert.rejects(() => runtime.activate({ ...activation(key), deviceId: otherDevice }), e => e.code === 'QT-HWID-LOCKED');
  await assert.rejects(() => runtime.refresh({ refreshToken: grant.refreshToken, deviceId: otherDevice, appVersion: '2.9.0' }), e => e.code === 'QT-HWID-LOCKED');
  const race = await Promise.allSettled([runtime.activate(activation(batch.keys[1])), runtime.activate({ ...activation(batch.keys[1]), deviceId: otherDevice })]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(race.find(r => r.status === 'rejected').reason.code, 'QT-HWID-LOCKED');
  const info = await runtime.manage(key, 'info', {}, actor); assert.equal(info.license.discordUserId, null); assert.equal(info.license.source, 'website'); assert.equal(info.license.websiteBatchId, batch.batch.id);
  assert.ok(!Object.hasOwn(grant.license, 'fullKey')); assert.ok(!Object.hasOwn(grant.license, 'websiteBatchId'));
});
test('timed stock waits for activation and keeps original expiry; revocation/reset/reissue remain effective', async () => {
  const batch = await service.generate(body({ count: 1, plan: 'trial', trialDays: 7 }), actor), key = batch.keys[0];
  let row = (await execute('SELECT * FROM qt_licenses WHERE key_hash=$1', [sha256(key)])).rows[0];
  assert.equal(row.expires_at, null); assert.equal(row.activated_at, null); assert.equal(Number(row.duration_seconds), 604800);
  const grant = await runtime.activate(activation(key)), expiry = new Date(grant.license.expiresAt).getTime(); assert.ok(expiry > Date.now() + 6.99 * 86400000);
  assert.equal(new Date((await runtime.activate(activation(key))).license.expiresAt).getTime(), expiry);
  await runtime.manage(key, 'revoke', { reason: 'fixture' }, actor); await assert.rejects(() => runtime.activate(activation(key)), e => e.code === 'QT-KEY-REVOKED');
  await runtime.manage(key, 'restore', {}, actor); await runtime.manage(key, 'reset', {}, actor);
  const moved = await runtime.activate({ ...activation(key), deviceId: otherDevice }); assert.equal(new Date(moved.license.expiresAt).getTime(), expiry);
  const reissued = await runtime.manage(key, 'reissue', {}, actor); assert.notEqual(reissued.licenseKey, key);
  await assert.rejects(() => runtime.activate(activation(reissued.licenseKey)), e => e.code === 'QT-HWID-LOCKED');
  await assert.rejects(() => runtime.activate({ ...activation(key), deviceId: otherDevice }), e => e.code === 'QT-KEY-NOT-FOUND');
  assert.ok((await runtime.activate({ ...activation(reissued.licenseKey), deviceId: otherDevice })).accessToken);
});
test('unused exports exclude activated, reset, linked, revoked and deleted keys; full recovery is explicit', async () => {
  const b = await service.generate(body({ count: 6 }), actor);
  await runtime.activate(activation(b.keys[0]));
  await runtime.manage(b.keys[0], 'reset', {}, actor); // It has been used even though the binding is reset.
  await runtime.manage(b.keys[1], 'transfer', { discordUserId: owner }, actor);
  await runtime.manage(b.keys[2], 'revoke', { reason: 'fixture' }, actor);
  await runtime.manage(b.keys[3], 'delete', { confirmation: 'DELETE KEY' }, actor);
  const unused = await call('/website-keys/batches/' + b.batch.id); assert.deepEqual(unused.keys, b.keys.slice(4)); assert.equal(unused.unusedOnly, true);
  const full = await call('/website-keys/batches/' + b.batch.id + '?unusedOnly=false'); assert.equal(full.keys.length, 5); assert.equal(full.unusedOnly, false);
  const listed = (await call('/website-keys/batches?limit=20')).batches.find(x => x.id === b.batch.id); assert.equal(listed.unusedCount, 2); assert.equal(listed.remainingCount, 5); assert.equal(listed.activatedCount, 1);
  assert.ok(!JSON.stringify(listed).includes('QT-'));
  const recovered = await createWebsiteKeyService({ execute, transaction }).export(b.batch.id, actor); assert.deepEqual(recovered.keys, unused.keys);
  await call('/website-keys/batches/not-an-id', { status: 400 });
  await call('/website-keys/batches/00000000-0000-4000-8000-000000000000', { status: 404 });
  await call('/website-keys/batches/' + b.batch.id + '?unusedOnly=bad', { status: 400 });
  await call('/website-keys/batches?limit=100', { status: 400 });
});
test('website batches are not Discord-recoverable unless explicitly linked; status counts linked users correctly', async () => {
  const b = await service.generate(body({ count: 1 }), actor);
  const result = await runtime.list(owner, owner); assert.ok(!result.licenses.some(l => l.fullKey === b.keys[0]));
  const self = await call(`/users/${owner}/licenses/reveal`, { who: 'discord-self:' + owner }); assert.ok(!self.licenses.some(l => l.fullKey === b.keys[0]));
  const status = await call('/status'); assert.ok(status.websiteLicenses > 1000); assert.ok(status.linkedLicenses < status.totalLicenses);
});
test('batch minting is atomic if audit or key insertion fails', async () => {
  const before = Number((await execute('SELECT count(*) n FROM qt_licenses')).rows[0].n);
  for (const trigger of ['INSERT INTO audit_logs', 'INSERT INTO qt_licenses']) {
    const badTransaction = fn => transaction(c => fn({ query: (sql, args) => { if (sql.startsWith(trigger)) throw new Error('fixture write failure'); return c.query(sql, args); } }));
    const broken = createWebsiteKeyService({ execute, transaction: badTransaction });
    const input = body(); await assert.rejects(() => broken.generate(input, actor), /fixture write failure/);
    assert.equal((await execute('SELECT * FROM qt_website_key_batches WHERE request_id=$1', [input.requestId])).rows.length, 0);
  }
  assert.equal(Number((await execute('SELECT count(*) n FROM qt_licenses')).rows[0].n), before);
});
test('concurrent duplicate requests create a single batch and encrypted-key corruption never silently replaces it', async () => {
  const spec = body({ count: 2 }); const results = await Promise.all([service.generate(spec, actor), service.generate(spec, actor)]);
  assert.equal(results[0].batch.id, results[1].batch.id); assert.deepEqual(results[0].keys, results[1].keys); assert.equal(results.filter(x => x.duplicate).length, 1);
  await execute('UPDATE qt_licenses SET key_ciphertext=$2 WHERE website_batch_id=$1', [results[0].batch.id, 'broken-cipher']);
  await assert.rejects(() => service.export(results[0].batch.id, actor), e => e.code === 'QT-WEBSITE-DECRYPT');
  assert.equal((await execute('SELECT count(*)::int n FROM qt_website_key_batches WHERE request_id=$1', [spec.requestId])).rows[0].n, 1);
});
test.after(async () => { await new Promise(r => server.close(r)); await db.close(); });
