import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {createQtSettings} from "./qtSettings.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { query, tx } from "./db.js";
import { config } from "./config.js";
import { requireAdmin } from "./auth.js";
import { encryptLicenseKey, decryptLicenseKey, hashDevice, randomToken, randomUuid, sha256, compareVersions } from "./security.js";

export const QT_PRODUCT = "qt-optimizer";
const keyPattern = /^QT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const future = value => value && new Date(value).getTime() <= Date.now();
const discordId = value => { const id=clean(value,30);if(!/^\d{15,25}$/.test(id))fail(400,"QT-DISCORD-ID","A valid Discord user ID is required.");return id; };
export const createQtKey = () => "QT-"+crypto.randomBytes(16).toString("hex").toUpperCase().match(/.{4}/g).join("-");
export function qtDeviceHash(value) {
 if(typeof value!=="string" || !/^QT1-[a-f0-9]{64}$/i.test(value))fail(400,"QT-DEVICE-INVALID","A valid QT device fingerprint is required.");
 return hashDevice("qt-optimizer:"+value.toUpperCase());
}
export function qtPublicLicense(row, reveal=false) {
 return {id:row.id,product:QT_PRODUCT,keyPrefix:row.key_prefix,plan:row.plan,status:row.status,
  activatedAt:row.activated_at,expiresAt:row.expires_at,activationDurationSeconds:Number(row.duration_seconds)||null,
  pendingActivation:row.plan==="trial"&&!row.activated_at,maxDevices:1,deviceBound:Boolean(row.device_hash),
  deviceCount:row.device_hash?1:0,isFreeTrial:false,isUsable:row.status==="active"&&(!row.expires_at||new Date(row.expires_at)>new Date()),features:["optimizer"],
  ...(reveal?{fullKey:decryptLicenseKey(row.key_ciphertext),fullKeyAvailable:Boolean(decryptLicenseKey(row.key_ciphertext)),deviceHash:row.device_hash,licenseKey:decryptLicenseKey(row.key_ciphertext),discordUserId:row.discord_user_id,
   discordUsername:row.discord_username,deviceName:row.device_name,boundAt:row.bound_at,lastSeenAt:row.last_seen_at,
   note:row.note,revokedReason:row.revoked_reason}: {})};
}
export function createQtService({transaction=tx,execute=query}={}) {
 const settings=createQtSettings({execute,transaction});
 const audit=async(client,action,actor,id,details={})=>client.query(
  "INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)",
  [randomUuid(),"qt."+action,actor,id,JSON.stringify(details)]);
 const revokeSessions=async(client,id)=>client.query("UPDATE qt_refresh_tokens SET revoked_at=NOW() WHERE license_id=$1 AND revoked_at IS NULL RETURNING id",[id]);
 const lookup=async(client,reference)=>{
  const ref=clean(reference,100).toUpperCase();let sql,params;
  if(uuidPattern.test(ref)){sql="SELECT * FROM qt_licenses WHERE id=$1 FOR UPDATE";params=[ref];}
  else if(keyPattern.test(ref)){sql="SELECT * FROM qt_licenses WHERE key_hash=$1 FOR UPDATE";params=[sha256(ref)];}
  else if(/^QT1-[a-f0-9]{64}$/i.test(ref)){sql="SELECT * FROM qt_licenses WHERE device_hash=$1 ORDER BY created_at DESC LIMIT 2 FOR UPDATE";params=[qtDeviceHash(ref)];}
  else if(/^QT-[A-F0-9-]{5,12}$/.test(ref)){sql="SELECT * FROM qt_licenses WHERE key_prefix LIKE $1 ORDER BY created_at DESC LIMIT 2 FOR UPDATE";params=[ref+'%'];}
  else fail(400,"QT-REFERENCE","Enter the QT key, prefix, license UUID or copied device ID.");
  const result=await client.query(sql,params);if(!result.rowCount)fail(404,"QT-KEY-NOT-FOUND","Quilted Tweaks license not found.");if(result.rowCount>1)fail(409,"QT-KEY-AMBIGUOUS","This reference matches multiple keys. Use the license UUID.");return result.rows[0];
 };
 const usable=row=>{if(row.status!=="active")fail(403,"QT-KEY-REVOKED","This QT key has been revoked. Contact support.");if(future(row.expires_at))fail(403,"QT-KEY-EXPIRED","This QT key has expired.");};
 const runtime=async version=>{
  const state=await settings.get();if(state.maintenance.enabled)fail(503,"QT-MAINTENANCE",state.maintenance.message);
  if(typeof version!=="string"||!/^\d+\.\d+\.\d+(?:[+-][a-zA-Z0-9.-]+)?$/.test(version)||compareVersions(version,state.version.requiredVersion)<0)fail(426,"QT-UPDATE-REQUIRED",state.version.message);
 };
 const tokens=async(client,row,deviceHash)=>{
  const refreshToken=randomToken();const lifetime=Math.min(config.qtAccessTokenMinutes*60,row.expires_at?Math.floor((new Date(row.expires_at)-Date.now())/1000):Infinity);
  if(lifetime<1)fail(403,"QT-KEY-EXPIRED","This QT key has expired.");
  const accessToken=jwt.sign({sub:row.id,product:QT_PRODUCT,type:"access",deviceHash,ver:row.token_version},config.jwtSecret,
   {issuer:QT_PRODUCT,audience:QT_PRODUCT,algorithm:"HS256",expiresIn:lifetime});
  await client.query("INSERT INTO qt_refresh_tokens(id,license_id,device_hash,token_version,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
   [randomUuid(),row.id,deviceHash,row.token_version,sha256(refreshToken),new Date(Date.now()+config.refreshTokenDays*86400000)]);
  // Bound storage even for long-running clients that rotate every few minutes.
  await client.query("DELETE FROM qt_refresh_tokens WHERE license_id=$1 AND (expires_at<NOW() OR revoked_at<NOW()-INTERVAL '1 day')",[row.id]);
  return {product:QT_PRODUCT,accessToken,refreshToken,leaseSeconds:lifetime,serverTime:new Date().toISOString(),license:qtPublicLicense(row)};
 };
 return {
  settings,
  async activate(body){
   await runtime(body.appVersion);const deviceHash=qtDeviceHash(body.deviceId);const key=clean(body.licenseKey,100).toUpperCase();
   if(!keyPattern.test(key))fail(401,"QT-KEY-INVALID","Enter a valid QT Optimizer key. MatchIntel keys do not unlock QT.");
   return transaction(async client=>{
    let row=await lookup(client,key);usable(row);
    if(row.device_hash&&row.device_hash!==deviceHash)fail(403,"QT-HWID-LOCKED","This key is locked to another PC. Ask staff for a device reset.");
    if(row.plan==="trial"&&!row.expires_at&&!(Number(row.duration_seconds)>0))fail(500,"QT-KEY-CONFIGURATION","The key duration is missing. Contact support.");
    const result=await client.query(`UPDATE qt_licenses SET device_hash=$2,device_name=$3,bound_at=COALESCE(bound_at,NOW()),
     activated_at=COALESCE(activated_at,NOW()),last_seen_at=NOW(),updated_at=NOW(),
     expires_at=CASE WHEN plan='trial' THEN COALESCE(expires_at,NOW()+duration_seconds*INTERVAL '1 second') ELSE NULL END
     WHERE id=$1 RETURNING *`,[row.id,deviceHash,clean(body.deviceName,160)]);
    row=result.rows[0];return tokens(client,row,deviceHash);
   });
  },
  async refresh(body){
   await runtime(body.appVersion);const deviceHash=qtDeviceHash(body.deviceId);
   if(typeof body.refreshToken!=="string"||body.refreshToken.length<40||body.refreshToken.length>200)fail(401,"QT-REFRESH-INVALID","Saved activation is unavailable. Enter your key again.");
   return transaction(async client=>{
    // Lock license before token throughout the API: activate/reset/revoke share
    // this order. Concurrent rotation cannot issue two usable refresh tokens.
    const found=await client.query("SELECT license_id FROM qt_refresh_tokens WHERE token_hash=$1",[sha256(body.refreshToken)]);
    if(!found.rowCount)fail(401,"QT-REFRESH-INVALID","Saved activation has expired. Enter your key again.");
    const row=await lookup(client,found.rows[0].license_id);usable(row);
    const result=await client.query("SELECT * FROM qt_refresh_tokens WHERE token_hash=$1 FOR UPDATE",[sha256(body.refreshToken)]);
    const token=result.rows[0];
    if(!token||token.revoked_at||future(token.expires_at)||token.token_version!==row.token_version)fail(401,"QT-REFRESH-INVALID","Saved activation was reset or expired. Enter your key again.");
    if(token.device_hash!==deviceHash||row.device_hash!==deviceHash)fail(403,"QT-HWID-LOCKED","This activation belongs to another PC.");
    await client.query("UPDATE qt_refresh_tokens SET revoked_at=NOW() WHERE id=$1",[token.id]);
    await client.query("UPDATE qt_licenses SET last_seen_at=NOW() WHERE id=$1",[row.id]);return tokens(client,row,deviceHash);
   });
  },
  async status(token,deviceId){
   let claims;try{claims=jwt.verify(token,config.jwtSecret,{issuer:QT_PRODUCT,audience:QT_PRODUCT,algorithms:["HS256"]});}catch{fail(401,"QT-AUTH-INVALID","QT activation has expired.");}
   if(claims.type!=="access"||claims.product!==QT_PRODUCT)fail(401,"QT-AUTH-INVALID","A QT access token is required.");
   const deviceHash=qtDeviceHash(deviceId);const result=await execute("SELECT * FROM qt_licenses WHERE id=$1",[claims.sub]);const row=result.rows[0];
   if(!row)fail(401,"QT-AUTH-INVALID","QT license no longer exists.");usable(row);
   if(!row.device_hash||row.device_hash!==deviceHash||claims.deviceHash!==deviceHash||claims.ver!==row.token_version)fail(401,"QT-AUTH-INVALID","QT device activation was reset.");
   return {product:QT_PRODUCT,license:qtPublicLicense(row)};
  },
  async generate(body,actor){
   const plan=clean(body.plan,20);if(!["trial","lifetime"].includes(plan))fail(400,"QT-PLAN","Choose trial or lifetime.");
   const days=Number(body.trialDays??3);if(plan==="trial"&&(!Number.isInteger(days)||days<1||days>30))fail(400,"QT-DURATION","Choose 1 to 30 trial days.");
   const owner=discordId(body.discordUserId);actor=discordId(actor);const key=createQtKey();const id=randomUuid();
   return transaction(async client=>{
    const result=await client.query(`INSERT INTO qt_licenses(id,key_hash,key_prefix,key_ciphertext,plan,duration_seconds,discord_user_id,discord_username,issued_by_discord_id,note)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
     [id,sha256(key),key.slice(0,12),encryptLicenseKey(key),plan,plan==="trial"?days*86400:null,owner,clean(body.discordUsername,100),actor,clean(body.note,500)]);
    await audit(client,"generate",actor,id,{plan,owner,trialDays:plan==="trial"?days:null});return {licenseKey:key,license:qtPublicLicense(result.rows[0],true)};
   });
  },
  async list(userId,actor=userId){
   discordId(userId);const result=await execute("SELECT * FROM qt_licenses WHERE discord_user_id=$1 ORDER BY created_at DESC LIMIT 20",[userId]);
   await audit({query:execute},"reveal_user",discordId(actor),userId,{licenseCount:result.rowCount});
   return {licenses:result.rows.map(row=>qtPublicLicense(row,true))};
  },
  async manage(reference,action,body,actor){
   actor=discordId(actor);
   return transaction(async client=>{
    let row=await lookup(client,reference);let key=null;
    if(action==="info"){await audit(client,"reveal",actor,row.id);return {license:qtPublicLicense(row,true)};}
    let result;
    if(action==="reset")result=await client.query("UPDATE qt_licenses SET device_hash=NULL,device_name=NULL,bound_at=NULL,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id]);
    else if(action==="revoke")result=await client.query("UPDATE qt_licenses SET status='revoked',revoked_reason=$2,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,clean(body.reason||"Revoked by staff",300)]);
    else if(action==="restore"){
     if(future(row.expires_at))fail(409,"QT-KEY-EXPIRED","Extend this expired key before restoring it.");
     result=await client.query("UPDATE qt_licenses SET status='active',revoked_reason=NULL,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id]);
    }else if(action==="extend"){
     const days=Number(body.days);if(row.plan!=="trial")fail(409,"QT-LIFETIME","Lifetime keys do not expire.");
     if(!Number.isInteger(days)||days<1||days>3650)fail(400,"QT-DURATION","Choose 1 to 3650 days.");
     result=await client.query(`UPDATE qt_licenses SET duration_seconds=duration_seconds+$2*86400,
      expires_at=CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(expires_at,NOW())+$2*INTERVAL '1 day' END,
      token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *`,[row.id,days]);
    }else if(action==="reissue"){
     key=createQtKey();result=await client.query("UPDATE qt_licenses SET key_hash=$2,key_prefix=$3,key_ciphertext=$4,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,sha256(key),key.slice(0,12),encryptLicenseKey(key)]);
    }else if(action==="convert-lifetime"){
     result=await client.query("UPDATE qt_licenses SET plan='lifetime',duration_seconds=NULL,expires_at=NULL,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id]);
    }else if(action==="transfer"){
     result=await client.query("UPDATE qt_licenses SET discord_user_id=$2,discord_username=$3,token_version=token_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,discordId(body.discordUserId),clean(body.discordUsername,100)]);
    }else if(action==="delete"){
     if(body.confirmation!=="DELETE KEY")fail(400,"QT-CONFIRMATION","Confirmation must exactly equal DELETE KEY.");
     const count=await client.query("SELECT COUNT(*)::int count FROM qt_refresh_tokens WHERE license_id=$1",[row.id]);
     await client.query("DELETE FROM qt_licenses WHERE id=$1",[row.id]);await audit(client,"delete",actor,row.id);
     return {deleted:{id:row.id,keyPrefix:row.key_prefix,discordUserId:row.discord_user_id,devicesDeleted:row.device_hash?1:0,refreshTokensDeleted:count.rows[0].count}};
    }else fail(400,"QT-ACTION","Unknown QT license action.");
    const devicesRemoved=action==="reset"&&row.device_hash?1:0;row=result.rows[0];const revoked=await revokeSessions(client,row.id);await audit(client,action,actor,row.id,{days:action==="extend"?body.days:undefined});
    return {...(key?{licenseKey:key}:{}),license:qtPublicLicense(row,true),devicesRemoved,refreshTokensRevoked:revoked.rowCount};
   });
  }
 };
}
export function createQtRouter(service=createQtService()) {
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
 const call=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(error.status||500).json({code:error.code||"QT-SERVER",message:error.status?error.message:"QT licensing is temporarily unavailable. Try again shortly."});}};
 const activationLimit=rateLimit({windowMs:15*60000,limit:30,skipSuccessfulRequests:true,standardHeaders:true,legacyHeaders:false,message:{code:"QT-RATE-LIMIT",message:"Too many activation attempts. Wait 15 minutes before trying again."}});
 router.get("/config",call(async()=>{const state=await service.settings.get();return {product:QT_PRODUCT,protocol:1,minimumVersion:state.version.minimumVersion,maintenance:state.maintenance.enabled};}));
 router.post("/licenses/activate",activationLimit,call(req=>service.activate(req.body||{})));
 router.post("/auth/refresh",call(req=>service.refresh(req.body||{})));
 router.get("/licenses/status",call(req=>service.status(String(req.headers.authorization||"").replace(/^Bearer /,""),req.headers["x-qt-device"])));
 router.use("/admin",requireAdmin);
 router.post("/admin/licenses",call(req=>service.generate(req.body||{},req.headers["x-admin-actor"])));
 router.get("/admin/users/:userId/licenses",call(req=>service.list(req.params.userId,req.headers["x-admin-actor"])));
 router.post("/admin/licenses/:action",call(req=>service.manage(req.body?.reference,req.params.action,req.body||{},req.headers["x-admin-actor"])));
 return router;
}
