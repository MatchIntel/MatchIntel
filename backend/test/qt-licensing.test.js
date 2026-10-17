import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import {PGlite} from '@electric-sql/pglite';
process.env.QT_MINIMUM_APP_VERSION='2.6.0';
process.env.JWT_SECRET='qt-test-secret'.repeat(6);process.env.ADMIN_API_KEY='test-admin';process.env.DEVICE_HASH_PEPPER='qt-test-pepper';
const {createQtService,createQtRouter,createQtKey,qtDeviceHash}=await import('../src/qtLicenses.js');
const {verifyAccess}=await import('../src/security.js');
const actor='111111111111111111',owner='222222222222222222',device='QT1-'+'A'.repeat(64),other='QT1-'+'B'.repeat(64);
const input=(key,d=device)=>({licenseKey:key,deviceId:d,deviceName:'Test PC',appVersion:'2.6.0'});
const db=new PGlite();
for(const file of ['001_init.sql','009_qt_optimizer_licenses.sql'])await db.exec(await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
const adapt=c=>({query:async(s,a)=>{const r=await c.query(s,a);return {rows:r.rows,rowCount:r.rows.length};}});
const svc=createQtService({execute:adapt(db).query,transaction:fn=>db.transaction(c=>fn(adapt(c)))});
const gen=(plan='lifetime')=>svc.generate({plan,trialDays:3,discordUserId:owner},actor);
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('QT product isolation, strict input, access token binding and encryption',async()=>{
 assert.match(createQtKey(),/^QT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
 await rejects(()=>svc.activate(input('MI-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF')),'QT-KEY-INVALID');
 await rejects(()=>svc.activate(input(createQtKey(),'fake')),'QT-DEVICE-INVALID');
 const k=await gen(),r=await svc.activate(input(k.licenseKey));assert.equal(r.product,'qt-optimizer');assert.equal(r.license.maxDevices,1);assert.ok(r.leaseSeconds>0&&r.leaseSeconds<=900);
 assert.throws(()=>verifyAccess(r.accessToken));
 const mi=jwt.sign({sub:k.license.id,deviceHash:qtDeviceHash(device)},process.env.JWT_SECRET,{issuer:'matchintel',expiresIn:'15m'});
 await rejects(()=>svc.status(mi,device),'QT-AUTH-INVALID');await rejects(()=>svc.status(r.accessToken,other),'QT-AUTH-INVALID');
 assert.equal((await svc.status(r.accessToken,device)).license.id,k.license.id);
 const row=(await db.query('SELECT * FROM qt_licenses WHERE id=$1',[k.license.id])).rows[0];assert.ok(!JSON.stringify(row).includes(device));assert.ok(!row.key_ciphertext.includes(k.licenseKey));
});
test('simultaneous first activation binds exactly one PC',async()=>{
 const k=await gen(),results=await Promise.allSettled([svc.activate(input(k.licenseKey)),svc.activate(input(k.licenseKey,other))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'QT-HWID-LOCKED');
});
test('refresh rotation rejects replay; reset, revocation and restoration invalidate old sessions',async()=>{
 const k=await gen(),first=await svc.activate(input(k.licenseKey));
 await rejects(()=>svc.refresh({refreshToken:first.refreshToken,deviceId:other,appVersion:'2.6.0'}),'QT-HWID-LOCKED');
 const args={refreshToken:first.refreshToken,deviceId:device,appVersion:'2.6.0'},results=await Promise.allSettled([svc.refresh(args),svc.refresh(args)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'QT-REFRESH-INVALID');const next=results.find(r=>r.status==='fulfilled').value;
 await svc.manage(k.license.id,'reset',{},actor);await rejects(()=>svc.status(next.accessToken,device),'QT-AUTH-INVALID');await rejects(()=>svc.refresh({...args,refreshToken:next.refreshToken}),'QT-REFRESH-INVALID');
 const switched=await svc.activate(input(k.licenseKey,other));await svc.manage(k.license.id,'revoke',{reason:'test'},actor);
 await rejects(()=>svc.status(switched.accessToken,other),'QT-KEY-REVOKED');await rejects(()=>svc.activate(input(k.licenseKey,other)),'QT-KEY-REVOKED');
 await svc.manage(k.license.id,'restore',{},actor);assert.ok((await svc.activate(input(k.licenseKey,other))).license.deviceBound);
});
test('timed key starts only on activation, expires, extends without resetting original activation',async()=>{
 const k=await gen('trial');assert.equal(k.license.expiresAt,null);assert.ok(k.license.pendingActivation);
 const first=await svc.activate(input(k.licenseKey)),expiry=new Date(first.license.expiresAt).getTime();assert.ok(expiry>Date.now()+2*86400000);
 await rejects(()=>svc.activate(input(k.licenseKey,other)),'QT-HWID-LOCKED');assert.equal(new Date((await svc.activate(input(k.licenseKey))).license.expiresAt).getTime(),expiry);
 await db.query("UPDATE qt_licenses SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1",[k.license.id]);await rejects(()=>svc.activate(input(k.licenseKey)),'QT-KEY-EXPIRED');
 await svc.manage(k.license.id,'extend',{days:2},actor);assert.ok((await svc.activate(input(k.licenseKey))).leaseSeconds>0);
 const pending=await gen('trial'),extended=await svc.manage(pending.license.id,'extend',{days:2},actor);assert.equal(extended.license.expiresAt,null);assert.equal(extended.license.activationDurationSeconds,5*86400);
});
test('reissue retains hardware binding and changes only QT licenses',async()=>{
 const k=await gen(),a=await svc.activate(input(k.licenseKey)),replaced=await svc.manage(k.license.id,'reissue',{},actor);
 assert.notEqual(replaced.licenseKey,k.licenseKey);assert.ok(replaced.license.deviceBound);
 await rejects(()=>svc.activate(input(k.licenseKey)),'QT-KEY-NOT-FOUND');await rejects(()=>svc.activate(input(replaced.licenseKey,other)),'QT-HWID-LOCKED');await rejects(()=>svc.status(a.accessToken,device),'QT-AUTH-INVALID');
 assert.ok((await svc.list(owner)).licenses.every(l=>l.product==='qt-optimizer'));assert.equal((await db.query('SELECT COUNT(*)::int count FROM licenses')).rows[0].count,0);
});
test('real HTTP router: public protocol, admin authorization, activation, status and version check',async()=>{
 const app=express();app.use(express.json());app.use('/v1/qt',createQtRouter(svc));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/v1/qt`;
 try{
  assert.equal((await(await fetch(base+'/config')).json()).protocol,1);
  assert.equal((await fetch(base+'/admin/licenses',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const issued=await fetch(base+'/admin/licenses',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':process.env.ADMIN_API_KEY,'X-Admin-Actor':actor},body:JSON.stringify({plan:'lifetime',discordUserId:owner})});assert.equal(issued.status,200);const k=await issued.json();
  const activated=await fetch(base+'/licenses/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input(k.licenseKey))});assert.equal(activated.status,200);assert.equal(activated.headers.get('cache-control'),'no-store');const grant=await activated.json();
  assert.equal((await fetch(base+'/licenses/status',{headers:{Authorization:'Bearer '+grant.accessToken,'X-QT-Device':device}})).status,200);
  assert.equal((await fetch(base+'/licenses/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input(k.licenseKey),appVersion:'2.5.0'})})).status,426);
 }finally{await new Promise(r=>server.close(r));}
});
test.after(async()=>db.close());
