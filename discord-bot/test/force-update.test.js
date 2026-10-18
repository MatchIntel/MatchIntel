import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
for(const[k,v]of Object.entries({DISCORD_TOKEN:'fixture',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_GUILD_ID:'111111111111111111',BACKEND_URL:'https://example.invalid',BACKEND_ADMIN_KEY:'fixture',OWNER_DISCORD_IDS:'111111111111111111',ADMIN_ROLE_IDS:'333333333333333333'}))process.env[k]=v;
const {commands}=await import('../src/commands.js');const {accessLevel}=await import('../src/access.js');const {routeApiPath,api}=await import('../src/api.js');const formats=await import('../src/format.js');const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const compile=api=>vm.runInNewContext(source.slice(source.indexOf('async function handleForceUpdate('),source.indexOf('async function handleVersionStatus('))+'\nhandleForceUpdate',{...formats,api,accessLevel});
const interaction=(user,opts={},roles=[])=>({user:{id:user},member:{roles},options:{getBoolean:()=>opts.enabled,getString:n=>opts[n]||null},editReply:async x=>x});
test('command is registered and restricted to configured owners',async()=>{
 const c=commands.find(c=>c.name==='forceupdate');assert.ok(c);assert.equal(c.options[0].name,'enabled');assert.ok(c.options[0].required);assert.match(source,/OWNER_ONLY_COMMANDS = new Set\([^;]*"forceupdate"/);
 const h=compile(()=>{throw Error('Must not call backend')});for(const i of [interaction('222222222222222222'),interaction('222222222222222222',{},['333333333333333333'])])await assert.rejects(()=>h(i),/Only configured owner/);
});
test('owner command enables/releases using only the dedicated QT endpoint',async()=>{
 const calls=[];const h=compile(async(p,o)=>{calls.push({p,o});return {version:{requiredVersion:'2.8.1',forceUpdate:true,updateUrl:'https://example.com/qt',message:'Update QT'}};});
 await assert.rejects(()=>h(interaction('111111111111111111',{enabled:true})),/provide version/);assert.equal(calls.length,0);
 const reply=await h(interaction('111111111111111111',{enabled:true,version:'2.8.1',update_url:'https://example.com/qt',message:'Update QT'}));assert.equal(routeApiPath(calls[0].p),'/v1/qt-admin/force-update');assert.equal(JSON.parse(calls[0].o.body).enabled,true);assert.match(JSON.stringify(reply),/Update required/);
 await h(interaction('111111111111111111',{enabled:false}));assert.equal(JSON.parse(calls[1].o.body).enabled,false);
});

test('old backend gives the exact force-update deployment requirement',async()=>{const saved=globalThis.fetch;globalThis.fetch=async()=>new Response('<html>Cannot POST</html>',{status:404});try{await assert.rejects(()=>api('/v1/admin/force-update',{method:'POST',body:'{}'}),e=>e.code==='QT-BACKEND-UPDATE'&&e.message.includes('0.8.2'));}finally{globalThis.fetch=saved;}});
