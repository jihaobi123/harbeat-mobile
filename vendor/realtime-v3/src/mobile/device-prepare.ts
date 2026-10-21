import type {Asset,Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared} from '../metric-upstream/metric-mix/types'
import {nativeSegments,nativeSegment} from '../metric-upstream/continuous/segments'
import {originalInputs} from './local-original'
import {EXECUTION_VERSION,validateExecutionTrack,isDevicePrepared,type ExecutionTrack,type DevicePrepared,type Segment} from './device-execution'
import type {MetricTransport} from './device-transport'
import {requestJetsonPlan} from './jetson-client'
import type {JetsonDecision} from './jetson-contract'
export {pitchDifferences} from './device-feature-compat'

export type DevicePCM={a:Record<string,AudioBuffer>;b:Record<string,AudioBuffer>}
const pcm=new Map<string,DevicePCM>()
const pcmPins=new Map<string,number>()
const pcmBindings=new Map<string,[string,string]>()
const pcmApprovals=new Map<string,{a:JetsonDecision['sourceProof']['a'];b:JetsonDecision['sourceProof']['b']}>()
const executionIdentities=new Map<string,string>()
const executionVersions=new Map<string,string>()
export const executionTrackIdentity=(id:string)=>executionIdentities.get(id)??''
const identityFor=(value:ExecutionTrack)=>JSON.stringify([value.manifestSha256,value.profile.sha256,Object.entries(value.stems).map(([stem,entry])=>[stem,entry?.sourceSha256])])
const dropPCM=(id:string)=>{pcm.delete(id);pcmBindings.delete(id);pcmApprovals.delete(id)}
const sourceCache=new Map<string,Record<string,AudioBuffer>>()
const byteSize=(value:Record<string,AudioBuffer>)=>Object.values(value).reduce((sum,b)=>sum+b.length*b.numberOfChannels*4,0)
function keepPCM(result:Prepared,value:DevicePCM){
 const bytes=byteSize(value.a)+byteSize(value.b),limit=96*1024*1024
 if(bytes>limit)throw Error('本次声部窗口超过设备缓冲预算，请选择较短接点')
 while([...pcm].reduce((sum,[id,v])=>sum+(id===result.id?0:byteSize(v.a)+byteSize(v.b)),0)+bytes>limit||pcm.size>=3&&!pcm.has(result.id)){const victim=[...pcm.keys()].find(id=>id!==result.id&&!pcmPins.has(id));if(!victim)throw Error('当前交接占用设备缓冲，稍后继续预热');dropPCM(victim)}
 pcm.set(result.id,value)
}
export const hasDevicePCM=(result:Prepared)=>{if(!isDevicePrepared(result))return true;const binding=pcmBindings.get(result.id),approval=pcmApprovals.get(result.id),version=(side:'a'|'b')=>{const proof=approval?.[side];return !proof||!executionVersions.has(proof.trackId)||executionVersions.get(proof.trackId)===proof.manifestSha256+':'+proof.profileSha256};return pcm.has(result.id)&&version('a')&&version('b')&&(!binding||binding[0]===executionTrackIdentity(result.plan.from)&&binding[1]===executionTrackIdentity(result.plan.to))}
export function releaseDevicePCM(result:Prepared){if(!pcmPins.has(result.id))dropPCM(result.id)}
export function pinDevicePCM(result:Prepared){if(!isDevicePrepared(result))return()=>{};getDevicePCM(result);pcmPins.set(result.id,(pcmPins.get(result.id)??0)+1);let released=false;return()=>{if(released)return;released=true;const count=(pcmPins.get(result.id)??1)-1;if(count)pcmPins.set(result.id,count);else pcmPins.delete(result.id)}}
export function deviceBufferUsage(){return{pcmBytes:[...pcm.values()].reduce((sum,v)=>sum+byteSize(v.a)+byteSize(v.b),0),pcmLimit:96*1024*1024,sourceBytes:[...sourceCache.values()].reduce((sum,v)=>sum+byteSize(v),0),sourceLimit:32*1024*1024}}
const manifests=new Map<string,ExecutionTrack>()
const profiles=new Set<string>()
export async function verifyExecutionProfile(manifest:ExecutionTrack,base:URL,signal:AbortSignal){
 const entry=manifest.profile;if(profiles.has(entry.sha256))return
 const url=new URL(entry.url,base);url.searchParams.set('sha256',entry.sha256)
 let cache:Cache|undefined;try{if(typeof caches!=='undefined')cache=await caches.open('harbeat-execution-metadata-v1')}catch{}
 const cached=await cache?.match(url.href).catch(()=>undefined),response=cached??await fetch(url,{signal});if(!response.ok)throw Error('局部分析资料尚未发布')
 const bytes=await response.arrayBuffer();if(bytes.byteLength!==entry.bytes||bytes.byteLength>8*1024*1024)throw Error('局部分析资料大小不一致')
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');if(sha!==entry.sha256)throw Error('局部分析资料指纹不一致')
 const value=JSON.parse(new TextDecoder().decode(bytes));if(value.schema!=='harbeat.execution-profile.v1'||value.trackId!==manifest.trackId||value.runId!==manifest.runId||value.sourceSha256!==manifest.sourceSha256||value.reportSha256!==manifest.reportSha256||value.manifestSha256!==manifest.manifestSha256)throw Error('局部分析资料来源不一致')
 for(const [key,stem] of Object.entries(manifest.stems))if(stem&&value.stems?.[key]?.sourceSha256!==stem.sourceSha256)throw Error('局部分析的声部指纹不一致')
 signal.throwIfAborted();profiles.add(entry.sha256)
 if(!cached&&cache)try{await cache.put(url.href,new Response(bytes,{headers:{'Content-Type':'application/json'}}))}catch{}
}
export function rememberExecutionTrack(value:ExecutionTrack,t:Track){const v=validateExecutionTrack(value,t);manifests.set(t.id+':'+v.sourceSha256+':'+v.reportSha256,v);executionIdentities.set(t.id,identityFor(v));executionVersions.set(t.id,v.manifestSha256+':'+v.profile.sha256)}
export function getDevicePCM(result:Prepared){const value=pcm.get(result.id);if(!value||!hasDevicePCM(result))throw Error('本机分轨缓冲已释放或分析版本已变化，请重新准备当前接点');pcm.delete(result.id);pcm.set(result.id,value);return value}
export async function loadPrepared(p:MetricTransport,result:Prepared,b:Track,signal:AbortSignal){if(isDevicePrepared(result)){getDevicePCM(result);await p.cache.load(nativeSegment(b,result.plan.bEnd).asset,signal);return}await Promise.all([p.cache.load(result.assets[result.decision.recommended]!,signal),p.cache.load(nativeSegment(b,result.plan.bEnd).asset,signal)])}
async function manifest(t:Track,base:URL,signal:AbortSignal){
 const key=t.id+':'+t.provenance?.masterSha256+':'+t.provenance?.reportSha256,hit=manifests.get(key);if(hit)return hit
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();const timer=setTimeout(()=>controller.abort(),8000)
 try{const response=await fetch(new URL('/listen/execution/tracks/'+t.id+'.json',base),{signal:controller.signal});if(!response.ok)throw Error('分轨目录尚未发布 '+response.status);const value=validateExecutionTrack(await response.json(),t);rememberExecutionTrack(value,t);return value}finally{clearTimeout(timer);signal.removeEventListener('abort',cancel)}
}
async function slice(p:MetricTransport,segments:Segment[],start:number,duration:number,signal:AbortSignal){
 const end=start+duration,selected=segments.filter(s=>s.end>start&&s.start<end),sr=p.ctx.sampleRate,n=Math.round(duration*sr),out=p.ctx.createBuffer(2,n,sr)
 if(!selected.length||selected[0].start>start+.0001||selected.at(-1)!.end<end-.0001)throw Error('音频片段未覆盖本次源区间')
 let cursor=start
 // Decode at most one source chunk at a time; only the bounded crop survives.
 for(const s of selected){if(s.start>cursor+.0001)throw Error('音频源时间轴有空缺');const buffer=await p.cache.load(s.asset,signal);signal.throwIfAborted();const left=Math.max(start,s.start),right=Math.min(end,s.end),offset=Math.round((left-s.start)*sr),target=Math.round((left-start)*sr),count=Math.min(Math.round((right-left)*sr),n-target)
  assertDecodedCoverage(buffer,offset,count)
  for(let c=0;c<2;c++)out.getChannelData(c).set(buffer.getChannelData(c).subarray(offset,offset+count),target);cursor=right
 }
 return out
}
export function assertDecodedCoverage(buffer:Pick<AudioBuffer,'numberOfChannels'|'length'>,offset:number,count:number){if(buffer.numberOfChannels!==2||buffer.length<offset+count)throw Error('已解码音频的声道或样本覆盖不足，不能补零作为合格素材')}
function workerStretch(input:Record<string,AudioBuffer>,p:MetricTransport,rate:number,frames:number,signal:AbortSignal){
 if(Math.abs(rate-1)<1e-10)return Promise.resolve(Object.fromEntries(Object.entries(input).map(([k,b])=>{const o=p.ctx.createBuffer(2,frames,p.ctx.sampleRate);for(let c=0;c<2;c++)o.copyToChannel(b.getChannelData(c).subarray(0,frames),c);return[k,o]})))
 return new Promise<Record<string,AudioBuffer>>((resolve,reject)=>{
  const worker=new Worker(new URL('./stretch-worker.ts',import.meta.url),{type:'module'}),timer=setTimeout(()=>finish(Error('本机保调变速准备超时')),30000)
  const cancel=()=>finish(signal.reason??new DOMException('已取消','AbortError'))
  function finish(error?:unknown,value?:Record<string,AudioBuffer>){clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value!)}
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return}
  worker.onerror=()=>finish(Error('本机保调变速处理器无法启动'))
  worker.onmessage=({data})=>{if(data.error){finish(Error(data.error));return}try{const out:Record<string,AudioBuffer>={};for(const [key,x] of Object.entries(data.output) as [string,Float32Array][]){const b=p.ctx.createBuffer(2,frames,p.ctx.sampleRate);for(let c=0;c<2;c++){const channel=b.getChannelData(c);for(let i=0;i<frames;i++)channel[i]=x[2*i+c]}out[key]=b}finish(undefined,out)}catch(e){finish(e)}}
  const arrays=Object.fromEntries(Object.entries(input).map(([key,b])=>{const x=new Float32Array(b.length*2),l=b.getChannelData(0),r=b.getChannelData(1);for(let i=0;i<b.length;i++){x[2*i]=l[i];x[2*i+1]=r[i]}return[key,x]}));worker.postMessage({input:arrays,sampleRate:p.ctx.sampleRate,rate,frames},Object.values(arrays).map(a=>a.buffer))
 })
}
function assertApprovedManifest(value:ExecutionTrack,proof:JetsonDecision['sourceProof']['a']){
 if(value.manifestSha256!==proof.manifestSha256||value.profile.sha256!==proof.profileSha256||Object.entries(value.stems).some(([stem,s])=>s&&s.sourceSha256!==proof.stemSha256[stem as keyof typeof proof.stemSha256]))throw Object.assign(Error('Jetson 批准的分轨分析版本与本机目录不一致'),{code:'source_version_changed'})
}
export async function preloadDevice(p:MetricTransport,a:Track,b:Track,plan:Plan,signal:AbortSignal){const inputs=originalInputs(a,b,plan);await Promise.all([p.cache.load(nativeSegment(b,plan.window.start).asset,signal),p.cache.load(inputs.body.asset,signal)]);return inputs}
export async function prepareDevice(p:MetricTransport,a:Track,b:Track,plan:Plan,base:URL,signal:AbortSignal):Promise<DevicePrepared>{
 signal.throwIfAborted()
 p.logs.push({kind:'jetson_plan_requested',from:a.id,to:b.id,windowId:plan.window.id,start:plan.start,sourcePosition:p.position,renderRequested:false})
 const approved=await requestJetsonPlan(a,b,plan,base,signal,()=>p.position)
 signal.throwIfAborted()
 // Musical analysis and method eligibility belong to the approved Jetson
 // decision. The device only validates, loads, time-stretches and executes.
 const executionPlan={...plan,v30Eq:approved.eq,restore:approved.restore},inputs=originalInputs(a,b,executionPlan)
 p.logs.push({kind:'jetson_plan_approved',planId:approved.id,analysisSha256:approved.analysisSha256,method:approved.decision.recommended,from:a.id,to:b.id,start:plan.start})
 // B's extra 350 ms is source padding for WSOLA only, not an altered cue.
 const extra=Math.abs(plan.rate-1)>1e-10?.35:0,sourceDuration=(plan.duration+.008)*plan.rate+extra
 const buffers:DevicePCM={a:{master:await slice(p,nativeSegments(a),plan.start,plan.duration,signal)},b:{master:await slice(p,nativeSegments(b),plan.window.start,sourceDuration,signal)}}
 let available=true,bindings:[string,string]|undefined
 const stemLoad=new AbortController(),cancelStems=()=>stemLoad.abort(signal.reason)
 signal.addEventListener('abort',cancelStems,{once:true});if(signal.aborted)cancelStems()
 // A nearest-cue action never waits for cold stems past its source deadline.
 // Completed, validated source chunks remain reusable in the encoded cache.
 const deadline=setInterval(()=>{if(plan.start-p.position<=1.5)stemLoad.abort(Error('分轨尚未缓存，保留同接点本机原渐混'))},80)
 if(plan.start-p.position<=1.5)stemLoad.abort(Error('接点提前量不足以装入冷分轨'))
 try{if(approved.requiredStems.length){
  const [am,bm]=await Promise.all([manifest(a,base,stemLoad.signal),manifest(b,base,stemLoad.signal)])
  assertApprovedManifest(am,approved.sourceProof.a);assertApprovedManifest(bm,approved.sourceProof.b)
  await Promise.all([verifyExecutionProfile(am,base,stemLoad.signal),verifyExecutionProfile(bm,base,stemLoad.signal)])
  bindings=[identityFor(am),identityFor(bm)]
  for(const stem of approved.requiredStems){
   const key=stem as keyof ExecutionTrack['stems'];if(!am.stems[key]||!bm.stems[key])throw Error('Jetson 已批准的所需分轨尚未发布到本机目录')
   buffers.a[stem]=await slice(p,am.stems[key]!.segments,plan.start,plan.duration,stemLoad.signal);buffers.b[stem]=await slice(p,bm.stems[key]!.segments,plan.window.start,sourceDuration,stemLoad.signal)
  }
 }}catch(error){signal.throwIfAborted();if((error as {code?:string}).code==='source_version_changed')throw error;available=false;bindings=undefined;p.logs.push({kind:'device_stems_unavailable',reason:(error as Error).message,approvedPlanId:approved.id,from:a.id,to:b.id});buffers.a={master:buffers.a.master};buffers.b={master:buffers.b.master}}
 finally{clearInterval(deadline);signal.removeEventListener('abort',cancelStems);stemLoad.abort()}
 const sourceKey=JSON.stringify([b.provenance,bindings?.[1],plan.window.start,sourceDuration,plan.rate,p.ctx.sampleRate,Object.keys(buffers.b)])
 const hit=sourceCache.get(sourceKey)
 buffers.b=hit??await workerStretch(buffers.b,p,plan.rate,Math.round((plan.duration+.008)*p.ctx.sampleRate),signal);signal.throwIfAborted()
 if(!hit&&byteSize(buffers.b)<=32*1024*1024){sourceCache.clear();sourceCache.set(sourceKey,buffers.b)}
 let decision=approved.decision
 if(!available){
  if(!decision.methods.original.eligible)throw Error('分轨未就绪，且这个接点没有 Jetson 批准的原渐混后备')
  const methods=Object.fromEntries(Object.entries(decision.methods).map(([key,m])=>[key,key==='original'?m:{...m,eligible:false,score:null,reason:'Jetson 已判断适用性，但本机所需分轨尚未就绪'}])) as Prepared['decision']['methods']
  decision={...decision,methods,recommended:'original',explanation:'本机分轨尚未就绪，使用同接点 Jetson 已批准的原渐混后备'}
 }
 const controls=approved.controls,metrics=approved.metrics,recommended=decision.recommended
 if(bindings&&(bindings[0]!==executionTrackIdentity(a.id)||bindings[1]!==executionTrackIdentity(b.id)))throw Error('准备期间分轨分析版本已更新，请重新准备当前接点')
 const raw=new TextEncoder().encode(JSON.stringify({version:EXECUTION_VERSION,approval:approved.id,analysisSha256:approved.analysisSha256,bindings,fallback:!available,sampleRate:p.ctx.sampleRate})),id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('')
 const result:DevicePrepared={schema:'harbeat.device-execution-plan.v1',id,status:'ready',policyVersion:approved.analysisVersion,codeVersion:approved.algorithmSha256,plan:approved.plan,metrics,decision,assets:{},sourceProof:{a:a.provenance,b:b.provenance,stemsAvailable:available},stats:{rendered:false,approvedPlanId:approved.id,analysisSha256:approved.analysisSha256},execution:{schema:'harbeat.device-execution-plan.v1',plan:executionPlan,controls,sourceFingerprints:{a:a.provenance,b:b.provenance},sourceBindings:approved.sourceProof,preservePitch:true,tempoAfterTakeover:'native',preparation:'device-shared-source-wsola-v1'}}
 keepPCM(result,buffers);pcmApprovals.set(result.id,approved.sourceProof);if(bindings)pcmBindings.set(result.id,bindings);await p.cache.load(inputs.body.asset,signal);p.logs.push({kind:'device_plan_ready',planId:id,approvedPlanId:approved.id,method:recommended,renderRequested:false,musicAnalysis:'jetson',preservePitch:true,sourceCacheHit:!!hit,bufferBytes:byteSize(buffers.a)+byteSize(buffers.b),at:new Date().toISOString()});return result
}
