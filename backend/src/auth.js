import crypto from "node:crypto";
import { query } from "./db.js";
import { config } from "./config.js";
import { verifyAccess } from "./security.js";
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
export async function requireAuth(req,res,next){
  try{
    const h=req.headers.authorization||"", token=h.startsWith("Bearer ")?h.slice(7):"";
    if(!token)return res.status(401).json({code:"MI-AUTH-REQUIRED",message:"Authentication is required."});
    const payload=verifyAccess(token), result=await query("SELECT * FROM licenses WHERE id=$1",[payload.sub]), license=result.rows[0];
    if(!license||license.status!=="active")return res.status(401).json({code:"MI-LICENSE-INACTIVE",message:"This license is not active."});
    if(license.expires_at&&new Date(license.expires_at)<=new Date())return res.status(401).json({code:"MI-LICENSE-EXPIRED",message:"This license has expired."});
    req.auth={license,deviceHash:payload.deviceHash,features:license.features||[]};
    await query("UPDATE devices SET last_seen_at=NOW() WHERE license_id=$1 AND device_hash=$2",[license.id,payload.deviceHash]);
    next();
  }catch{res.status(401).json({code:"MI-AUTH-INVALID",message:"The access token is invalid or expired."});}
}
export function requireAdmin(req,res,next){
  const supplied=req.headers["x-admin-key"]||"";
  if(!supplied||!equal(supplied,config.adminApiKey))return res.status(403).json({code:"MI-ADMIN-FORBIDDEN",message:"Administrator access is required."});
  next();
}
