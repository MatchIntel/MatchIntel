import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
process.env.JWT_SECRET='discord-fixture-'.repeat(8);process.env.ADMIN_API_KEY='discord-admin';process.env.DEVICE_HASH_PEPPER='discord-device-pepper';
const {createQtService,createQtRouter}=await import('../src/qtLicenses.js');
const {createWebsiteKeyService}=await import('../src/websiteKeys.js');
const {createQuiltedAdminRouter}=await import('../src/quiltedAdmin.js');
const db=new PGlite();for(const name of ['001_init.sql','009_qt_optimizer_licenses.sql','011_qt_website_key_batches.sql','013_qt_discord_link.sql'])await db.exec(await fs.readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
const adapt=c=>({query:async(sql,args)=>{const r=await c.query(sql,args);return {rows:r.rows,rowCount:r.rows.length};}}),execute=adapt(db).query,transaction=fn=>db.transaction(c=>fn(adapt(c)));
const owner='111111111111111111',other='222222222222222222',actor='333333333333333333',device='QT1-'+'A'.repeat(64),deviceB='QT1-'+'B'.repeat(64);
const oauth={DISCORD_CLIENT_ID:'444444444444444444',DISCORD_CLIENT_SECRET:'fixture-private-client-secret',DISCORD_REDIRECT_URI:'https://licensing.example.test/v1/qt/discord/callback'};
let user={id:owner,username:'quilted_test',global_name:'Quilted Test'},calls=[],tokenFailure=false;
const fetcher=async(url,options)=>{calls.push([url,options]);if(url.endsWith('/token/revoke'))return new Response('{}');if(url.endsWith('/token'))return new Response(JSON.stringify(tokenFailure?{error:'invalid_grant'}:{access_token:'fixture-private-access-token',token_type:'Bearer',scope:'identify'}),{status:tokenFailure?400:200});if(url.endsWith('/users/@me'))return new Response(JSON.stringify(user));throw new Error('Unexpected Discord request');};
const svc=createQtService({execute,transaction,discordEnv:oauth,discordFetch:fetcher});
const stock=createWebsiteKeyService({execute,transaction});let serial=700000000000000000n;
async function key(plan='lifetime'){return (await stock.generate({count:1,plan,trialDays:3,maxDevices:1,requestId:String(++serial)},actor)).keys[0];}
const activation=(licenseKey,dev=device)=>({licenseKey,deviceId:dev,deviceName:'Fixture PC',appVersion:'3.0.0'});
const proof=(gate,dev=device)=>({requestId:gate.link.requestId,pollToken:gate.link.pollToken,deviceId:dev,appVersion:'3.0.0'});
async function open(gate){const ticket=new URL(gate.link.startUrl).searchParams.get('ticket');const start=await svc.discord.start(ticket);const url=new URL(start.url);return {start,url,query:{code:'fixture-code',state:url.searchParams.get('state'),iss:'https://discord.com'},cookies:{[start.cookieName]:start.cookieValue}};}
async function authorize(gate){const flow=await open(gate);await svc.discord.callback(flow.query,flow.cookies);return flow;}
const app=express();app.use(express.json());app.use('/v1/qt',createQtRouter(svc));app.use('/v1/qt-admin',createQuiltedAdminRouter({execute,transaction,service:svc}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
async function api(path,{body,cookie,headers={},status=200,redirect='manual'}={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),redirect});assert.equal(r.status,status,await r.clone().text());return r;}

test('valid keys return a private Discord challenge with no app grant or trial countdown',async()=>{
 const k=await key('trial'),gate=await svc.activate(activation(k));assert.equal(gate.discordRequired,true);assert.ok(!gate.accessToken&&!gate.refreshToken);assert.ok(!JSON.stringify(gate).includes(k));
 const row=(await execute('SELECT * FROM qt_licenses WHERE key_prefix=$1',[k.slice(0,12)])).rows[0];assert.equal(row.activated_at,null);assert.equal(row.expires_at,null);assert.equal(row.device_hash,null);assert.equal(row.discord_user_id,null);
 const before=await svc.discord.poll(proof(gate));assert.equal(before.phase,'pending');assert.ok(!before.discordUser);
});
test('browser flow uses Helper OAuth application, identify only, state/cookie binding and PKCE; secrets stay server-side',async()=>{
 calls=[];const gate=await svc.activate(activation(await key()));const flow=await open(gate);
 assert.equal(flow.url.origin,'https://discord.com');assert.equal(flow.url.searchParams.get('client_id'),oauth.DISCORD_CLIENT_ID);assert.equal(flow.url.searchParams.get('scope'),'identify');assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');assert.ok(!flow.url.href.includes(oauth.DISCORD_CLIENT_SECRET));
 await svc.discord.callback(flow.query,flow.cookies);
 const exchange=calls.find(([url])=>url.endsWith('/token'));const form=new URLSearchParams(exchange[1].body);assert.equal(form.get('client_secret'),oauth.DISCORD_CLIENT_SECRET);assert.equal(form.get('redirect_uri'),oauth.DISCORD_REDIRECT_URI);assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'),flow.url.searchParams.get('code_challenge'));
 assert.ok(calls.some(([url])=>url.endsWith('/token/revoke')));assert.equal((await svc.discord.poll(proof(gate))).phase,'verified');
 const row=(await execute('SELECT discord_user_id FROM qt_licenses WHERE id=(SELECT license_id FROM qt_discord_link_requests WHERE id=$1)',[gate.link.requestId])).rows[0];assert.equal(row.discord_user_id,null,'browser alone cannot claim a key before in-app confirmation');
});
test('in-app confirmation atomically links website key, binds one PC, enables bot recovery and issues a valid cached session',async()=>{
 const k=await key('trial'),gate=await svc.activate(activation(k));await authorize(gate);
 const ready=await svc.discord.poll(proof(gate));assert.equal(ready.discordUser.id,owner);assert.equal(ready.discordUser.displayName,'Quilted Test');
 const grant=await svc.discord.complete(proof(gate));assert.equal(grant.license.discordLinked,true);assert.equal(grant.license.deviceBound,true);assert.ok(grant.accessToken);assert.ok(grant.license.activatedAt);assert.ok(grant.license.expiresAt);
 assert.equal((await svc.list(owner)).licenses.some(l=>l.fullKey===k),true);
 const recovery=await api(`/v1/qt-admin/users/${owner}/licenses/reveal`,{headers:{'X-Admin-Key':'discord-admin','X-Admin-Actor':'discord-self:'+owner}});assert.ok((await recovery.json()).licenses.some(l=>l.fullKey===k));
 const staffLookup=await api('/v1/qt-admin/keyinfo',{body:{discordUserId:owner,page:1,limit:5},headers:{'X-Admin-Key':'discord-admin','X-Admin-Actor':actor}});const linked=await staffLookup.json();assert.equal(linked.matchType,'user');assert.ok(linked.licenses.some(l=>l.fullKey===k&&l.source==='website'&&l.discordUserId===owner));
 assert.equal((await svc.status(grant.accessToken,device)).license.discordLinked,true);
 assert.ok((await svc.refresh({refreshToken:grant.refreshToken,deviceId:device,appVersion:'3.0.0'})).accessToken);
 await assert.rejects(()=>svc.discord.complete(proof(gate)),e=>e.code==='QT-DISCORD-PENDING');
});
test('a different Discord account cannot claim an already owned key',async()=>{
 const generated=await svc.generate({plan:'lifetime',discordUserId:owner},actor);const gate=await svc.activate(activation(generated.licenseKey));const flow=await open(gate);user={...user,id:other};
 try{await assert.rejects(()=>svc.discord.callback(flow.query,flow.cookies),e=>e.code==='QT-DISCORD-OWNER');assert.equal((await svc.discord.poll(proof(gate))).phase,'denied');await assert.rejects(()=>svc.discord.complete(proof(gate)),e=>e.status===409);}
 finally{user={...user,id:owner};}
});
test('state mismatch, missing browser cookie, callback replay and OAuth cancellation never unlock the app',async()=>{
 const gate=await svc.activate(activation(await key())),flow=await open(gate);
 await assert.rejects(()=>svc.discord.callback({...flow.query,state:'A'.repeat(43)},flow.cookies),e=>e.code==='QT-DISCORD-EXPIRED');
 await assert.rejects(()=>svc.discord.callback(flow.query,{}),e=>e.code==='QT-DISCORD-STATE');
 await assert.rejects(()=>svc.discord.callback({...flow.query,iss:'https://attacker.test'},flow.cookies),e=>e.code==='QT-DISCORD-STATE');
 await svc.discord.callback({...flow.query,error:'access_denied'},flow.cookies);assert.equal((await svc.discord.poll(proof(gate))).phase,'denied');
 await assert.rejects(()=>svc.discord.callback(flow.query,flow.cookies),e=>e.code==='QT-DISCORD-STATE');
 const again=await open(gate);await svc.discord.callback(again.query,again.cookies);await assert.rejects(()=>svc.discord.callback(again.query,again.cookies));
});
test('poll and confirmation require the private poll secret and matching device; expired and cancelled challenges fail closed',async()=>{
 const gate=await svc.activate(activation(await key()));
 await assert.rejects(()=>svc.discord.poll({...proof(gate),pollToken:'A'.repeat(43)}),e=>e.status===401);
 await assert.rejects(()=>svc.discord.poll(proof(gate,deviceB)),e=>e.code==='QT-HWID-LOCKED');
 await assert.rejects(()=>svc.discord.complete(proof(gate)),e=>e.code==='QT-DISCORD-PENDING');
 await svc.discord.cancel(proof(gate));await assert.rejects(()=>svc.discord.poll(proof(gate)),e=>e.status===410);
 const expired=await svc.activate(activation(await key()));await execute("UPDATE qt_discord_link_requests SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[expired.link.requestId]);
 await assert.rejects(()=>svc.discord.poll(proof(expired)),e=>e.status===410);await assert.rejects(()=>open(expired),e=>e.status===410);
});
test('two PCs cannot both claim the same website key even when both finish OAuth first',async()=>{
 const k=await key();const a=await svc.activate(activation(k)),b=await svc.activate(activation(k,deviceB));await authorize(a);await authorize(b);
 const granted=await svc.discord.complete(proof(a));assert.ok(granted.accessToken);
 await assert.rejects(()=>svc.discord.complete(proof(b,deviceB)),e=>e.code==='QT-HWID-LOCKED');
 await assert.rejects(()=>svc.activate(activation(k,deviceB)),e=>e.code==='QT-HWID-LOCKED');
});
test('reissue/revoke during OAuth cancels final authorization; audit failure cannot partially claim a license',async()=>{
 const k=await key(),gate=await svc.activate(activation(k));await authorize(gate);await svc.manage(k,'reissue',{},actor);await assert.rejects(()=>svc.discord.complete(proof(gate)),e=>e.code==='QT-DISCORD-RESET');
 const k2=await key(),gate2=await svc.activate(activation(k2));await authorize(gate2);await svc.manage(k2,'revoke',{reason:'Test'},actor);await assert.rejects(()=>svc.discord.complete(proof(gate2)),e=>e.code==='QT-KEY-REVOKED');
 const broken=createQtService({execute,transaction:fn=>transaction(c=>fn({query:(sql,args)=>{if(sql.startsWith('INSERT INTO audit_logs'))throw new Error('fixture audit error');return c.query(sql,args);}})),discordEnv:oauth,discordFetch:fetcher});
 const k3=await key(),gate3=await svc.activate(activation(k3));await authorize(gate3);await assert.rejects(()=>broken.discord.complete(proof(gate3)),/fixture audit error/);
 assert.equal((await execute('SELECT discord_user_id FROM qt_licenses WHERE id=(SELECT license_id FROM qt_discord_link_requests WHERE id=$1)',[gate3.link.requestId])).rows[0].discord_user_id,null);
 assert.equal((await svc.discord.poll(proof(gate3))).phase,'verified');
});
test('legacy cached activation requires OAuth before renewal and old access tokens cannot pass status',async()=>{
 const legacy=createQtService({execute,transaction,discordRequired:false});const generated=await legacy.generate({plan:'lifetime',discordUserId:owner},actor);const grant=await legacy.activate(activation(generated.licenseKey));
 await assert.rejects(()=>svc.status(grant.accessToken,device),e=>e.code==='QT-DISCORD-REQUIRED');
 const gate=await svc.refresh({refreshToken:grant.refreshToken,deviceId:device,appVersion:'3.0.0'});assert.equal(gate.discordRequired,true);assert.ok(!gate.accessToken);await authorize(gate);assert.ok((await svc.discord.complete(proof(gate))).accessToken);
});
test('missing OAuth configuration and Discord failures cannot fall back to key-only activation',async()=>{
 const missing=createQtService({execute,transaction,discordEnv:{}});await assert.rejects(async()=>missing.activate(activation(await key())),e=>e.code==='QT-DISCORD-SETUP');
 const gate=await svc.activate(activation(await key())),flow=await open(gate);tokenFailure=true;
 try{await assert.rejects(()=>svc.discord.callback(flow.query,flow.cookies),e=>e.code==='QT-DISCORD-EXCHANGE');assert.equal((await svc.discord.poll(proof(gate))).phase,'denied');}finally{tokenFailure=false;}
});
test('production HTTP flow uses secure cookies, private responses and clean branded browser pages',async()=>{
 const gate=await (await api('/v1/qt/licenses/activate',{body:activation(await key())})).json();
 const start=await api('/v1/qt/discord/start?ticket='+new URL(gate.link.startUrl).searchParams.get('ticket'),{status:302});
 const cookie=start.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Lax'])assert.ok(cookie.includes(flag));assert.equal(start.headers.get('referrer-policy'),'no-referrer');
 const state=new URL(start.headers.get('location')).searchParams.get('state');
 const callback=await api('/v1/qt/discord/callback?'+new URLSearchParams({state,code:'fixture-code',iss:'https://discord.com'}),{cookie:cookie.split(';')[0],status:303});assert.ok(!callback.headers.get('location').includes('fixture-code'));
 const page=await api(callback.headers.get('location'));assert.equal(page.headers.get('cache-control'),'no-store');assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.match(await page.text(),/QT PREMIUM UTILITY/);
 const ready=await (await api('/v1/qt/discord/poll',{body:proof(gate)})).json();assert.equal(ready.phase,'verified');
 const grant=await (await api('/v1/qt/discord/complete',{body:proof(gate)})).json();assert.equal(grant.license.discordLinked,true);
});
test.after(async()=>{await new Promise(r=>server.close(r));await db.close();});

test('older clients receive their existing update-screen protocol instead of a key-only grant',async()=>{
 const r=await api('/v1/qt/licenses/activate',{body:{...activation(await key()),appVersion:'2.9.0'},status:426});const data=await r.json();assert.equal(data.code,'QT-UPDATE-REQUIRED');assert.equal(data.requiredVersion,'3.0.0');
 const c=await (await api('/v1/qt/config')).json();assert.equal(c.protocol,1);assert.equal(c.activationProtocol,2);assert.equal(c.requiredVersion,'3.0.0');assert.equal(c.discordConfigured,true);
 const admin=await (await api('/v1/qt-admin/version',{headers:{'X-Admin-Key':'discord-admin','X-Admin-Actor':actor}})).json();assert.equal(admin.version.requiredVersion,'3.0.0');
});
test('replacement requests invalidate stale attempts and unfinished request storage is bounded per key',async()=>{
 const k=await key(),old=await svc.activate(activation(k));const fresh=await svc.activate(activation(k));await assert.rejects(()=>svc.discord.poll(proof(old)),e=>e.status===401);assert.equal((await svc.discord.poll(proof(fresh))).phase,'pending');
 for(let i=1;i<=4;i++)await svc.activate(activation(k,'QT1-'+String(i).repeat(64)));
 await assert.rejects(()=>svc.activate(activation(k,'QT1-'+'6'.repeat(64))),e=>e.code==='QT-DISCORD-LIMIT');
});

test('maintenance and a higher required version are rechecked after Discord approval',async()=>{
 const gate=await svc.activate(activation(await key()));await authorize(gate);
 await svc.settings.update('maintenance',{enabled:true,message:'Fixture maintenance'},actor);
 await assert.rejects(()=>svc.discord.complete(proof(gate)),e=>e.code==='QT-MAINTENANCE');
 await svc.settings.update('maintenance',{enabled:false},actor);
 await svc.settings.forceUpdate({enabled:true,version:'3.1.0',updateUrl:'https://quiltedtweaks.com'},actor);
 await assert.rejects(()=>svc.discord.complete(proof(gate)),e=>e.code==='QT-UPDATE-REQUIRED'&&e.update.requiredVersion==='3.1.0');
 await svc.settings.forceUpdate({enabled:false},actor);
 assert.equal((await svc.discord.complete(proof(gate))).license.discordLinked,true);
});
