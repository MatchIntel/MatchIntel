import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Events, MessageFlags } from 'discord.js';
import * as formats from '../src/format.js';
const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const staff = '111111111111111111';
const licenses = Array.from({ length: 25 }, (_, n) => ({
  id: `c38da0ff-5a7d-410f-b6d1-${String(n).padStart(12, '0')}`,
  keyPrefix: `QT-${n.toString(16).padStart(4, '0').toUpperCase()}-B247`,
  plan: n % 2 ? 'trial' : 'lifetime', status: n % 3 ? 'active' : 'revoked',
  pendingActivation: n % 2 === 1, maxDevices: 1, deviceCount: n % 2,
  discordUserId: n % 2 ? null : '1142680046004346922'
}));
function compile(name, next, request) {
  return vm.runInNewContext(source.slice(source.indexOf('async function ' + name), source.indexOf('async function ' + next)) + '\n' + name,
    { ...formats, api: request, URLSearchParams, username: user => user.username });
}
function interaction({ limit = null, status = null, plan = null } = {}) {
  const replies = [];
  return { replies, user: { id: staff }, options: { getUser: () => ({ id: staff, username: 'Test customer' }),
    getString: name => ({ status, plan })[name], getInteger: () => limit }, editReply: async payload => replies.push(payload) };
}
function validate(payload) {
  const cards = payload.embeds.map(e => e.toJSON());
  let total = 0;
  for (const card of cards) {
    assert.ok((card.description?.length || 0) <= 4096);
    assert.ok((card.fields?.length || 0) <= 25);
    for (const field of card.fields || []) { assert.ok(field.name.length <= 256); assert.ok(field.value.length <= 1024); total += field.name.length + field.value.length; }
    total += (card.title?.length || 0) + (card.description?.length || 0) + (card.footer?.text?.length || 0);
  }
  assert.ok(total <= 6000);
  return cards;
}
for (const count of [0, 1, 15, 25]) test(`/listkeys displays all ${count} results within Discord limits`, async () => {
  const i = interaction({ limit: count || 15 }), rows = licenses.slice(0, count), calls = [];
  const handle = compile('handleListKeys', 'handleResetDevices', async (path, options) => { calls.push([path, options]); return { licenses: rows }; });
  await handle(i);
  const [card] = validate(i.replies[0]);
  assert.equal(card.fields.length, count || 1);
  for (const row of rows) assert.ok(JSON.stringify(card).includes(row.id), row.id);
  assert.equal(calls[0][1].actor, staff);
  assert.equal(calls[0][0], '/v1/admin/licenses?limit=' + (count || 15));
  assert.equal(i.replies[0].allowedMentions.parse.length, 0);
  if (!count) assert.match(JSON.stringify(card), /No licenses found/);
});
test('/listkeys retains status/plan filters and the default limit', async () => {
  const i = interaction({ status: 'revoked', plan: 'trial' }); let path;
  await compile('handleListKeys', 'handleResetDevices', async p => { path = p; return { licenses: [] }; })(i);
  assert.equal(path, '/v1/admin/licenses?limit=15&status=revoked&plan=trial');
});
test('other long list views use description limits rather than the smaller field limit', async () => {
  const user = interaction();
  await compile('handleFindUser', 'handleListKeys', async () => ({ licenses: licenses.slice(0, 20) }))(user);
  const [users] = validate(user.replies[0]); assert.ok(users.description.length > 1024);
  const audit = interaction();
  await compile('handleAuditLog', 'handleHelp', async () => ({ entries: Array.from({ length: 20 }, () => ({
    action: 'qt.reveal_user', created_at: '2026-10-21T00:00:00Z', actor: staff, target: '222222222222222222'
  })) }))(audit);
  const [audits] = validate(audit.replies[0]); assert.ok(audits.description.length > 1024);
});
test('interaction dispatcher uses private flags and ready listener uses the current event', async () => {
  let dispatch; const deferred = [], calls = [];
  vm.runInNewContext(source.slice(source.indexOf('client.on("interactionCreate"'), source.indexOf('client.on("guildMemberAdd"')), {
    client: { on: (_event, handler) => { dispatch = handler; } }, canUse: () => true,
    ADMIN_COMMANDS: new Set(), OWNER_ONLY_COMMANDS: new Set(), handlers: { listkeys: async () => calls.push('listkeys') },
    MessageFlags, console
  });
  await dispatch({ commandName: 'listkeys', isButton: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
    deferReply: async options => deferred.push(options) });
  assert.equal(deferred[0].flags, MessageFlags.Ephemeral); assert.equal('ephemeral' in deferred[0], false);
  assert.deepEqual(calls, ['listkeys']);
  assert.equal(Events.ClientReady, 'clientReady'); assert.match(source, /client\.once\(Events\.ClientReady,/);
});
