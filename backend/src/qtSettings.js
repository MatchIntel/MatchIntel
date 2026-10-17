import {config} from './config.js';
import {compareVersions,normalizeVersion,requiredClientVersion} from './versionControl.js';
import {randomUuid} from './security.js';
export function createQtSettings({execute,transaction}){
 const defaults=()=>({maintenance:{enabled:config.qtMaintenance,message:'Quilted Tweaks is temporarily under maintenance.'},version:{minimumVersion:config.qtMinimumVersion,latestVersion:config.qtMinimumVersion,forceUpdate:false,updateUrl:'',message:'Install the latest Quilted Tweaks Optimizer to continue.',source:'defaults'}});
 const merge=rows=>{const result=defaults();for(const row of rows){if(row.key==='qt_maintenance')result.maintenance={...result.maintenance,...row.value};if(row.key==='qt_version')result.version={...result.version,...row.value,source:'database'};}result.version.requiredVersion=requiredClientVersion(result.version);return result;};
 return {
  async get(){return merge((await execute("SELECT key,value FROM app_settings WHERE key IN ('qt_maintenance','qt_version')")).rows);},
  async update(kind,input,actor){
   const current=await this.get();let value;
   if(kind==='maintenance'){value={enabled:Boolean(input.enabled),message:String(input.message||current.maintenance.message).trim().slice(0,500)};}
   else{value={minimumVersion:normalizeVersion(input.minimumVersion,current.version.minimumVersion),latestVersion:normalizeVersion(input.latestVersion||input.minimumVersion,current.version.latestVersion),forceUpdate:Boolean(input.forceUpdate),updateUrl:String(input.updateUrl||'').trim().slice(0,1000),message:String(input.message||current.version.message).trim().slice(0,500)};if(compareVersions(value.latestVersion,value.minimumVersion)<0)throw Object.assign(new Error('Latest version cannot be lower than minimum.'),{status:400,code:'QT-VERSION-RANGE'});if(value.updateUrl&&!/^https:\/\//i.test(value.updateUrl))throw Object.assign(new Error('Use a public HTTPS update URL.'),{status:400,code:'QT-UPDATE-URL'});}
   value.updatedBy=actor;value.updatedAt=new Date().toISOString();
   await transaction(async client=>{await client.query("INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",['qt_'+kind,JSON.stringify(value)]);await client.query('INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)',[randomUuid(),'qt.'+kind,actor,'runtime',JSON.stringify(value)]);});
   return kind==='version'?{version:(await this.get()).version}:{...(await this.get()).maintenance,note:'Quilted Tweaks activation checks use this setting.'};
  }
 };
}
