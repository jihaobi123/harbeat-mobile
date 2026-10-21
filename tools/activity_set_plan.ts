import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {planActivitySet} from '../vendor/realtime-v3/src/mobile/activity-plan'
import {planForActivityEdge} from '../vendor/realtime-v3/src/mobile/activity-candidates'
import {verifyJetsonDecision} from '../vendor/realtime-v3/src/mobile/jetson-contract'
// Cloud's installed Node 12 needs only this standard-library compatibility shim.
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{value:function(n:number){const i=n<0?this.length+n:n;return this[i]}})
if(!globalThis.crypto?.subtle)Object.defineProperty(globalThis,'crypto',{value:{subtle:{digest:async(_algorithm:unknown,data:ArrayBuffer)=>{const bytes=createHash('sha256').update(new Uint8Array(data)).digest();return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}}}})
async function main(){
 const raw=readFileSync(0,'utf8');if(raw.length>256*1024*1024)throw Error('准备目录超出限制')
 const input=JSON.parse(raw)
 if(input.operation==='verifyJetsonStrategy'){
  const a=input.tracks?.find((t:any)=>t.id===input.edge?.from),b=input.tracks?.find((t:any)=>t.id===input.edge?.to)
  if(!a||!b||!Number.isInteger(input.energy)||input.energy<1||input.energy>5)throw Error('预约批准校验资料不完整')
  const plan=planForActivityEdge(a,b,input.edge,input.energy);if(!plan)throw Error('预约批准接点未通过现有规则')
  await verifyJetsonDecision(input.strategy,a,b,plan)
  process.stdout.write(JSON.stringify({verified:true}))
 }else process.stdout.write(JSON.stringify(planActivitySet(input)))
}
main().catch(error=>{process.stderr.write((error as Error).message+'\n');process.exitCode=1})
