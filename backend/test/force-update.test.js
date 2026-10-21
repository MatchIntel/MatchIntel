import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import http from 'node:http';import express from 'express';import {PGlite} from '@electric-sql/pglite';
process.env.JWT_SECRET='force-update-fixture'.repeat(5);process.env.ADMIN_API_KEY='fixture-admin';process.env.DEVICE_HASH_PEPPER='fixture-pepper';process.env.QT_MINIMUM_APP_VERSION='2.6.0';process.env.OWNER_DISCORD_IDS='111111111111111111';
const {createQtService,createQtRouter}=await import('../src/qtLicenses.js');const {createQuiltedAdminRouter}=await import('../src/quiltedAdmin.js');const {config}=await import('../src/config.js');
const db=new PGlite();for(const file of ['001_init.sql','009_qt_optimizer_licenses.sql'])await db.exec(await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
const adapt=c=>({query:async(s,a)=>{const r=await c.query(s,a);return {rows:r.rows,rowCount:r.rows.length};}});const execute=adapt(db).query,transaction=fn=>db.transaction(c=>fn(adapt(c))),svc=createQtService({discordRequired:false,execute,transaction});
const app=express();app.use(express.json());app.use('/v1/qt',createQtRouter(svc));app.use('/v1/qt-admin',createQuiltedAdminRouter({execute,transaction,service:svc}));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
async function call(path,body,{actor='111111111111111111',secret='fixture-admin',status=200}={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Admin-Key':secret,'X-Admin-Actor':actor},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return {d,r};}
const force=(b,opts)=>call('/v1/qt-admin/force-update',b,opts);
test('force-update requires shared secret, owner identity, valid state/version and HTTPS URL',async()=>{
 const b={enabled:true,version:'2.8.1',updateUrl:'https://example.com/qt'};
 await force(b,{secret:'wrong',status:403});await force(b,{actor:'222222222222222222',status:403});
 for(const override of [{enabled:'false'},{version:'bad'},{updateUrl:'javascript:alert(1)'},{updateUrl:'https://name:password@example.com'}])await force({...b,...override},{status:400});
 config.qtOwnerIds.clear();await force(b,{status:503});config.qtOwnerIds.add('111111111111111111');
});
test('public policy and 426 responses agree, activation and refresh enforce it, release preserves activation',async()=>{
 const k=await svc.generate({plan:'lifetime',discordUserId:'222222222222222222'},'111111111111111111');const device='QT1-'+'A'.repeat(64);
 const grant=await svc.activate({licenseKey:k.licenseKey,deviceId:device,appVersion:'2.8.0'});
 const enabled=(await force({enabled:true,version:'2.8.1',updateUrl:'https://example.com/qt',message:'New QT release'})).d;
 assert.equal(enabled.version.requiredVersion,'2.8.1');assert.equal(enabled.version.minimumVersion,'2.6.0');
 const {d:policy,r}=await call('/v1/qt/config');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(policy.requiredVersion,'2.8.1');assert.equal(policy.updateUrl,'https://example.com/qt');assert.equal(policy.message,'New QT release');assert.ok(!JSON.stringify(policy).includes('fixture-admin'));
 for(const [path,body] of [['/v1/qt/licenses/activate',{licenseKey:k.licenseKey,deviceId:device,appVersion:'2.8.0'}],['/v1/qt/auth/refresh',{refreshToken:grant.refreshToken,deviceId:device,appVersion:'2.8.0'}]]){const {d}=await call(path,body,{status:426});assert.equal(d.code,'QT-UPDATE-REQUIRED');assert.equal(d.requiredVersion,policy.requiredVersion);assert.equal(d.updateUrl,policy.updateUrl);}
 assert.ok((await svc.activate({licenseKey:k.licenseKey,deviceId:device,appVersion:'2.8.1'})).accessToken);
 const released=(await force({enabled:false})).d;assert.equal(released.version.requiredVersion,'2.6.0');assert.ok((await svc.refresh({refreshToken:grant.refreshToken,deviceId:device,appVersion:'2.8.0'})).accessToken);
 assert.ok((await db.query("SELECT * FROM audit_logs WHERE action='qt.version'")).rows.length>=2);
});
test.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
