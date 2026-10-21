import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
for (const [k, v] of Object.entries({ DISCORD_TOKEN: 'fixture', DISCORD_CLIENT_ID: '111111111111111111', DISCORD_GUILD_ID: '111111111111111111', BACKEND_URL: 'https://example.invalid', BACKEND_ADMIN_KEY: 'fixture', OWNER_DISCORD_IDS: '111111111111111111', BOT_ADMIN_ROLE_IDS: '222222222222222222', BOT_STAFF_ROLE_IDS: '333333333333333333' })) process.env[k] = v;
const { commands, publicCommands } = await import('../src/commands.js');
const { createWebsiteKeyHandlers, websiteKeysText } = await import('../src/websiteKeys.js');
const { routeApiPath, api } = await import('../src/api.js');
const { licenseFields } = await import('../src/format.js');
const guild = '111111111111111111', id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keys = ['QT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-AAAA-BBBB', 'QT-BBBB-CCCC-DDDD-EEEE-FFFF-AAAA-BBBB-CCCC'];
const batch = { id, plan: 'lifetime', count: 2, durationSeconds: null, note: 'Website stock', unusedCount: 2, activatedCount: 0 };
const result = () => ({ batch, keys: [...keys], exportedCount: 2, unusedOnly: true, duplicate: false });
function interaction(values = {}, level = 'owner', server = guild) {
  const i = { id: '444444444444444444', guildId: server, user: { id: level === 'owner' ? guild : '999999999999999999' }, member: { roles: level === 'admin' ? ['222222222222222222'] : level === 'staff' ? ['333333333333333333'] : [] }, replies: [], options: {} };
  for (const method of ['getString', 'getInteger', 'getBoolean']) i.options[method] = name => values[name] ?? null;
  i.editReply = async payload => { i.replies.push(payload); return payload; }; return i;
}
test('registered admin commands require no user option and cap mass generation at 1000', async () => {
  const c = commands.find(c => c.name === 'genwebsitekeys'); assert.ok(c); assert.equal(c.options.find(o => o.name === 'count').max_value, 1000); assert.equal(c.options.find(o => o.name === 'count').min_value, 1);
  assert.ok(c.options.every(o => o.name !== 'user' && o.name !== 'devices')); assert.equal(c.options.find(o => o.name === 'trial_days').max_value, 30);
  for (const n of ['genwebsitekeys', 'websitebatches', 'exportwebsitekeys']) { assert.ok(commands.some(c => c.name === n)); assert.ok(!publicCommands.some(c => c.name === n)); }
  const linked = commands.find(c => c.name === 'genkey'); assert.equal(linked.options.find(o => o.name === 'user').required, true); assert.equal(linked.options.find(o => o.name === 'devices').max_value, 1);
  const source = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'); assert.match(source, /\.\.\.WEBSITE_KEY_COMMAND_NAMES/); assert.match(source, /\.\.\.createWebsiteKeyHandlers\(\)/); assert.match(source, /deferReply\(\{ flags: MessageFlags\.Ephemeral \}\)/);
});
test('only owners/admins in configured server may mint, list, or export', async () => {
  let calls = 0; const h = createWebsiteKeyHandlers({ request: async () => { calls++; throw Error('unexpected'); } });
  for (const level of ['none', 'staff']) for (const name of ['genwebsitekeys', 'websitebatches', 'exportwebsitekeys']) await assert.rejects(() => h[name](interaction({}, level)), /admin role/);
  for (const server of [null, '555555555555555555']) await assert.rejects(() => h.genwebsitekeys(interaction({}, 'owner', server)), /configured/);
  assert.equal(calls, 0);
});
test('bulk generation sends fixed one-PC requests, and attachment is import-ready plain TXT', async () => {
  const calls = []; const h = createWebsiteKeyHandlers({ request: async (p, o) => { calls.push([p, o]); return result(); } });
  const i = interaction({ count: 2, plan: 'lifetime', note: 'SellAuth stock' }); await h.genwebsitekeys(i);
  assert.equal(routeApiPath(calls[0][0]), '/v1/qt-admin/website-keys/batches');
  assert.deepEqual(JSON.parse(calls[0][1].body), { count: 2, plan: 'lifetime', requestId: i.id, maxDevices: 1, note: 'SellAuth stock' }); assert.equal(calls[0][1].timeoutMs, 60000);
  const reply = i.replies[0]; assert.deepEqual(reply.allowedMentions, { parse: [] }); assert.equal(reply.files.length, 1); assert.equal(reply.files[0].name, `QT-Website-Keys-${id}.txt`);
  assert.equal(reply.files[0].attachment.toString('utf8'), keys.join('\r\n') + '\r\n'); assert.equal(reply.files[0].attachment.subarray(0, 3).toString(), 'QT-'); assert.ok(!JSON.stringify(reply.embeds).includes(keys[0]));
  const timed = interaction({ count: 2, plan: 'trial', trial_days: 7 }, 'admin'); await h.genwebsitekeys(timed); assert.equal(JSON.parse(calls[1][1].body).trialDays, 7);
  for (const value of [0, 1001, 1.5]) await assert.rejects(() => h.genwebsitekeys(interaction({ count: value, plan: 'lifetime' })), /1 to 1000/);
});
test('plain TXT has exactly one unique validated key per line and handles the 1000-key limit', () => {
  for (const bad of [null, ['not-a-key'], [keys[0], keys[0]], [keys[0] + '\nEXTRA'], Array(1001).fill(keys[0])]) assert.throws(() => websiteKeysText(bad), /invalid website-key export/);
  assert.equal(websiteKeysText([]), '');
  const thousand = Array.from({ length: 1000 }, (_, i) => 'QT-' + i.toString(16).toUpperCase().padStart(32, '0').match(/.{4}/g).join('-'));
  const output = websiteKeysText(thousand); assert.equal(output.trim().split('\r\n').length, 1000); assert.ok(Buffer.byteLength(output) < 50000);
});
test('saved batches can be listed/re-exported with safe defaults, empty files and explicit full-recovery warning', async () => {
  const calls = []; let response = { batches: [batch] };
  const h = createWebsiteKeyHandlers({ request: async (p, o) => { calls.push([p, o]); return response; } });
  const list = interaction(); await h.websitebatches(list); assert.ok(!JSON.stringify(list.replies).includes(keys[0])); assert.match(JSON.stringify(list.replies), /2 unused/);
  response = result(); const exp = interaction({ batch_id: id }); await h.exportwebsitekeys(exp); assert.ok(calls.at(-1)[0].endsWith('?unusedOnly=true')); assert.equal(exp.replies[0].files.length, 1);
  response = { ...result(), unusedOnly: false }; const full = interaction({ batch_id: id, unused_only: false }); await h.exportwebsitekeys(full); assert.ok(calls.at(-1)[0].endsWith('?unusedOnly=false')); assert.match(full.replies[0].embeds[0].data.description, /Do not import it as fresh stock/);
  response = { ...result(), keys: [], exportedCount: 0 }; const empty = interaction({ batch_id: id }); await h.exportwebsitekeys(empty); assert.equal(empty.replies[0].files.length, 0);
  await assert.rejects(() => h.exportwebsitekeys(interaction({ batch_id: 'invalid' })), /full batch ID/);
});
test('Discord attachment failures retain recoverable batch IDs; timeout warns before reminting', async () => {
  let calls = 0; const h = createWebsiteKeyHandlers({ request: async () => { calls++; return result(); } });
  const i = interaction({ count: 2, plan: 'lifetime' }); i.editReply = async () => { throw Error('Missing Attach Files'); };
  await assert.rejects(() => h.genwebsitekeys(i), e => e.message.includes(id) && e.message.includes('/exportwebsitekeys')); assert.equal(calls, 1);
  const timed = createWebsiteKeyHandlers({ request: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); } });
  await assert.rejects(() => timed.genwebsitekeys(interaction({ count: 2, plan: 'lifetime' })), /batch may already be saved/);
});
test('batch list remains within embed limits and key info identifies unlinked website ownership', async () => {
  const h = createWebsiteKeyHandlers({ request: async () => ({ batches: Array.from({ length: 20 }, () => ({ ...batch, note: '*'.repeat(500) })) }) });
  const i = interaction({ limit: 20 }); await h.websitebatches(i); assert.ok(i.replies[0].embeds[0].data.description.length < 4096);
  const fields = licenseFields({ source: 'website', id, keyPrefix: 'QT-AAAA-BBBB', plan: 'lifetime', maxDevices: 1, deviceCount: 0, status: 'active' }); assert.match(fields.find(f => f.name === 'Owner').value, /no Discord account required/);
});
test('old backends receive clear required-version error instead of HTML', async () => {
  const saved = globalThis.fetch; globalThis.fetch = async () => new Response('<html>Not found</html>', { status: 404 });
  try { await assert.rejects(() => api('/v1/admin/website-keys/batches'), e => e.code === 'QT-BACKEND-UPDATE' && e.message.includes('0.10.0')); } finally { globalThis.fetch = saved; }
});
