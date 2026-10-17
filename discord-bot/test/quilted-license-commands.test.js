import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
for(const[k,v]of Object.entries({DISCORD_TOKEN:'fixture',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_GUILD_ID:'111111111111111111',BACKEND_URL:'https://example.invalid',BACKEND_ADMIN_KEY:'fixture',OWNER_DISCORD_IDS:'111111111111111111'}))process.env[k]=v;
const {commands,publicCommands}=await import('../src/commands.js');const {routeApiPath,api}=await import('../src/api.js');const formats=await import('../src/format.js');const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const key='QT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-AAAA-BBBB';const license={id:'11111111-1111-4111-8111-111111111111',licenseKey:key,fullKey:key,keyPrefix:key.slice(0,12),discordUserId:'222222222222222222',plan:'trial',status:'active',pendingActivation:true,maxDevices:1,deviceCount:0,activationDurationSeconds:259200};
function compile(name,next,api){return vm.runInNewContext(source.slice(source.indexOf('async function '+name),source.indexOf('async function '+next))+'\n'+name,{...formats,config:{defaultTrialDays:3},username:u=>u.username,api,URLSearchParams});}
test('original command names and argument names remain; no product picker or /qtkey',()=>{
 for(const name of ['genkey','keyinfo','reissuekey','finduser','listkeys','resetdevices','devices','revokekey','revokeuser','restorekey','convertkey','transferkey','deletekey','deleteallkeys','extendkey','extendallkeys','maintenance','setversion','versionstatus','systemstatus','auditlog','setuptickets','paymentreminder'])assert.ok(commands.some(c=>c.name===name),name);
 assert.ok(!commands.some(c=>c.name==='qtkey'||c.name==='qtmykey'));const gen=commands.find(c=>c.name==='genkey');assert.deepEqual(gen.options.map(o=>o.name),['user','plan','trial_days','devices','note']);assert.equal(gen.options.find(o=>o.name==='devices').max_value,1);assert.ok(publicCommands.some(c=>c.name==='whatsmykey'));
 for(const command of commands){assert.ok(!command.options?.some(o=>o.name==='product'));assert.doesNotMatch(JSON.stringify(command),/MatchIntel/);}
});
test('all old license/runtime API paths route to Quilted, while live ticket storage stays compatible',()=>{
 for(const path of ['/v1/admin/licenses','/v1/admin/keyinfo','/v1/admin/licenses/x/reset-devices','/v1/admin/users/u/licenses/reveal','/v1/admin/version','/v1/admin/status','/v1/admin/maintenance','/v1/admin/audit?limit=10'])assert.equal(routeApiPath(path),path.replace('/v1/admin','/v1/qt-admin'));
 assert.equal(routeApiPath('/v1/admin/discord/guilds/g/settings'),'/v1/admin/discord/guilds/g/settings');assert.equal(routeApiPath('/v1/admin/discord/releases/claim'),'/v1/admin/discord/releases/claim');
});
test('production /genkey handler generates Quilted QT keys and preserves private delivery',async()=>{
 const requests=[],messages=[],replies=[];const handler=compile('handleGenKey','handleKeyInfo',async(path,options)=>{requests.push({path,options});return {licenseKey:key,license};});
 const target={id:license.discordUserId,username:'customer',send:async m=>messages.push(m)};const i={user:{id:'111111111111111111'},options:{getUser:()=>target,getString:n=>n==='plan'?'trial':null,getInteger:n=>n==='trial_days'?3:null},editReply:async m=>replies.push(m)};
 await handler(i);assert.equal(routeApiPath(requests[0].path),'/v1/qt-admin/licenses');assert.equal(JSON.parse(requests[0].options.body).maxDevices,1);assert.equal(JSON.parse(requests[0].options.body).discordUserId,target.id);assert.equal(messages.length,1);assert.match(JSON.stringify(messages),/Quilted Tweaks/);assert.doesNotMatch(JSON.stringify(messages),/MatchIntel/);assert.match(JSON.stringify(replies),/QT-AAAA/);
});
test('production keyinfo and reset handlers consume compatible QT backend results',async()=>{
 const replies=[],calls=[];const i={user:{id:'111111111111111111'},options:{getString:()=>license.id,getSubcommand:()=>'key'},editReply:async m=>replies.push(m)};
 const info=compile('handleKeyInfo','handleReissueKey',async(p,o)=>{calls.push(p);return {matchType:'license',licenses:[license]};});await info(i);assert.match(JSON.stringify(replies),/QT-AAAA/);
 const reset=compile('handleResetDevices','handleDevices',async(p,o)=>{calls.push(p);return {license,devicesRemoved:1,refreshTokensRevoked:2};});await reset(i);assert.equal(routeApiPath(calls[1]),`/v1/qt-admin/licenses/${license.id}/reset-devices`);
});

test('a missing backend deployment produces a clean actionable error',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<html>Cannot POST /v1/qt-admin/licenses</html>',{status:404});
 try{await assert.rejects(()=>api('/v1/admin/licenses',{method:'POST',body:'{}'}),e=>e.code==='QT-BACKEND-UPDATE'&&e.message.includes('0.8.1')&&!e.message.includes('<html>'));}finally{globalThis.fetch=original;}
});
