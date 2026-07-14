import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
export const randomUuid=()=>crypto.randomUUID();
export const randomToken=(bytes=48)=>crypto.randomBytes(bytes).toString("base64url");
export const sha256=value=>crypto.createHash("sha256").update(String(value)).digest("hex");
export const hashDevice=value=>sha256(`${config.deviceHashPepper}:${value}`);
export function createLicenseKey(){
  const body=crypto.randomBytes(18).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,24);
  return `MI-${body.match(/.{1,4}/g).join("-")}`;
}
export function parseDuration(value){
  const text=String(value||"").trim().toLowerCase();
  if(text==="lifetime") return null;
  const m=/^(\d+)(h|d|w|m|y)$/.exec(text); if(!m) throw new Error("Duration must look like 12h, 7d, 4w, 1m, 1y, or lifetime.");
  const n=Number(m[1]), date=new Date();
  if(m[2]==="h") date.setHours(date.getHours()+n);
  if(m[2]==="d") date.setDate(date.getDate()+n);
  if(m[2]==="w") date.setDate(date.getDate()+n*7);
  if(m[2]==="m") date.setMonth(date.getMonth()+n);
  if(m[2]==="y") date.setFullYear(date.getFullYear()+n);
  return date;
}
export function compareVersions(a,b){
  const p=v=>String(v||"0").split(/[+-]/)[0].split(".").map(x=>Number(x)||0),x=p(a),y=p(b);
  for(let i=0;i<Math.max(x.length,y.length);i++){if((x[i]||0)>(y[i]||0))return 1;if((x[i]||0)<(y[i]||0))return-1;}return 0;
}
export const signAccess=(license,deviceHash)=>jwt.sign({sub:license.id,plan:license.plan,features:license.features||[],deviceHash,type:"access"},config.jwtSecret,{expiresIn:`${config.accessTokenMinutes}m`,issuer:"matchintel"});
export const verifyAccess=token=>jwt.verify(token,config.jwtSecret,{issuer:"matchintel"});
