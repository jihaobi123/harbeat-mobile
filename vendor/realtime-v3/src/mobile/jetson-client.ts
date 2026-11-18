import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {verifyJetsonDecision,type JetsonDecision} from './jetson-contract'
import type {Host} from './session'
import {canonicalJson} from './jetson-contract'

type ExecutionVersion={manifestSha256:string;profileSha256:string;stemSha256:Record<string,string|undefined>}
const executionVersions=new Map<string,string>()
export function rememberJetsonExecutionVersion(id:string,value:ExecutionVersion){executionVersions.set(id,canonicalJson(value))}
const sourceVersion=(s:JetsonDecision['sourceProof']['a'])=>canonicalJson({manifestSha256:s.manifestSha256,profileSha256:s.profileSha256,stemSha256:s.stemSha256})
async function verifyCurrent(value:unknown,a:Track,b:Track,p:Plan){
 const approved=await verifyJetsonDecision(value,a,b,p)
 for(const s of [approved.sourceProof.a,approved.sourceProof.b])if(executionVersions.has(s.trackId)&&executionVersions.get(s.trackId)!==sourceVersion(s))throw Object.assign(Error('分轨发布版本已变化，请重新准备方案'),{code:'source_version_changed'})
 return approved
}

const hash=/^[a-f0-9]{64}$/
const remembered=new Map<string,JetsonDecision>()
const MAX_PLANS=384
// Keep acknowledged jobs across cancelled local waits: the server still owns
// that computation, so a retry must poll it rather than submit it again.
const acknowledged=new Map<string,string>()
const nextSubmission=new Map<string,number>()
function httpError(status:number,message?:string,retryAfterMs=10000){return Object.assign(Error(message||(status===429?'策略请求暂时繁忙，正在等待后重试':`Jetson 方案暂不可用（${status}）`)),{status,...(status===429?{retryAfterMs:Math.max(2000,Math.min(60000,retryAfterMs))}:{})})}
const persisted=new Map<string,string>()
const diskIndexes=new Map<string,Map<string,number>>()
let persistence:Promise<unknown>=Promise.resolve()
async function diskKey(key:string,base:URL){const raw=new TextEncoder().encode(key),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('');return new URL('/listen/smart-api/plans/cache/'+digest+'.json',base).href}
async function disk(){try{return typeof caches==='undefined'?undefined:await caches.open('harbeat-jetson-approvals-v1')}catch{return undefined}}
function persist(key:string,value:JetsonDecision,base:URL):Promise<void>{
 if(persisted.get(key)===value.analysisSha256)return Promise.resolve()
 persisted.set(key,value.analysisSha256)
 // A reservation can register hundreds of approvals at once. Serialize writes
 // and index cache metadata once, rather than launching O(n²) cache scans.
 const task=persistence.catch(()=>{}).then(async()=>{
  const cache=await disk();if(!cache){persisted.delete(key);return}
  const body=JSON.stringify(value),bytes=new TextEncoder().encode(body).byteLength;if(bytes>2*1024*1024){persisted.delete(key);return}
  let index=diskIndexes.get(base.origin)
  if(!index){index=new Map();for(const request of await cache.keys()){const response=await cache.match(request),size=Number(response?.headers.get('Content-Length'));index.set(request.url,Number.isFinite(size)&&size>0?size:2*1024*1024)}diskIndexes.set(base.origin,index)}
  const url=await diskKey(key,base);index.delete(url)
  let total=[...index.values()].reduce((sum,size)=>sum+size,0)
  while(index.size>=MAX_PLANS||total+bytes>64*1024*1024){const first=index.keys().next().value;if(!first)break;total-=index.get(first)!;index.delete(first);await cache.delete(first)}
  await cache.put(url,new Response(body,{headers:{'Content-Type':'application/json','Content-Length':String(bytes)}}));index.set(url,bytes)
  while(persisted.size>MAX_PLANS)persisted.delete(persisted.keys().next().value!)
 }).catch(error=>{if(persisted.get(key)===value.analysisSha256)persisted.delete(key);throw error})
 persistence=task.catch(()=>{});return task
}
let nativeSequence=0
export function nativeJetsonPlan(host:Host,payload:string,signal:AbortSignal){return new Promise<any>((resolve,reject)=>{
 const id=++nativeSequence
 const cleanup=()=>{clearTimeout(timer);window.removeEventListener('harbeat-plan-result',received);signal.removeEventListener('abort',cancel)}
 const done=(error?:unknown,value?:unknown)=>{cleanup();error?reject(error):resolve(value)},cancel=()=>done(signal.reason??new DOMException('已取消','AbortError'))
 const received=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.id!==id)return;try{const value=JSON.parse(detail.reply);done(value.ok?undefined:httpError(Number(value.httpStatus)||0,value.error,Number(value.retryAfterMs)||10000),value.data)}catch{done(Error('Jetson 方案响应不完整'))}}
 const timer=setTimeout(()=>done(Error('Jetson 方案连接超时')),12000)
 window.addEventListener('harbeat-plan-result',received);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return}
 try{host.requestPlan!(id,payload)}catch{done(Error('手机 Jetson 方案连接未完成'))}
})}
function keyFor(a:Track,b:Track,p:Plan,timeline?:'stem-timeline-v1'|'stem-timeline-v2'){return (timeline?timeline+':':'')+JSON.stringify([a.id,a.provenance,b.id,b.provenance,p.window.id,p.start,p.end,p.duration,p.rate,p.window.start,p.window.end,p.v30Eq,p.restore,executionVersions.get(a.id),executionVersions.get(b.id)])}
function retain(key:string,value:JetsonDecision){remembered.delete(key);remembered.set(key,value);while(remembered.size>MAX_PLANS)remembered.delete(remembered.keys().next().value!)}
export async function rememberJetsonPlan(value:unknown,a:Track,b:Track,plan:Plan,base?:URL){const approved=await verifyCurrent(value,a,b,plan),key=keyFor(a,b,plan,approved.analysisVersion==='jetson-decision-v3'?'stem-timeline-v2':approved.analysisVersion==='jetson-decision-v2'?'stem-timeline-v1':undefined);retain(key,approved);if(base)void persist(key,approved,base).catch(()=>{});return approved}
function expired(){return Object.assign(Error('Jetson 方案尚未就绪，当前接点已过，将等待后续批准接点'),{code:'cue_expired'})}
function delay(signal:AbortSignal,ms:number){return new Promise<void>((resolve,reject)=>{
 const cleanup=()=>signal.removeEventListener('abort',cancel),cancel=()=>{clearTimeout(timer);cleanup();reject(signal.reason??new DOMException('已取消','AbortError'))},timer=setTimeout(()=>{cleanup();resolve()},ms)
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()
})}
async function read(url:URL,init:RequestInit,signal:AbortSignal){
 // Uncached submissions share a bounded pace; cancelled cues never wait in a
 // native POST queue and later enqueue obsolete work. Cached approvals skip it.
 if(init.method==='POST'){
  while((nextSubmission.get(url.origin)??0)>Date.now())await delay(signal,(nextSubmission.get(url.origin)??0)-Date.now())
  signal.throwIfAborted();nextSubmission.set(url.origin,Date.now()+2000)
 }
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason),timeout=setTimeout(()=>controller.abort(Error('Jetson 方案读取超时')),12000)
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()
 try{
  const native=typeof window!=='undefined'?window.HarBeatHost:undefined
  if(init.method==='POST'&&native?.requestPlan)return await nativeJetsonPlan(native,String(init.body),controller.signal)
  const response=await fetch(url,{...init,signal:controller.signal,credentials:'same-origin',redirect:'error',cache:'no-store'})
  const body=await response.text();if(new TextEncoder().encode(body).byteLength>2*1024*1024)throw Error('Jetson 方案超出设备资料预算')
  let value:any;try{value=JSON.parse(body)}catch{if(response.ok)throw Error('Jetson 方案响应不完整')}
  if(!response.ok){const seconds=Number(response.headers.get('Retry-After'));throw httpError(response.status,typeof value?.detail==='string'?value.detail:undefined,Number.isFinite(seconds)&&seconds>0?seconds*1000:10000)}
  controller.signal.throwIfAborted();return value
 }catch(error){const e=error as {status?:number;retryAfterMs?:number};if(e.status===429)nextSubmission.set(url.origin,Math.max(nextSubmission.get(url.origin)??0,Date.now()+(e.retryAfterMs??10000)));throw error}
 finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel)}
}
/** A plan approval is data, never a per-transition rendered WAV. No ready
 * approval means no invented original/stem authorization on the device. */
