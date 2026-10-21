import test from 'node:test';
import assert from 'node:assert/strict';
for (const [key, value] of Object.entries({ DISCORD_TOKEN: 'fixture', DISCORD_CLIENT_ID: '111111111111111111', DISCORD_GUILD_ID: '111111111111111111', BACKEND_URL: 'https://example.invalid', BACKEND_ADMIN_KEY: 'fixture', OWNER_DISCORD_IDS: '111111111111111111' })) process.env[key] = value;
const { createKeyInfoHandlers } = await import('../src/keyInfo.js');
const { commands } = await import('../src/commands.js');
const guildId = '111111111111111111', staff = guildId, target = '222222222222222222';
const licenses = Array.from({ length: 26 }, (_, n) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, fullKey: 'QT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-AAAA-' + n.toString(16).padStart(4, '0').toUpperCase(),
  keyPrefix: 'QT-AAAA-BBBB', plan: n === 1 ? 'trial' : 'lifetime', status: n === 0 ? 'revoked' : 'active',
  expiresAt: n === 1 ? '2020-01-01T00:00:00Z' : null, discordUserId: target, source: n % 2 ? 'website' : 'discord', deviceCount: 1, maxDevices: 1
}));
function interaction({ user = { id: target }, reference = null, actor = staff, server = guildId } = {}) {
  const replies = [], events = [];
  return { user: { id: actor }, guildId: server, replies, events, options: { getUser: () => user, getString: () => reference },
    editReply: async p => { replies.push(p); }, reply: async p => { events.push(['reply', p]); }, deferUpdate: async () => { events.push(['defer']); } };
}
function fixture({ authorize = () => true, data = licenses } = {}) {
  const calls = [];
  const handlers = createKeyInfoHandlers({ guildId, authorize, request: async (path, options) => {
    const body = JSON.parse(options.body); calls.push({ path, options, body });
    if (body.reference) return { matchType: 'license', licenses: [licenses[0]] };
    const total = data.length, totalPages = Math.max(1, Math.ceil(total / body.limit)), page = Math.min(totalPages, body.page);
    return { matchType: 'user', discordUserId: target, licenses: data.slice((page - 1) * body.limit, page * body.limit), total, totalPages, page, limit: body.limit };
  } });
  return { ...handlers, calls };
}
const json = value => JSON.stringify(value);
test('slash definition offers optional Discord user and backwards-compatible reference', () => {
  const command = commands.find(c => c.name === 'keyinfo');
  assert.deepEqual(command.options.map(o => [o.name, o.type, !!o.required]), [['user', 6, false], ['reference', 3, false]]);
});
test('Discord lookup shows complete keys and statuses with private bounded pages', async () => {
  const f = fixture(), i = interaction(); await f.keyinfo(i);
  assert.equal(f.calls[0].body.discordUserId, target); assert.equal(f.calls[0].options.actor, staff);
  const card = i.replies[0].embeds[0].toJSON();
  assert.match(card.description, /26 linked keys/); assert.match(json(card), /Revoked/); assert.match(json(card), /Expired/);
  assert.match(json(card), /Website purchase/); assert.equal(card.fields.length, 5);
  assert.ok(card.fields.every(field => field.value.length <= 1024)); assert.ok(json(card).length < 6000);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
  assert.ok(i.replies[0].components[0].toJSON().components[0].disabled);
});
test('Next and Previous browse every key, rechecking staff rights on each click', async () => {
  let checks = 0; const f = fixture({ authorize: () => { checks++; return true; } }), i = interaction();
  const seen = new Set();
  for (let page = 1; page <= 6; page++) {
    if (page === 1) await f.keyinfo(i);
    else { i.customId = `qt_keyinfo:${staff}:${target}:${page}`; await f.button(i); }
    const result = i.replies.at(-1); result.embeds[0].toJSON().fields.forEach(field => seen.add(field.value.split('\n')[0]));
    assert.ok(result.components[0].toJSON().components.every(button => button.custom_id.length <= 100));
  }
  assert.equal(seen.size, 26); assert.equal(checks, 6);
  assert.ok(i.replies.at(-1).components[0].toJSON().components[2].disabled);
  i.customId = `qt_keyinfo:${staff}:${target}:5`; await f.button(i);
  assert.match(i.replies.at(-1).embeds[0].toJSON().footer.text, /Page 5 of 6/);
});
test('IDs and mentions also work in reference; full key lookup remains supported', async () => {
  for (const reference of [target, `<@${target}>`, `<@!${target}>`]) {
    const f = fixture(); await f.keyinfo(interaction({ user: null, reference })); assert.equal(f.calls[0].body.discordUserId, target);
  }
  const f = fixture(), i = interaction({ user: null, reference: licenses[0].fullKey }); await f.keyinfo(i);
  assert.equal(f.calls[0].body.reference, licenses[0].fullKey); assert.match(json(i.replies), /Full license key/);
});
test('empty accounts have a clear explanation and no dead navigation buttons', async () => {
  const f = fixture({ data: [] }), i = interaction(); await f.keyinfo(i);
  assert.match(json(i.replies), /No keys are linked/); assert.deepEqual(i.replies[0].components, []);
});
test('missing or conflicting input never queries the backend', async () => {
  const f = fixture();
  await assert.rejects(() => f.keyinfo(interaction({ user: null })), /Choose user/);
  await assert.rejects(() => f.keyinfo(interaction({ reference: 'QT-AAAA' })), /Choose user/);
  assert.equal(f.calls.length, 0);
});
test('staff-only, configured-server-only access survives button clicks and role removal', async () => {
  const denied = fixture({ authorize: () => false }); const i = interaction();
  await assert.rejects(() => denied.keyinfo(i), /staff/);
  i.customId = `qt_keyinfo:${staff}:${target}:2`; await assert.rejects(() => denied.button(i), /staff/);
  assert.equal(i.events.length, 0); assert.equal(denied.calls.length, 0);
  const f = fixture(); await assert.rejects(() => f.keyinfo(interaction({ server: 'different' })), /staff/);
  const outsider = interaction({ actor: target }); outsider.customId = i.customId;
  await f.button(outsider); assert.equal(outsider.events[0][1].flags, 64); assert.equal(f.calls.length, 0);
});
test('old backend responses fail with a deployment instruction instead of showing incomplete keys', async () => {
  const f = createKeyInfoHandlers({ guildId, authorize: () => true, request: async () => ({ licenses: licenses.slice(0, 20) }) });
  await assert.rejects(() => f.keyinfo(interaction()), /backend 0.12.1/);
});
test('v0.12.0 backend reference errors explain the required deployment', async () => {
  const f = createKeyInfoHandlers({ guildId, authorize: () => true, request: async () => { throw Object.assign(new Error('Enter a key'), { code: 'QT-REFERENCE' }); } });
  await assert.rejects(() => f.keyinfo(interaction()), /backend 0.12.1/);
});
