import {pool} from '../src/db.js';
import {createQtService} from '../src/qtLicenses.js';
const opts={};for(let i=2;i<process.argv.length;i++){if(process.argv[i].startsWith('--')){const name=process.argv[i].slice(2);opts[name]=process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[++i]:'true';}}
try{
 if(!/^\d{15,25}$/.test(opts.user||''))throw new Error('Pass --user DISCORD_USER_ID. Example: npm run key:create -- --user 123456789012345678 --duration lifetime');
 const duration=opts.duration||'30d';if(duration!=='lifetime'&&!/^(?:[1-9]|[12]\d|30)d$/.test(duration))throw new Error('Use --duration lifetime or 1d through 30d. Timers start on activation.');
 if(opts.devices&&opts.devices!=='1')throw new Error('Quilted Tweaks keys bind to one PC.');
 const answer=await createQtService().generate({discordUserId:opts.user,discordUsername:opts.username||opts.user,plan:duration==='lifetime'?'lifetime':'trial',trialDays:duration==='lifetime'?null:Number(duration.slice(0,-1)),note:opts.note||''},opts.actor||opts.user);
 console.log(JSON.stringify(answer,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}
