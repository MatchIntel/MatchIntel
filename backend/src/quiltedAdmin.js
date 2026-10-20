import {Router} from 'express';
import {query,tx} from './db.js';
import {config} from './config.js';
import {requireAdmin} from './auth.js';
import {createQtService,qtPublicLicense,qtDeviceHash} from './qtLicenses.js';
import {randomUuid} from './security.js';
import {createSalesRouter,createSalesService} from './sales.js';
const failure=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
function actorId(req){const raw=String(req.headers['x-admin-actor']||'');const match=/^(?:discord-(?:trial-)?self:)?(\d{15,25})$/.exec(raw);if(!match)failure(400,'QT-ACTOR','A Discord actor ID is required.');if(raw.includes('self:')&&req.params.userId!==match[1])failure(403,'QT-OWNER','Customer recovery can only show your own keys.');return match[1];}
const scopeCondition=scope=>{const sql={all:'TRUE',active:"status='active' AND (expires_at IS NULL OR expires_at>NOW())",revoked:"status='revoked'",expired:'expires_at IS NOT NULL AND expires_at<=NOW()',trial:"plan='trial'",lifetime:"plan='lifetime'"}[scope];if(!sql)failure(400,'QT-SCOPE','Unknown scope.');return sql;};
export function createQuiltedAdminRouter({execute=query,transaction=tx,service=createQtService({execute,transaction})}={}){
 const router=Router();router.use(requireAdmin);router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.use('/sales/guilds/:guildId',createSalesRouter({service:createSalesService({execute,transaction})}));
 const handle=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status||500).json({code:e.code||'QT-ADMIN',message:e.status?e.message:'Quilted Tweaks administration is temporarily unavailable.'});}};
 const audit=(c,action,actor,target,details={})=>c.query('INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)',[randomUuid(),'qt.'+action,actor,target,JSON.stringify(details)]);
 const revokeTokens=async(c,ids)=>{const r=await c.query('UPDATE qt_refresh_tokens SET revoked_at=NOW() WHERE license_id=ANY($1::uuid[]) AND revoked_at IS NULL RETURNING id',[ids]);return r.rowCount;};
 router.post('/licenses',handle(req=>{if(Number(req.body?.maxDevices||1)!==1)failure(400,'QT-ONE-PC','Quilted Tweaks keys are locked to one PC. Use devices:1 or leave it blank.');return service.generate(req.body||{},actorId(req));}));
 router.get('/licenses',handle(async req=>{actorId(req);const args=[];const filters=[];for(const [key,allowed] of [['status',['active','revoked']],['plan',['trial','lifetime']]]){const value=req.query[key];if(value){if(!allowed.includes(value))failure(400,'QT-FILTER','Invalid filter.');args.push(value);filters.push(key+'=$'+args.length);}}const limit=Number(req.query.limit||15);if(!Number.isInteger(limit)||limit<1||limit>25)failure(400,'QT-LIMIT','Use a limit from 1 to 25.');args.push(limit);const r=await execute('SELECT * FROM qt_licenses'+(filters.length?' WHERE '+filters.join(' AND '):'')+' ORDER BY created_at DESC LIMIT $'+args.length,args);return {licenses:r.rows.map(row=>qtPublicLicense(row,true))};}));
 router.post('/keyinfo',handle(async req=>{const actor=actorId(req);const ref=String(req.body?.reference||'').trim();if(/^QT1-[a-f0-9]{64}$/i.test(ref)){const rows=await execute('SELECT * FROM qt_licenses WHERE device_hash=$1 ORDER BY created_at DESC LIMIT 25',[qtDeviceHash(ref)]);if(!rows.rowCount)failure(404,'QT-KEY-NOT-FOUND','No Quilted Tweaks key is bound to this device.');await audit({query:execute},'reveal_device',actor,'device',{count:rows.rowCount});return {matchType:'device',licenses:rows.rows.map(r=>qtPublicLicense(r,true))};}const r=await service.manage(ref,'info',{},actor);return {matchType:'license',licenses:[r.license]};}));
 router.post('/licenses/reissue',handle(req=>{if(req.body?.confirmation!=='REISSUE KEY')failure(400,'QT-CONFIRMATION','Confirmation must exactly equal REISSUE KEY.');return service.manage(req.body.reference,'reissue',req.body,actorId(req));}));
 for(const name of ['bulk-delete','bulk-extend'])router.post('/licenses/'+name,handle(async req=>{
  const actor=actorId(req);const scope=String(req.body?.scope||'all');let condition=scopeCondition(scope);let days=null;
  if(name==='bulk-delete'){if(req.body?.confirmation!=='DELETE ALL KEYS')failure(400,'QT-CONFIRMATION','Confirmation must exactly equal DELETE ALL KEYS.');}
  else{if(!['all','active','revoked','expired'].includes(scope))failure(400,'QT-SCOPE','Invalid extension scope.');days=Number(req.body.days);if(!Number.isInteger(days)||days<1||days>3650)failure(400,'QT-DURATION','Choose 1 to 3650 days.');condition="plan='trial' AND ("+condition+')';}
  return transaction(async c=>{const rows=(await c.query('SELECT * FROM qt_licenses WHERE '+condition+' ORDER BY id FOR UPDATE')).rows;const ids=rows.map(r=>r.id);const tokens=ids.length?(await c.query('SELECT COUNT(*)::int count FROM qt_refresh_tokens WHERE license_id=ANY($1::uuid[])',[ids])).rows[0].count:0;
   if(ids.length){if(name==='bulk-delete')await c.query('DELETE FROM qt_licenses WHERE id=ANY($1::uuid[])',[ids]);else{await c.query("UPDATE qt_licenses SET duration_seconds=duration_seconds+$2*86400,expires_at=CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(expires_at,NOW())+$2*INTERVAL '1 day' END,token_version=token_version+1,updated_at=NOW() WHERE id=ANY($1::uuid[])",[ids,days]);await revokeTokens(c,ids);}}
   await audit(c,name,actor,'scope:'+scope,{count:ids.length,days});return name==='bulk-delete'?{scope,licensesDeleted:ids.length,devicesDeleted:rows.filter(r=>r.device_hash).length,refreshTokensDeleted:tokens}:{scope,days,licensesExtended:ids.length,previouslyExpired:rows.filter(r=>r.expires_at&&new Date(r.expires_at)<=new Date()).length,revokedIncluded:rows.filter(r=>r.status==='revoked').length};});
 }));
 for(const suffix of ['/licenses','/licenses/reveal','/website-trial/reveal'])router.get('/users/:userId'+suffix,handle(async req=>{
  const result=await service.list(req.params.userId,actorId(req));if(suffix==='/website-trial/reveal'){const trial=result.licenses.find(l=>l.plan==='trial');return {claimed:Boolean(trial),trial:trial||null};}return result;
 }));
 for(const action of ['reset-devices','revoke'])router.post('/users/:userId/'+action,handle(async req=>{
  const actor=actorId(req),user=req.params.userId;if(!/^\d{15,25}$/.test(user))failure(400,'QT-USER','Invalid Discord user ID.');return transaction(async c=>{
   const rows=(await c.query("SELECT * FROM qt_licenses WHERE discord_user_id=$1"+(action==='revoke'?" AND status='active'":'')+' ORDER BY id FOR UPDATE',[user])).rows;
   const ids=rows.map(r=>r.id);let tokenCount=0;if(ids.length){tokenCount=await revokeTokens(c,ids);if(action==='reset-devices')await c.query('UPDATE qt_licenses SET device_hash=NULL,device_name=NULL,bound_at=NULL,token_version=token_version+1,updated_at=NOW() WHERE id=ANY($1::uuid[])',[ids]);else await c.query("UPDATE qt_licenses SET status='revoked',revoked_reason=$2,token_version=token_version+1,updated_at=NOW() WHERE id=ANY($1::uuid[])",[ids,String(req.body?.reason||'Revoked by staff').slice(0,300)]);}
   await audit(c,action+'_user',actor,user,{count:ids.length});return {licensesAffected:ids.length,licensesRevoked:ids.length,devicesRemoved:rows.filter(r=>r.device_hash).length,refreshTokensRevoked:tokenCount};
  });
 }));
 router.get('/licenses/:ref/devices',handle(async req=>{const r=await service.manage(req.params.ref,'info',{},actorId(req));const l=r.license;return {license:l,devices:l.deviceBound?[{name:l.deviceName||'Activated PC',hash:l.deviceHash,lastSeenAt:l.lastSeenAt,firstSeenAt:l.boundAt}]:[]};}));
 router.get('/licenses/:ref',handle(req=>service.manage(req.params.ref,'info',{},actorId(req))));
 router.delete('/licenses/:ref',handle(req=>service.manage(req.params.ref,'delete',req.body||{},actorId(req))));
 router.post('/licenses/:ref/:action',handle(async req=>{const action=req.params.action==='reset-devices'?'reset':req.params.action;if(!['reset','revoke','restore','extend','convert-lifetime','transfer'].includes(action))failure(400,'QT-ACTION','Unknown key action.');const r=await service.manage(req.params.ref,action,req.body||{},actorId(req));return r;}));
 router.get('/version',handle(async req=>{actorId(req);return {version:(await service.settings.get()).version};}));
 router.post('/version',handle(req=>service.settings.update('version',req.body||{},actorId(req))));
 router.post('/force-update',handle(req=>{
  const actor=actorId(req);
  if(!config.qtOwnerIds.size)failure(503,'QT-OWNER-CONFIG','Set OWNER_DISCORD_IDS on the backend to the same owner IDs used by the bot.');
  if(!config.qtOwnerIds.has(actor))failure(403,'QT-OWNER-ONLY','Only a configured owner can change the update requirement.');
  return service.settings.forceUpdate(req.body||{},actor);
 }));
 router.post('/maintenance',handle(req=>service.settings.update('maintenance',req.body||{},actorId(req))));
 router.get('/status',handle(async req=>{actorId(req);const all=(await execute('SELECT * FROM qt_licenses')).rows;const state=await service.settings.get();const active=all.filter(r=>r.status==='active'&&(!r.expires_at||new Date(r.expires_at)>new Date()));const sessions=(await execute('SELECT COUNT(*)::int count FROM qt_refresh_tokens WHERE revoked_at IS NULL AND expires_at>NOW()')).rows[0].count;return {status:'online',version:state.version.latestVersion,minimumVersion:state.version.minimumVersion,forceUpdate:state.version.forceUpdate,maintenance:state.maintenance.enabled,totalLicenses:all.length,activeLicenses:active.length,activeLifetime:active.filter(r=>r.plan==='lifetime').length,activeTrial:active.filter(r=>r.plan==='trial').length,revokedLicenses:all.filter(r=>r.status==='revoked').length,linkedLicenses:all.length,devices:all.filter(r=>r.device_hash).length,sessions};}));
 router.get('/audit',handle(async req=>{actorId(req);const limit=Math.max(1,Math.min(20,Number(req.query.limit)||10));const action=String(req.query.action||'');const result=action?await execute("SELECT * FROM audit_logs WHERE action LIKE 'qt.%' AND action=$1 ORDER BY created_at DESC LIMIT $2",[action,limit]):await execute("SELECT * FROM audit_logs WHERE action LIKE 'qt.%' ORDER BY created_at DESC LIMIT $1",[limit]);return {entries:result.rows};}));
 return router;
}
