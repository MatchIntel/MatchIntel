import { pool } from "../src/db.js";
import { createLicenseKey,parseDuration,randomUuid,sha256 } from "../src/security.js";
const opts={};for(let i=0;i<process.argv.length;i++)if(process.argv[i].startsWith("--")){const k=process.argv[i].slice(2);opts[k]=process.argv[i+1]&&!process.argv[i+1].startsWith("--")?process.argv[++i]:"true"}
const duration=opts.duration||"30d",plan=opts.plan||"pro",maxDevices=Math.max(1,Number(opts.devices||1)),key=createLicenseKey(),id=randomUuid(),expiresAt=parseDuration(duration),features=String(opts.features||"live_lobby,enrichment,history,reports").split(",").map(x=>x.trim()).filter(Boolean);
try{await pool.query(`INSERT INTO licenses(id,key_hash,key_prefix,plan,expires_at,max_devices,features,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,sha256(key),key.slice(0,12),plan,expiresAt,maxDevices,JSON.stringify(features),opts.note||""]);console.log(JSON.stringify({licenseKey:key,id,plan,duration,expiresAt,maxDevices,features},null,2))}finally{await pool.end()}
