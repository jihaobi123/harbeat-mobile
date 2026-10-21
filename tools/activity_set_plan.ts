import {readFileSync} from 'node:fs'
import {planActivitySet} from '../vendor/realtime-v3/src/mobile/activity-plan'
// Cloud's installed Node 12 needs only this standard-library compatibility shim.
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{value:function(n:number){const i=n<0?this.length+n:n;return this[i]}})
try{const raw=readFileSync(0,'utf8');if(raw.length>256*1024*1024)throw Error('准备目录超出限制');process.stdout.write(JSON.stringify(planActivitySet(JSON.parse(raw))))}
catch(error){process.stderr.write((error as Error).message+'\n');process.exitCode=1}
