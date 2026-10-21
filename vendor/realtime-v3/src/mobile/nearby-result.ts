import type {Plan} from '../metric-upstream/realtime/planner'
import type {Prepared} from '../metric-upstream/metric-mix/types'
type Options={plan:Plan;position:()=>number;signal:AbortSignal;cloud:(signal:AbortSignal)=>Promise<Prepared>;original:(signal:AbortSignal)=>Promise<Prepared>;load:(result:Prepared,signal:AbortSignal)=>Promise<unknown>;event:(kind:string,data:Record<string,unknown>)=>void}
function waiting<T>(operation:Promise<T>,signal:AbortSignal){return new Promise<T>((resolve,reject)=>{
 const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??new DOMException('已取消','AbortError'))}
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
 operation.then(x=>{signal.removeEventListener('abort',abort);resolve(x)},e=>{signal.removeEventListener('abort',abort);reject(e)})
})}
/** Keep the chosen cue and the existing worker's decision. A result counts as
 * ready only after both its selected audio and B continuation are loaded. */
export async function nearbyResult(o:Options):Promise<Prepared>{
 o.signal.throwIfAborted()
 const reserveMs=Math.min(2000,Math.max(0,(o.plan.start-o.position()-1)*1000))
 if(!reserveMs){o.event('nearby_original_fallback',{stage:'not_requested',reason:'no_scheduling_budget'});return waiting(o.original(o.signal),o.signal)}
 const local=new AbortController(),remote=new AbortController(),cancel=()=>{local.abort(o.signal.reason);remote.abort(o.signal.reason)}
 o.signal.addEventListener('abort',cancel,{once:true})
 let stage='preparing',reason='budget',timer:ReturnType<typeof setTimeout>|undefined
 // Both rejections are observed immediately, even when the other path wins.
 const original=waiting(o.original(local.signal),local.signal).then(value=>({value}),error=>({error}))
 o.event('nearby_cloud_attempt',{budgetMs:reserveMs})
 const cloud=waiting(o.cloud(remote.signal),remote.signal).then(async value=>{
  const p=value.plan,plan=o.plan,method=value.decision.recommended
  if(p.from!==plan.from||p.to!==plan.to||p.windowId!==plan.window.id||Math.abs(p.start-plan.start)>.002||Math.abs(p.end-plan.end)>.002||Math.abs(p.duration-plan.duration)>.002||Math.abs(p.rate-plan.rate)>.000001||Math.abs(p.bStart-plan.window.start)>.002||Math.abs(p.bEnd-plan.window.end)>.002||!value.assets[method]||!value.decision.methods[method]?.eligible)throw Error('云端方案与本次完整接点不一致')
  stage='downloading';o.event('nearby_cloud_downloading',{method,bytes:value.assets[method]!.bytes})
  await waiting(o.load(value,remote.signal),remote.signal);remote.signal.throwIfAborted()
  o.event('nearby_cloud_playable',{method});return value
 }).catch(error=>{reason='cloud_failed';if(!remote.signal.aborted)o.event('nearby_cloud_unavailable',{stage,reason:(error as Error).message});return null})
 try{
  const budget=new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),reserveMs)})
  const result=await waiting(Promise.race([cloud,budget]),o.signal)
  o.signal.throwIfAborted()
  if(result)return result
  o.event('nearby_original_fallback',{stage,reason});remote.abort()
  const fallback=await waiting(original,o.signal)
  if('error' in fallback)throw fallback.error
  return fallback.value
 }finally{clearTimeout(timer);o.signal.removeEventListener('abort',cancel);local.abort();remote.abort()}
}
