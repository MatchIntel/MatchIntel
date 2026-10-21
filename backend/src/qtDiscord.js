import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { encryptLicenseKey, decryptLicenseKey, randomToken, randomUuid, sha256 } from './security.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const secret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(value);
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const equal=(a,b)=>{const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));return left.length===right.length&&crypto.timingSafeEqual(left,right);};
const clean=(value,max)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max);
export const hasDiscordProof=(row,deviceHash)=>Boolean(row.discord_verified_at&&row.discord_verified_user_id===row.discord_user_id&&row.discord_verified_device_hash===deviceHash);

export function createDiscordLink({execute,transaction,lookup,usable,runtime,finishActivation,deviceHashFor,audit,env=process.env,fetcher=fetch}) {
 const clientId=String(env.DISCORD_CLIENT_ID||'').trim(),clientSecret=String(env.DISCORD_CLIENT_SECRET||'').trim();
 const redirectUri=String(env.DISCORD_REDIRECT_URI||'').trim();
 let origin=null;
 try {const u=new URL(redirectUri);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/v1/qt/discord/callback')origin=u.origin;}catch{}
 const configured=Boolean(/^\d{15,25}$/.test(clientId)&&clientSecret.length>=16&&origin);
 const ready=()=>{if(!configured)fail(503,'QT-DISCORD-SETUP','Discord sign-in is not configured on the licensing server. Contact Quilted Tweaks support.');};
 const cookieName=request=>'__Secure-qt-discord-'+request.id;
 const current=request=>{if(!request||new Date(request.expires_at)<=new Date())fail(410,'QT-DISCORD-EXPIRED','This Discord sign-in expired. Enter your key to start again.');};
 const validLicense=(row,request)=>{
  usable(row);
  if(row.device_hash&&row.device_hash!==request.device_hash)fail(403,'QT-HWID-LOCKED','This key is locked to another PC. Ask staff for a device reset.');
  if(row.key_hash!==request.key_hash||row.token_version!==request.token_version)fail(409,'QT-DISCORD-RESET','This key was changed or reset. Enter the key again.');
 };
 async function requestFor(body,{lock=false,client={query:execute}}={}) {
  if(!id(body.requestId)||!secret(body.pollToken))fail(401,'QT-DISCORD-REQUEST','A valid private Discord sign-in request is required.');
  const request=(await client.query('SELECT * FROM qt_discord_link_requests WHERE id=$1'+(lock?' FOR UPDATE':''),[body.requestId])).rows[0];
  if(!request||!equal(request.poll_hash,sha256(body.pollToken)))fail(401,'QT-DISCORD-REQUEST','This Discord sign-in request is invalid.');
  current(request);
  if(request.device_hash!==deviceHashFor(body.deviceId))fail(403,'QT-HWID-LOCKED','This Discord sign-in belongs to another PC.');
  return request;
 }
 async function readIdentity(code,verifier) {
  let token;
  const form={grant_type:'authorization_code',client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,code,code_verifier:verifier};
  try {
   const response=await fetcher('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'QuiltedTweaks-Helper/0.12.0'},body:new URLSearchParams(form),signal:AbortSignal.timeout(12000),redirect:'error'});
   if(!response.ok)fail(502,'QT-DISCORD-EXCHANGE','Discord could not verify this sign-in. Return to QT and try again.');
   const data=await response.json();token=data.access_token;
   if(typeof token!=='string'||token.length<10||String(data.token_type).toLowerCase()!=='bearer'||!String(data.scope||'').split(/\s+/).includes('identify'))fail(502,'QT-DISCORD-RESPONSE','Discord returned an incomplete identity response. Try again.');
   const identity=await fetcher('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token,'User-Agent':'QuiltedTweaks-Helper/0.12.0'},signal:AbortSignal.timeout(12000),redirect:'error'});
   if(!identity.ok)fail(502,'QT-DISCORD-IDENTITY','Discord could not read your account. Try signing in again.');
   const user=await identity.json();
   if(!/^\d{15,25}$/.test(String(user.id))||user.bot||typeof user.username!=='string'||!user.username)fail(502,'QT-DISCORD-IDENTITY','Discord did not return a valid user account.');
   return {id:String(user.id),username:clean(user.username,100),displayName:clean(user.global_name||user.username,100)};
  } finally {
   if(typeof token==='string')try {await fetcher('https://discord.com/api/oauth2/token/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,token,token_type_hint:'access_token'}),signal:AbortSignal.timeout(5000),redirect:'error'});}catch{}
  }
 }
 return {
  configured,
  async begin(client,row,body,deviceHash) {
   ready();
   // Replacing an unfinished attempt on this PC leaves no long-lived poll credentials.
   await client.query("UPDATE qt_discord_link_requests SET phase='cancelled',verifier_ciphertext=NULL WHERE license_id=$1 AND device_hash=$2 AND phase NOT IN ('consumed','cancelled')",[row.id,deviceHash]);
   await client.query("DELETE FROM qt_discord_link_requests WHERE license_id=$1 AND (expires_at<NOW() OR phase IN ('consumed','cancelled'))",[row.id]);
   const active=Number((await client.query("SELECT count(*) AS count FROM qt_discord_link_requests WHERE license_id=$1",[row.id])).rows[0].count);
   if(active>=5)fail(429,'QT-DISCORD-LIMIT','Too many unfinished sign-ins for this key. Wait ten minutes, then try again.');
   const requestId=randomUuid(),pollToken=randomToken(32),ticket=randomToken(32),expires=new Date(Date.now()+10*60000);
   await client.query('INSERT INTO qt_discord_link_requests(id,license_id,key_hash,token_version,device_hash,device_name,poll_hash,start_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[requestId,row.id,row.key_hash,row.token_version,deviceHash,clean(body.deviceName,160),sha256(pollToken),sha256(ticket),expires]);
   return {product:'qt-optimizer',discordRequired:true,link:{requestId,pollToken,startUrl:origin+'/v1/qt/discord/start?ticket='+ticket,expiresAt:expires.toISOString()},keyPrefix:row.key_prefix};
  },
  async start(ticket) {
   ready();if(!secret(ticket))fail(400,'QT-DISCORD-REQUEST','Open Discord sign-in from QT Premium Utility.');
   return transaction(async client=>{
    const request=(await client.query('SELECT * FROM qt_discord_link_requests WHERE start_hash=$1 FOR UPDATE',[sha256(ticket)])).rows[0];current(request);
    if(['consumed','cancelled','exchanging','verified'].includes(request.phase))fail(409,'QT-DISCORD-REQUEST','This sign-in is already completed or replaced. Return to QT Premium Utility.');
    const state=randomToken(32),browser=randomToken(32),verifier=randomToken(32);
    await client.query("UPDATE qt_discord_link_requests SET phase='authorizing',state_hash=$2,browser_hash=$3,verifier_ciphertext=$4,failure_message=NULL WHERE id=$1",[request.id,sha256(state),sha256(browser),encryptLicenseKey(verifier)]);
    const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectUri,scope:'identify',state,prompt:'consent',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return {url:'https://discord.com/oauth2/authorize?'+params,cookieName:cookieName(request),cookieValue:browser};
   });
  },
  async callback(query,cookies) {
   ready();
   if(!secret(query.state)||query.iss&&query.iss!=='https://discord.com')fail(400,'QT-DISCORD-STATE','The Discord sign-in could not be verified. Return to QT and try again.');
   const request=await transaction(async client=>{
    const request=(await client.query('SELECT * FROM qt_discord_link_requests WHERE state_hash=$1 FOR UPDATE',[sha256(query.state)])).rows[0];current(request);
    if(request.phase!=='authorizing'||!equal(request.browser_hash,sha256(cookies[cookieName(request)]||'')))fail(400,'QT-DISCORD-STATE','The sign-in does not match this browser or was already used. Start again from QT.');
    if(query.error) {await client.query("UPDATE qt_discord_link_requests SET phase='denied',failure_message=$2,verifier_ciphertext=NULL WHERE id=$1",[request.id,'Discord sign-in was cancelled. Click Continue with Discord to try again.']);return {...request,denied:true};}
    if(typeof query.code!=='string'||query.code.length<5||query.code.length>512)fail(400,'QT-DISCORD-CODE','Discord did not return a valid sign-in code.');
    await client.query("UPDATE qt_discord_link_requests SET phase='exchanging',state_hash=NULL WHERE id=$1",[request.id]);return request;
   });
   if(request.denied)return {verified:false,cookieName:cookieName(request)};
   try {
    const verifier=decryptLicenseKey(request.verifier_ciphertext);if(!verifier)fail(500,'QT-DISCORD-REQUEST','Restart Discord sign-in from QT.');
    const user=await readIdentity(query.code,verifier);
    const license=(await execute('SELECT * FROM qt_licenses WHERE id=$1',[request.license_id])).rows[0];
    if(!license)fail(404,'QT-KEY-NOT-FOUND','This key no longer exists.');validLicense(license,request);
    if(license.discord_user_id&&license.discord_user_id!==user.id)fail(403,'QT-DISCORD-OWNER','This key belongs to a different Discord account. Sign in with the account that owns it, or contact support.');
    const updated=await execute("UPDATE qt_discord_link_requests SET phase='verified',discord_user_id=$2,discord_username=$3,discord_display_name=$4,verifier_ciphertext=NULL WHERE id=$1 AND phase='exchanging' AND expires_at>NOW() RETURNING id",[request.id,user.id,user.username,user.displayName]);
    if(!updated.rowCount)fail(410,'QT-DISCORD-EXPIRED','This sign-in was replaced or expired. Start again from QT.');
    return {verified:true,cookieName:cookieName(request)};
   }catch(error){await execute("UPDATE qt_discord_link_requests SET phase='denied',failure_message=$2,verifier_ciphertext=NULL WHERE id=$1 AND phase='exchanging'",[request.id,error.status?error.message:'Discord sign-in could not finish. Click Continue with Discord to retry.']);throw error;}
  },
  async poll(body) {
   await runtime(body.appVersion);const request=await requestFor(body);
   const row=(await execute('SELECT * FROM qt_licenses WHERE id=$1',[request.license_id])).rows[0];if(!row)fail(404,'QT-KEY-NOT-FOUND','This key no longer exists.');validLicense(row,request);
   if(['consumed','cancelled'].includes(request.phase))fail(410,'QT-DISCORD-EXPIRED','This sign-in is no longer active. Enter your key again.');
   return {product:'qt-optimizer',phase:request.phase,...(request.phase==='verified'?{discordUser:{id:request.discord_user_id,username:request.discord_username,displayName:request.discord_display_name}}:{}),...(request.phase==='denied'?{message:request.failure_message}:{} )};
  },
  async complete(body) {
   await runtime(body.appVersion);const original=await requestFor(body);
   return transaction(async client=>{
    let row=await lookup(client,original.license_id);
    const request=await requestFor(body,{lock:true,client});
    if(request.phase!=='verified')fail(409,'QT-DISCORD-PENDING','Finish Discord sign-in before continuing.');
    validLicense(row,request);
    if(row.discord_user_id&&row.discord_user_id!==request.discord_user_id)fail(403,'QT-DISCORD-OWNER','This key belongs to another Discord account.');
    row=(await client.query('UPDATE qt_licenses SET discord_user_id=$2,discord_username=$3,discord_verified_at=NOW(),discord_verified_user_id=$2,discord_verified_device_hash=$4,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *',[row.id,request.discord_user_id,request.discord_username,request.device_hash])).rows[0];
    await client.query('UPDATE qt_refresh_tokens SET revoked_at=NOW() WHERE license_id=$1 AND revoked_at IS NULL',[row.id]);
    await client.query("UPDATE qt_discord_link_requests SET phase='consumed',completed_at=NOW(),verifier_ciphertext=NULL WHERE id=$1",[request.id]);
    await audit(client,'discord_linked',request.discord_user_id,row.id,{source:row.issuance_source||'discord'});
    return finishActivation(client,row,request.device_hash,request.device_name);
   });
  },
  async cancel(body) {const request=await requestFor(body);await execute("UPDATE qt_discord_link_requests SET phase='cancelled',verifier_ciphertext=NULL WHERE id=$1 AND phase NOT IN ('consumed','cancelled')",[request.id]);return {product:'qt-optimizer',phase:'cancelled'};}
 };
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function discordResultPage(title,message,success=false) {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QT Premium Utility · Discord</title><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 0,#123b30,transparent 60%),#060e10;color:#eefbf5;font:16px/1.6 system-ui,sans-serif}.card{width:100%;max-width:500px;padding:48px 36px;text-align:center;border:1px solid #26473d;border-radius:28px;background:#0a1719;box-shadow:0 30px 100px #0005;animation:enter .5s ease-out}.mark{display:grid;place-items:center;margin:0 auto 26px;width:76px;height:76px;border:1px solid #34765f;border-radius:22px;background:#103c2e;color:#55e5b1;font-weight:800;font-size:29px}.eyebrow{color:#65d8b2;font-size:11px;letter-spacing:2px;font-weight:650}h1{font-size:29px;line-height:1.25;letter-spacing:-1px;margin:18px 0}p{color:#a2bbb1;margin-bottom:26px}.status{padding:12px 18px;border:1px solid ${success?'#34725b':'#6c5540'};border-radius:12px;background:${success?'#102b22':'#2a2119'};font-size:13px;color:${success?'#8deac5':'#efcba1'}}footer{margin-top:28px;font-size:12px;color:#68877a}@keyframes enter{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.card{animation:none}}</style></head><body><main class="card"><div class="mark">QT</div><div class="eyebrow">QT PREMIUM UTILITY</div><h1>${escape(title)}</h1><p>${escape(message)}</p><div class="status">${success?'Return to QT and confirm the displayed Discord account.':'Your tweaking app stays locked until verification is complete.'}</div><footer>Quilted Tweaks Helper · Secure Discord sign-in</footer></main></body></html>`;
}
export function createDiscordRouter(service) {
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");next();});
 const page=(res,status,title,message,ok=false)=>res.status(status).type('html').send(discordResultPage(title,message,ok));
 const json=fn=>async(req,res)=>{try{res.json(await fn(req.body||{}));}catch(e){res.status(e.status||500).json({code:e.code||'QT-DISCORD-UNAVAILABLE',message:e.status?e.message:'Discord sign-in is temporarily unavailable. Try again shortly.',...(e.status===426?e.update:{})});}};
 const startLimit=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false,message:{code:'QT-DISCORD-RATE',message:'Too many Discord sign-in requests. Wait a minute.'}});
 router.get('/start',startLimit,async(req,res)=>{try{const r=await service.start(req.query.ticket);res.setHeader('Set-Cookie',`${r.cookieName}=${r.cookieValue}; Path=/v1/qt/discord; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);res.redirect(302,r.url);}catch(e){page(res,e.status||500,'Sign-in unavailable',e.status?e.message:'Return to QT and try again.');}});
 router.get('/callback',startLimit,async(req,res)=>{try{const cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));const r=await service.callback(req.query,cookies);res.setHeader('Set-Cookie',`${r.cookieName}=; Path=/v1/qt/discord; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);res.redirect(303,'/v1/qt/discord/result?status='+(r.verified?'verified':'cancelled'));}catch(e){page(res,e.status||500,'Discord sign-in incomplete',e.status?e.message:'Return to QT and try again.');}});
 router.get('/result',(req,res)=>req.query.status==='verified'?page(res,200,'You’re signed in.','Discord verified your account. Return to QT Premium Utility to finish linking your key.',true):page(res,200,'Sign-in cancelled','No account was linked. Return to QT Premium Utility and try again.'));
 router.post('/poll',rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false,message:{code:'QT-DISCORD-RATE',message:'Please wait before checking sign-in again.'}}),json(body=>service.poll(body)));
 router.post('/complete',startLimit,json(body=>service.complete(body)));
 router.post('/cancel',startLimit,json(body=>service.cancel(body)));
 return router;
}
