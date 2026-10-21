import type {Plan,Track} from '../metric-upstream/realtime/planner'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import {nativeSegment} from '../metric-upstream/continuous/segments'
import type {MetricTransport} from './device-transport'
import type {Prepared,Method} from '../metric-upstream/metric-mix/types'
import {canArm} from '../metric-upstream/metric-mix/plan'
import {fullVocalCollision} from './original-quality'
import {loadPrepared} from './device-prepare'
import {hasMethod} from './device-execution'
import {buildV30Eq} from '../metric-upstream/v30/eq'
export type NearbyOptions={player:MetricTransport;a:Track;b:Track;signal:AbortSignal;prepare:(plan:Plan,signal:AbortSignal)=>Promise<Prepared>;preload?:(plan:Plan,signal:AbortSignal)=>Promise<unknown>;material?:Plan;ready?:{result:Prepared;method:Method};onStatus?:(message:string)=>void;acceptPlan?:(plan:Plan)=>boolean;onCandidate?:(plan:Plan)=>void;scorePlan?:(plan:Plan)=>number;leadSeconds?:number}
function wait<T>(operation:Promise<T>,signal:AbortSignal){return new Promise<T>((resolve,reject)=>{
 const cleanup=()=>signal.removeEventListener('abort',abort),abort=()=>{cleanup();reject(signal.reason??new DOMException('已取消','AbortError'))}
 signal.addEventListener('abort',abort,{once:true});operation.then(x=>{cleanup();resolve(x)},e=>{cleanup();reject(e)});if(signal.aborted)abort()
})}
const expired=()=>Object.assign(Error('准备期间接点已过，重新寻找后续接点'),{code:'cue_expired'})
/** Restore formal entry-material selection before comparing future A points.
 * An earlier fractional timestamp cannot replace its B material or duration. */
export function nearbyPlan(a:Track,b:Track,position:number,excluded=new Set<string>(),acceptPlan:(plan:Plan)=>boolean=()=>true,scorePlan?:(plan:Plan)=>number,budget?:number){
 const windows=b.windows.filter(w=>{const v=w.variants[a.id];return v&&v.rate>=.95&&v.rate<=1.05&&v.duration>=1&&v.duration<=32&&[2,4,8].includes(w.bars)})
 for(const limit of budget?[budget]:[18,60]){
  let remaining=windows
  while(remaining.length){
   const result=planContinuous(a,[{...b,windows:remaining}],position,{kind:'next',targetId:b.id},new Set(),limit,false)
   const anchor=result.best
   if(!anchor)break
   const candidates=result.candidates.filter(p=>p.window.id===anchor.window.id&&p.asset.sha256===anchor.asset.sha256&&p.duration===anchor.duration&&p.rate===anchor.rate&&p.start>=position+.5&&!excluded.has(p.id)&&!fullVocalCollision(a,b,p))
   candidates.sort((x,y)=>(scorePlan?scorePlan(y)-scorePlan(x):y.score-x.score)||x.start-y.start||x.id.localeCompare(y.id))
   for(const plan of candidates){try{const accepted={...plan,v30Eq:buildV30Eq(a,b,plan)};if(acceptPlan(accepted))return accepted}catch{excluded.add(plan.id)}}
   remaining=remaining.filter(w=>w.id!==anchor.window.id)
  }
 }
 return null
}
/** One explicit live request: no restart, seek or audition. A missed candidate
 * releases local waiting and is replaced within this bounded request. */
export async function mixNearby(o:NearbyOptions){
 const {player:p,a,b,signal}=o,excluded=new Set<string>()
 const valid=()=>{signal.throwIfAborted();if(p.current?.id!==a.id||!p.playing)throw new DOMException('播放状态已变化，已取消这次混入','AbortError')}
 p.logs.push({kind:'nearby_request',at:new Date().toISOString(),from:a.id,to:b.id,sourcePosition:p.position})
 let material=o.material
 const choose=()=>nearbyPlan(a,material?{...b,windows:[material.window]}:b,p.position,excluded,o.acceptPlan,o.scorePlan)
 let lastError:unknown=Error('附近没有通过拍点、人声和速度检查的接点，请换歌或稍后再试')
 for(let attempt=0;attempt<3;attempt++){
  valid()
  let plan=choose()
  if(!plan)throw lastError
  material??=plan
  const preparedFor=(plan:Plan)=>{
   const r=o.ready?.result
   return attempt===0&&r&&r.plan.from===a.id&&r.plan.to===b.id&&r.plan.windowId===plan.window.id&&Math.abs(r.plan.start-plan.start)<.002&&Math.abs(r.plan.end-plan.end)<.002&&canArm(r.plan,a.id,p.position)?o.ready:null
  }
  let cached=preparedFor(plan)
  if(!cached&&o.preload){
   o.onStatus?.('正在装入下一首的原渐混素材，当前音乐继续播放…')
   p.logs.push({kind:'nearby_inputs_loading',at:new Date().toISOString(),sourcePosition:p.position,windowId:plan.window.id})
   // Keep a cold download alive across passing cues; a superseded user request
   // still cancels it. Select the actual nearest cue only after inputs arrive.
   await wait(o.preload(plan,signal),signal);valid()
   plan=choose()
   if(!plan)throw lastError
   cached=preparedFor(plan)
  }
  o.onCandidate?.(plan)
  const cue=cached?.result.plan??plan,controller=new AbortController(),cancel=()=>controller.abort(signal.reason)
  p.logs.push({kind:'nearby_candidate',at:new Date().toISOString(),sourcePosition:p.position,start:cue.start,end:cue.end,reused:!!cached,policy:'formal-material-quality-v2'})
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()
  const timer=setInterval(()=>{
   if(p.current?.id!==a.id||!p.playing)controller.abort(new DOMException('已取消这次混入','AbortError'))
   else if(!canArm(cue,p.current.id,p.position))controller.abort(expired())
  },100)
  try{
   o.onStatus?.(cached?'正在装入已准备好的交接':'已找到合格接点，正在核对可用方案并准备原渐混后备…')
   const result=cached?.result??await wait(o.prepare(plan!,controller.signal),controller.signal)
   valid();controller.signal.throwIfAborted()
   if(result.plan.from!==a.id||result.plan.to!==b.id||Math.abs(result.plan.start-cue.start)>.002)throw Error('交接结果与本次歌曲和接点不一致')
   const method=cached?.method??result.decision.recommended
   if(!hasMethod(result,method))throw Error('该方案没有可用的交接素材')
   await wait(loadPrepared(p,result,b,controller.signal),controller.signal)
   valid();controller.signal.throwIfAborted()
   if(!canArm(result.plan,p.current!.id,p.position))throw expired()
   await p.arm(result,method,b,controller.signal)
   valid()
   o.onStatus?.('已安排附近接点，将自动混入下一首')
   p.logs.push({kind:'nearby_armed',at:new Date().toISOString(),sourcePosition:p.position,start:result.plan.start,method})
   return {result,method}
  }catch(e){
   valid();if((e as Error).name==='AbortError')throw e
   p.logs.push({kind:'nearby_candidate_failed',at:new Date().toISOString(),sourcePosition:p.position,start:cue.start,reason:(e as Error).message})
   lastError=e;excluded.add(plan.id)
   o.onStatus?.('这个接点未能及时准备，正在寻找后续可用接点…')
  }finally{clearInterval(timer);signal.removeEventListener('abort',cancel);controller.abort()}
 }
 throw lastError
}
