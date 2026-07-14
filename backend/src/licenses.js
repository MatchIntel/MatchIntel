import { tx } from "./db.js";
import { config } from "./config.js";
import { compareVersions,hashDevice,randomToken,randomUuid,sha256,signAccess } from "./security.js";
const pub=l=>({id:l.id,plan:l.plan,status:l.status,expiresAt:l.expires_at,maxDevices:l.max_devices,features:l.features||[]});
async function tokens(c,l,d){const accessToken=signAccess(l,d),refreshToken=randomToken(),expires=new Date(Date.now()+config.refreshTokenDays*86400000);await c.query("INSERT INTO refresh_tokens(id,license_id,device_hash,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)",[randomUuid(),l.id,d,sha256(refreshToken),expires]);return{accessToken,refreshToken}}
export async function activate(req,res){
  const {licenseKey,deviceId,deviceName,appVersion}=req.body||{};
  if(!licenseKey||!deviceId)return res.status(400).json({code:"MI-ACTIVATION-INVALID",message:"License key and device ID are required."});
  if(compareVersions(appVersion,config.minimumAppVersion)<0)return res.status(426).json({code:"MI-UPDATE-REQUIRED",message:`MatchIntel ${config.minimumAppVersion} or newer is required.`,minimumVersion:config.minimumAppVersion,latestVersion:config.latestAppVersion});
  if(config.maintenanceMode)return res.status(503).json({code:"MI-MAINTENANCE",message:config.maintenanceMessage});
  try{const answer=await tx(async c=>{
    const lr=await c.query("SELECT * FROM licenses WHERE key_hash=$1 FOR UPDATE",[sha256(String(licenseKey).trim().toUpperCase())]),l=lr.rows[0];
    if(!l)throw Object.assign(new Error("The MatchIntel key is invalid."),{status:401,code:"MI-KEY-INVALID"});
    if(l.status!=="active")throw Object.assign(new Error(`This key is ${l.status}.`),{status:403,code:"MI-KEY-INACTIVE"});
    if(l.expires_at&&new Date(l.expires_at)<=new Date())throw Object.assign(new Error("This key has expired."),{status:403,code:"MI-KEY-EXPIRED"});
    const d=hashDevice(deviceId),existing=await c.query("SELECT 1 FROM devices WHERE license_id=$1 AND device_hash=$2",[l.id,d]);
    if(!existing.rowCount){const count=await c.query("SELECT COUNT(*)::int count FROM devices WHERE license_id=$1",[l.id]);if(count.rows[0].count>=l.max_devices)throw Object.assign(new Error("This key has reached its device limit."),{status:403,code:"MI-DEVICE-LIMIT"});await c.query("INSERT INTO devices(id,license_id,device_hash,device_name) VALUES($1,$2,$3,$4)",[randomUuid(),l.id,d,String(deviceName||"").slice(0,160)]);}else await c.query("UPDATE devices SET last_seen_at=NOW(),device_name=COALESCE(NULLIF($3,''),device_name) WHERE license_id=$1 AND device_hash=$2",[l.id,d,String(deviceName||"").slice(0,160)]);
    return{...(await tokens(c,l,d)),license:pub(l)};
  });res.json(answer)}catch(error){res.status(error.status||500).json({code:error.code||"MI-ACTIVATION-FAILED",message:error.message})}
}
export async function refresh(req,res){
  const {refreshToken,deviceId}=req.body||{};if(!refreshToken||!deviceId)return res.status(400).json({code:"MI-REFRESH-INVALID",message:"Refresh token and device ID are required."});
  try{const answer=await tx(async c=>{const r=await c.query(`SELECT rt.id token_id,rt.license_id,rt.device_hash,rt.expires_at token_expires,l.* FROM refresh_tokens rt JOIN licenses l ON l.id=rt.license_id WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL FOR UPDATE`,[sha256(refreshToken)]),row=r.rows[0];if(!row||new Date(row.token_expires)<=new Date()||row.status!=="active")throw Object.assign(new Error("The refresh token is invalid or expired."),{status:401,code:"MI-REFRESH-EXPIRED"});const d=hashDevice(deviceId);if(d!==row.device_hash)throw Object.assign(new Error("The refresh token belongs to another device."),{status:401,code:"MI-REFRESH-DEVICE"});await c.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1",[row.token_id]);return{...(await tokens(c,row,d)),license:pub(row)}});res.json(answer)}catch(error){res.status(error.status||500).json({code:error.code||"MI-REFRESH-FAILED",message:error.message})}
}
export const status=(req,res)=>res.json({license:pub(req.auth.license)});
