import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import http from 'node:http';import express from 'express';import {PGlite} from '@electric-sql/pglite';
process.env.JWT_SECRET='quilted-test'.repeat(8);process.env.ADMIN_API_KEY='qt-test-admin';process.env.DEVICE_HASH_PEPPER='qt-pepper';process.env.QT_MINIMUM_APP_VERSION='2.6.0';
const {createQtService}=await import('../src/qtLicenses.js');const {createQuiltedAdminRouter}=await import('../src/quiltedAdmin.js');const db=new PGlite();
for(const f of ['001_init.sql','009_qt_optimizer_licenses.sql'])await db.exec(await fs.readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));
const adapt=c=>({query:async(s,a)=>{const r=await c.query(s,a);return {rows:r.rows,rowCount:r.rows.length};}}),execute=adapt(db).query,transaction=fn=>db.transaction(c=>fn(adapt(c))),svc=createQtService({discordRequired:false,execute,transaction});
const actor='111111111111111111',owner='222222222222222222',other='333333333333333333',device='QT1-'+'A'.repeat(64);
const app=express();app.use(express.json());app.use('/v1/qt-admin',createQuiltedAdminRouter({execute,transaction,service:svc}));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/v1/qt-admin`;
async function call(path,{method='GET',body,as=actor,secret=process.env.ADMIN_API_KEY,status=200}={}){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Admin-Key':secret,'X-Admin-Actor':as},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const gen=(plan='lifetime',user=owner)=>call('/licenses',{method:'POST',body:{plan,trialDays:3,discordUserId:user,maxDevices:1}}),post=(p,b={},status=200)=>call(p,{method:'POST',body:b,status});
const activate=k=>svc.activate({licenseKey:k,deviceId:device,deviceName:'Test PC',appVersion:'2.6.0'});
test('familiar key generation, lookup, list, devices and exact reset counts',async()=>{
 await call('/licenses',{method:'POST',secret:'bad',body:{},status:403});await post('/licenses',{plan:'lifetime',discordUserId:owner,maxDevices:2},400);
 const k=await gen();assert.equal(k.license.fullKey,k.licenseKey);assert.equal(k.license.maxDevices,1);assert.equal(k.license.deviceCount,0);
 assert.equal((await post('/keyinfo',{reference:k.license.keyPrefix})).licenses[0].id,k.license.id);await activate(k.licenseKey);
 assert.equal((await call(`/licenses/${k.license.id}/devices`)).devices[0].name,'Test PC');assert.equal((await post('/keyinfo',{reference:device})).matchType,'device');
 const r=await post(`/licenses/${k.license.id}/reset-devices`);assert.equal(r.devicesRemoved,1);assert.equal(r.refreshTokensRevoked,1);const again=await post(`/licenses/${k.license.id}/reset-devices`);assert.equal(again.devicesRemoved,0);assert.equal(again.refreshTokensRevoked,0);
 assert.ok((await call('/licenses?status=active&plan=lifetime&limit=10')).licenses.every(l=>l.product==='qt-optimizer'));
});
test('customer recovery accepts original bot actor headers and rejects another identity',async()=>{
 const k=await gen('trial');const mine=await call(`/users/${owner}/licenses/reveal`,{as:'discord-self:'+owner});assert.ok(mine.licenses.some(l=>l.fullKey===k.licenseKey));await call(`/users/${other}/licenses/reveal`,{as:'discord-self:'+owner,status:403});
 const timed=await call(`/users/${owner}/website-trial/reveal`,{as:'discord-trial-self:'+owner});assert.equal(timed.claimed,true);assert.equal(timed.trial.plan,'trial');
});
test('reissue, extend, convert, transfer, revoke/restore and confirmed deletion',async()=>{
 const k=await gen('trial');await post('/licenses/reissue',{reference:k.license.id,confirmation:'bad'},400);assert.notEqual((await post('/licenses/reissue',{reference:k.license.id,confirmation:'REISSUE KEY'})).licenseKey,k.licenseKey);
 const ext=await post(`/licenses/${k.license.id}/extend`,{days:2});assert.equal(ext.license.activationDurationSeconds,5*86400);assert.equal(ext.license.expiresAt,null);assert.equal((await post(`/licenses/${k.license.id}/convert-lifetime`)).license.plan,'lifetime');
 assert.equal((await post(`/licenses/${k.license.id}/transfer`,{discordUserId:other,discordUsername:'Customer'})).license.discordUserId,other);assert.equal((await post(`/licenses/${k.license.id}/revoke`,{reason:'test'})).license.status,'revoked');assert.equal((await post(`/licenses/${k.license.id}/restore`)).license.status,'active');
 await call(`/licenses/${k.license.id}`,{method:'DELETE',body:{},status:400});assert.equal((await call(`/licenses/${k.license.id}`,{method:'DELETE',body:{confirmation:'DELETE KEY'}})).deleted.id,k.license.id);await call(`/licenses/${k.license.id}`,{status:404});
});
test('user management and scoped bulk controls touch only Quilted licenses',async()=>{
 const a=await gen('trial',other),b=await gen('lifetime',other);await activate(a.licenseKey);await activate(b.licenseKey);const reset=await post(`/users/${other}/reset-devices`);assert.equal(reset.licensesAffected,2);assert.equal(reset.devicesRemoved,2);
 assert.equal((await post(`/users/${other}/revoke`,{reason:'test'})).licensesRevoked,2);const ext=await post('/licenses/bulk-extend',{scope:'revoked',days:2});assert.equal(ext.licensesExtended,1);assert.equal(ext.revokedIncluded,1);
 await post('/licenses/bulk-delete',{scope:'revoked',confirmation:'bad'},400);assert.equal((await post('/licenses/bulk-delete',{scope:'revoked',confirmation:'DELETE ALL KEYS'})).licensesDeleted,2);assert.equal((await db.query('SELECT COUNT(*)::int count FROM licenses')).rows[0].count,0);
});
test('maintenance/version settings govern native activation; status and audit reflect Quilted data',async()=>{
 const k=await gen();await post('/maintenance',{enabled:true,message:'Quilted maintenance'});await assert.rejects(()=>activate(k.licenseKey),e=>e.code==='QT-MAINTENANCE');await post('/maintenance',{enabled:false});await post('/version',{minimumVersion:'2.6.1',latestVersion:'2.6.1',forceUpdate:true});await assert.rejects(()=>activate(k.licenseKey),e=>e.code==='QT-UPDATE-REQUIRED');
 assert.equal((await call('/version')).version.requiredVersion,'2.6.1');assert.equal((await call('/status')).minimumVersion,'2.6.1');assert.ok((await call('/audit')).entries.every(e=>e.action.startsWith('qt.')));await post('/version',{minimumVersion:'2.6.0',latestVersion:'2.6.0',forceUpdate:false});assert.ok((await activate(k.licenseKey)).accessToken);
});
test.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