export async function requestJetsonPlan(a:Track,b:Track,plan:Plan,base:URL,signal:AbortSignal,position?:()=>number,options:{timelineVersion?:'stem-timeline-v1'|'stem-timeline-v2';cachedOnly?:boolean;onCacheHit?:(source:'memory'|'disk')=>void;onNetworkRequest?:(method:'POST'|'GET')=>void}={}):Promise<JetsonDecision>{
 signal.throwIfAborted()
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason),check=()=>{if(position&&plan.start-position()<.5)controller.abort(expired())}
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();check()
 const deadline=position?setInterval(check,80):undefined,key=keyFor(a,b,plan,options.timelineVersion)
 try{
  controller.signal.throwIfAborted()
  const hit=remembered.get(key)
  if(hit){try{const approved=await verifyCurrent(hit,a,b,plan);controller.signal.throwIfAborted();retain(key,approved);options.onCacheHit?.('memory');void persist(key,approved,base).catch(()=>{});return approved}catch(error){controller.signal.throwIfAborted();remembered.delete(key)}}
  const cache=await disk(),cacheUrl=cache?await diskKey(key,base):undefined,cached=cache&&cacheUrl?await cache.match(cacheUrl).catch(()=>undefined):undefined
  controller.signal.throwIfAborted()
  if(cached){try{const raw=await cached.text();if(new TextEncoder().encode(raw).byteLength>2*1024*1024)throw Error('Cached approval too large');const approved=await verifyCurrent(JSON.parse(raw),a,b,plan);controller.signal.throwIfAborted();retain(key,approved);options.onCacheHit?.('disk');return approved}catch(error){controller.signal.throwIfAborted();if(cache&&cacheUrl)await cache.delete(cacheUrl).catch(()=>false)}}
  if(options.cachedOnly&&options.timelineVersion)return await requestJetsonPlan(a,b,plan,base,controller.signal,position,{...options,timelineVersion:options.timelineVersion==='stem-timeline-v2'?'stem-timeline-v1':undefined})
  if(options.cachedOnly)throw Object.assign(Error('这个预约接点的批准缓存不可用，当前音乐继续播放，请重新载入预约'),{code:'approval_cache_miss'})
  const jobKey=base.origin+':'+key
  let known=acknowledged.get(jobKey)
  let value:any
  if(known){try{options.onNetworkRequest?.('GET');value=await read(new URL('/listen/smart-api/plans/'+known,base),{headers:{'Accept':'application/json'}},controller.signal)}catch(error){if((error as {status?:number}).status!==404)throw error;acknowledged.delete(jobKey);known=undefined}}
  if(!value){options.onNetworkRequest?.('POST');value=await read(new URL('/listen/smart-api/plans',base),{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({from:a.id,to:b.id,windowId:plan.window.id,start:plan.start,...(options.timelineVersion?{stemTimelineVersion:options.timelineVersion}:{})})},controller.signal)}
  const id=value?.id;if(!hash.test(id))throw Error('Jetson 方案编号无效')
  if(known&&value.id!==known)throw Error('Jetson 方案身份在读取期间发生变化')
  acknowledged.set(jobKey,id);while(acknowledged.size>MAX_PLANS)acknowledged.delete(acknowledged.keys().next().value!)
  while(true){
   controller.signal.throwIfAborted();if(value.id!==id)throw Error('Jetson 方案身份在读取期间发生变化')
   if(value.status==='ready'){if(options.timelineVersion&&value.analysisVersion!==(options.timelineVersion==='stem-timeline-v2'?'jetson-decision-v3':'jetson-decision-v2'))throw Error('云端尚未返回所请求的声部时间线版本');const approved=await verifyCurrent(value,a,b,plan);check();controller.signal.throwIfAborted();acknowledged.delete(jobKey);retain(key,approved);void persist(key,approved,base).catch(()=>{});return approved}
   if(value.status==='failed'){acknowledged.delete(jobKey);throw Error(value.message||'Jetson 未批准这个接点')}
   if(!['queued','working','pending','running','preparing'].includes(value.status))throw Error('Jetson 方案状态不完整')
   await delay(controller.signal,250)
   options.onNetworkRequest?.('GET');value=await read(new URL('/listen/smart-api/plans/'+id,base),{headers:{'Accept':'application/json'}},controller.signal)
  }
 }finally{clearInterval(deadline);signal.removeEventListener('abort',cancel);controller.abort()}
}
