import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

for (const [key, value] of Object.entries({ DISCORD_TOKEN: 'fixture', DISCORD_CLIENT_ID: '111111111111111111', DISCORD_GUILD_ID: '111111111111111111', BACKEND_URL: 'https://example.invalid', BACKEND_ADMIN_KEY: 'fixture', OWNER_DISCORD_IDS: '111111111111111111', BOT_ADMIN_ROLE_IDS: '222222222222222222', BOT_STAFF_ROLE_IDS: '333333333333333333' })) process.env[key] = value;
const { commands, publicCommands } = await import('../src/commands.js');
const { createSalesHandlers, SALES_ADMIN_COMMANDS } = await import('../src/sales.js');
const { renderDashboardSvg, renderDashboardPng } = await import('../src/salesDashboard.js');
const { routeApiPath, api } = await import('../src/api.js');
const { canUse } = await import('../src/access.js');
const source = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const guild = '111111111111111111', pid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const product = { id: pid, name: 'QT Premium Utility', priceCents: 2500, costCents: 200, active: true, currency: 'USD' };
const sale = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', productId: pid, productName: product.name, unitPriceCents: 2500, unitCostCents: 200, quantity: 2, feeCents: 100, costCents: 400, revenueCents: 5000, profitCents: 4500, soldAt: '2026-10-19T12:00:00Z' };
const data = { period: '7d', currency: 'USD', timezone: 'America/New_York', start: '2026-10-13', end: '2026-10-19', chartStart: '2026-10-13', generatedAt: '2026-10-19T20:00:00Z', product: null, totals: { orders: 2, units: 3, revenueCents: 7500, costCents: 600, feeCents: 150, expenseCents: 1250, expenseCount: 1, saleProfitCents: 6750, profitCents: 5500, averageOrderCents: 3750 }, topProducts: [{ ...product, units: 3, orders: 2, revenueCents: 7500, profitCents: 6750 }], series: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${13 + i}`, orders: i === 6 ? 2 : 0, revenueCents: i === 6 ? 7500 : 0, profitCents: i === 6 ? 6750 : 0 })) };
function interaction(values = {}, { level = 'owner', command = 'confirm', server = guild } = {}) {
  const roles = level === 'admin' ? ['222222222222222222'] : level === 'staff' ? ['333333333333333333'] : [];
  const i = { id: '444444444444444444', guildId: server, guild: { name: 'QT Test Server' }, user: { id: level === 'owner' ? guild : '999999999999999999' }, member: { roles }, commandName: command, options: {}, replies: [], choices: null };
  for (const method of ['getString', 'getNumber', 'getInteger', 'getBoolean', 'getUser']) i.options[method] = name => values[name] ?? null;
  i.options.getFocused = () => ({ name: 'product', value: values.search ?? '' });
  i.editReply = async payload => { i.replies.push(payload); return payload; };
  i.respond = async choices => { i.choices = choices; i.responded = true; };
  return i;
}
test('sales commands have valid options, autocomplete, and distinct access without changing /genkey', () => {
  for (const name of ['confirm', 'addproduct', 'editproduct', 'products', 'dashboard', 'sales', 'voidsale']) assert.ok(commands.some(c => c.name === name));
  for (const name of ['confirm', 'editproduct', 'dashboard']) assert.equal(commands.find(c => c.name === name).options.find(o => o.name === 'product').autocomplete, true);
  for (const c of commands) {
    assert.ok(c.name.length <= 32); assert.ok(c.description.length <= 100); assert.ok((c.options || []).length <= 25);
    let optional = false;
    for (const o of c.options || []) { assert.ok(o.description.length <= 100); if (!o.required) optional = true; else assert.equal(optional, false, c.name); }
  }
  assert.equal(commands.find(c => c.name === 'genkey').options.some(o => o.name === 'product'), false);
  assert.equal(publicCommands.some(c => c.name === 'confirm' || c.name === 'dashboard'), false);
  assert.match(source, /\.\.\.SALES_ADMIN_COMMANDS/); assert.match(source, /isAutocomplete\(\)/); assert.match(source, /deferReply\(\{ flags: MessageFlags\.Ephemeral \}\)/);
});
test('unauthorized users and wrong servers cannot read or write sales or autocomplete', async () => {
  let called = 0;
  const h = createSalesHandlers({ request: async () => { called++; throw new Error('should not run'); } });
  for (const level of ['none', 'staff']) for (const name of SALES_ADMIN_COMMANDS) await assert.rejects(() => h[name](interaction({}, { level, command: name })), /requires/);
  await assert.rejects(() => h.confirm(interaction({}, { level: 'none' })), /requires/);
  await assert.rejects(() => h.confirm(interaction({}, { server: '555555555555555555' })), /configured/);
  await assert.rejects(() => h.dashboard(interaction({}, { server: null })), /configured/);
  const i = interaction({}, { level: 'none' }); await h.autocomplete(i); assert.deepEqual(i.choices, []); assert.equal(called, 0);
  assert.equal(canUse(interaction({}, { level: 'admin' }), 'admin'), true); assert.equal(canUse(interaction({}, { level: 'staff' }), 'admin'), false);
});
test('add/edit products forward exact prices including zero/false and escape replies', async () => {
  const calls = [];
  const h = createSalesHandlers({ request: async (p, o) => { calls.push([p, o]); return { product: { ...product, name: '<QT> @everyone **sale**', active: false } }; } });
  const add = interaction({ name: product.name, price: 25, cost: 0 }); await h.addproduct(add);
  assert.deepEqual(JSON.parse(calls[0][1].body), { name: product.name, price: 25, cost: 0 });
  assert.equal(routeApiPath(calls[0][0]), `/v1/qt-admin/sales/guilds/${guild}/products`);
  const edit = interaction({ product: pid, price: 0, active: false }); await h.editproduct(edit);
  assert.deepEqual(JSON.parse(calls[1][1].body), { price: 0, active: false }); assert.equal(calls[1][1].method, 'PATCH');
  assert.deepEqual(add.replies[0].allowedMentions, { parse: [] }); assert.ok(!add.replies[0].embeds[0].data.description.includes('@everyone'));
  await assert.rejects(() => h.editproduct(interaction({ product: pid })), /Provide/);
});
test('/confirm records paid-sale metadata, default omissions and interaction retry key without generating a license', async () => {
  const calls = [];
  const h = createSalesHandlers({ request: async (p, o) => { calls.push([p, o]); return { sale, duplicate: calls.length > 1 }; } });
  const i = interaction({ product: pid, price: 24.99, quantity: 2, cost: 2, fee: 1, reference: 'Payment-123', customer: { id: '555555555555555555' }, sold_on: '2026-10-18' }, { level: 'staff' });
  await h.confirm(i);
  assert.deepEqual(JSON.parse(calls[0][1].body), { productId: pid, price: 24.99, quantity: 2, cost: 2, fee: 1, customerId: '555555555555555555', paymentReference: 'Payment-123', soldOn: '2026-10-18', interactionId: i.id });
  const second = interaction({ product: pid }); await h.confirm(second);
  assert.deepEqual(JSON.parse(calls[1][1].body), { productId: pid, interactionId: second.id });
  assert.equal(second.replies[0].embeds[0].data.title, 'Sale already recorded'); assert.equal(calls.length, 2); assert.ok(calls.every(([p]) => p.endsWith('/confirm')));
});
test('autocomplete searches the saved database, includes archives only where appropriate and fails safely', async () => {
  const calls = [];
  const h = createSalesHandlers({ request: async (p, o) => { calls.push([p, o]); return { products: [product] }; } });
  for (const command of ['confirm', 'editproduct', 'dashboard']) {
    const i = interaction({ search: 'QT' }, { command }); await h.autocomplete(i);
    assert.equal(i.choices[0].value, pid); assert.match(i.choices[0].name, /\$25\.00/);
    assert.equal(new URL('https://example.invalid' + calls.at(-1)[0]).searchParams.get('archived'), String(command !== 'confirm')); assert.equal(calls.at(-1)[1].timeoutMs, 1800);
  }
  const fail = createSalesHandlers({ request: async () => { throw new Error('offline'); } });
  const i = interaction(); await fail.autocomplete(i); assert.deepEqual(i.choices, []);
});
test('/dashboard posts a generated PNG as a private reply, without publishing to any channel', async () => {
  const png = await renderDashboardPng(data, { serverName: 'QT test' });
  const requests = [];
  const h = createSalesHandlers({ request: async (p, o) => { requests.push([p, o]); return data; } });
  const i = interaction({ period: '7d', product: pid }, { command: 'dashboard' }); await h.dashboard(i);
  assert.match(requests[0][0], /period=7d&productId=/); assert.equal(i.replies.length, 1);
  const result = i.replies[0]; assert.equal(result.files[0].name, 'quilted-tweaks-sales-dashboard.png');
  assert.equal(result.embeds[0].data.image.url, 'attachment://quilted-tweaks-sales-dashboard.png');
  for (const b of [png, result.files[0].attachment]) { assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(b.readUInt32BE(16), 1400); assert.equal(b.readUInt32BE(20), 1000); assert.ok(b.length > 30000 && b.length < 1000000); }
});
test('dashboard handles empty and loss data, escapes SVG input and never includes sale secrets', async () => {
  const malicious = { ...data, product: { name: '<script>alert("x")</script>' }, topProducts: [{ ...data.topProducts[0], name: '<image href="https://bad.example"/>' }], paymentReference: 'PRIVATE-TX', customerId: 'PRIVATE-ID', note: 'PRIVATE-NOTE' };
  const svg = renderDashboardSvg(malicious, { serverName: '<svg>&"' });
  assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('<image')); assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('PRIVATE-'));
  const empty = { ...data, totals: { orders: 0, units: 0, revenueCents: 0, costCents: 0, feeCents: 0, profitCents: 0, averageOrderCents: 0 }, topProducts: [], series: data.series.map(d => ({ ...d, orders: 0, revenueCents: 0, profitCents: 0 })) };
  assert.match(renderDashboardSvg(empty), /No sales recorded/); assert.ok((await renderDashboardPng(empty)).length > 30000);
  const loss = { ...data, totals: { ...data.totals, profitCents: -500 }, series: data.series.map(d => ({ ...d, profitCents: -500 })) };
  assert.ok((await renderDashboardPng(loss)).length > 30000); assert.ok(!renderDashboardSvg(loss).includes('NaN'));
});
test('/sales and /products stay within Discord embed limits; void only changes the ledger', async () => {
  const calls = [];
  const h = createSalesHandlers({ request: async (p, o) => { calls.push([p, o]); if (p.includes('/void')) return { sale, alreadyVoided: false }; if (p.includes('/records?')) return { sales: Array.from({ length: 20 }, () => ({ ...sale, productName: '*'.repeat(80) })) }; return { products: Array.from({ length: 25 }, () => ({ ...product, name: '*'.repeat(80) })) }; } });
  const i = interaction({ limit: 20 }); await h.sales(i); await h.products(i);
  for (const r of i.replies) assert.ok(r.embeds[0].data.description.length < 4096);
  const v = interaction({ sale_id: sale.id, reason: 'Mistake' }); await h.voidsale(v); assert.equal(calls.at(-1)[1].method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { reason: 'Mistake' });
  assert.ok(calls.every(([p]) => p.includes('/sales/guilds/')));
});
test('missing sales deployment gives actionable backend version requirement', async () => {
  const saved = globalThis.fetch; globalThis.fetch = async () => new Response('<html>Not found</html>', { status: 404 });
  try { await assert.rejects(() => api(`/v1/admin/sales/guilds/${guild}/products`), e => e.code === 'QT-BACKEND-UPDATE' && e.message.includes('updated Quilted Tweaks backend')); }
  finally { globalThis.fetch = saved; }
});

test('expense commands are registered privately with required amount/description and optional product', () => {
  for(const name of ['expense','expenses','voidexpense']) {
    const c=commands.find(c=>c.name===name);assert.ok(c);assert.ok(SALES_ADMIN_COMMANDS.includes(name));assert.equal(publicCommands.some(x=>x.name===name),false);
  }
  const c=commands.find(c=>c.name==='expense');assert.equal(c.options[0].name,'amount');assert.equal(c.options[0].min_value,0.01);assert.equal(c.options[0].required,true);assert.equal(c.options[1].name,'description');assert.equal(c.options[1].required,true);
  assert.equal(c.options.find(x=>x.name==='product').autocomplete,true);
});
const expenseRecord={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',description:'Hosting @everyone **bill**',category:'Hosting',amountCents:2001,productName:null,spentAt:'2026-10-19T23:00:00Z'};
test('/expense records an already-paid purchase with retry protection and no money movement',async()=>{
  const calls=[];const h=createSalesHandlers({request:async(p,o)=>{calls.push([p,o]);return {expense:expenseRecord,duplicate:calls.length>1};}});
  const i=interaction({amount:20.01,description:'Railway',category:'Hosting',spent_on:'2026-10-19',reference:'receipt',product:pid},{command:'expense'});await h.expense(i);
  assert.deepEqual(JSON.parse(calls[0][1].body),{amount:20.01,description:'Railway',category:'Hosting',spentOn:'2026-10-19',paymentReference:'receipt',productId:pid,interactionId:i.id});
  assert.equal(routeApiPath(calls[0][0]),`/v1/qt-admin/sales/guilds/${guild}/expenses`);assert.equal(calls[0][1].actor,i.user.id);
  assert.deepEqual(i.replies[0].allowedMentions,{parse:[]});assert.ok(!i.replies[0].embeds[0].data.description.includes('@everyone'));assert.match(i.replies[0].embeds[0].data.description,/does not send money/);
  await h.expense(i);assert.equal(i.replies[1].embeds[0].data.title,'Expense already recorded');
  assert.ok(calls.every(([p])=>p.endsWith('/expenses')));
});
test('/expenses lists safe bounded purchase records and /voidexpense sends an audited correction',async()=>{
  const calls=[];const h=createSalesHandlers({request:async(p,o)=>{calls.push([p,o]);return p.endsWith('/void')?{expense:expenseRecord,alreadyVoided:false}:{expenses:Array.from({length:20},()=>({...expenseRecord,description:'*'.repeat(240)})),timezone:'America/New_York'};}});
  const i=interaction({limit:20,voided:true,product:pid},{command:'expenses'});await h.expenses(i);assert.match(calls[0][0],/voided=true&productId=/);assert.ok(i.replies[0].embeds[0].data.description.length<4096);
  const v=interaction({expense_id:expenseRecord.id,reason:'Duplicate receipt'},{command:'voidexpense'});await h.voidexpense(v);
  assert.ok(calls[1][0].endsWith(`/expenses/${expenseRecord.id}/void`));assert.deepEqual(JSON.parse(calls[1][1].body),{reason:'Duplicate receipt'});assert.match(v.replies[0].embeds[0].data.description,/audit record is preserved/);
});
test('expense-only loss chart renders clearly and never discloses purchase descriptions or receipts',async()=>{
  const report={...data,totals:{...data.totals,orders:0,units:0,revenueCents:0,costCents:0,feeCents:0,expenseCents:2001,expenseCount:1,profitCents:-2001},series:data.series.map((d,i)=>({...d,orders:0,revenueCents:0,expenseCents:i===6?2001:0,profitCents:i===6?-2001:0})),topProducts:[],expenses:[{description:'PRIVATE PURCHASE',paymentReference:'PRIVATE RECEIPT'}]};
  const svg=renderDashboardSvg(report);assert.match(svg,/NET PROFIT/);assert.match(svg,/BUSINESS EXPENSES/);assert.ok(!svg.includes('No sales recorded'));assert.ok(!svg.includes('PRIVATE PURCHASE'));assert.ok(!svg.includes('PRIVATE RECEIPT'));assert.ok(!svg.includes('NaN'));
  assert.ok((await renderDashboardPng(report)).length>30000);
});
test('old backend dashboard cannot silently omit expenses from net profit',async()=>{
  const old={...data,totals:{...data.totals}};delete old.totals.expenseCents;
  const h=createSalesHandlers({request:async()=>old,render:async()=>{throw new Error('must not render incomplete report');}});
  await assert.rejects(()=>h.dashboard(interaction({},{command:'dashboard'})),/updated backend with expense tracking/);
});
