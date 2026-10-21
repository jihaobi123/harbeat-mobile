import type {Asset,Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared,Method} from '../metric-upstream/metric-mix/types'
import {nativeSegments,nativeSegment} from '../metric-upstream/continuous/segments'
import {originalInputs} from './local-original'
import {EXECUTION_VERSION,validateExecutionTrack,isDevicePrepared,type ExecutionTrack,type DevicePrepared,type Controls,type Segment} from './device-execution'
import type {MetricTransport} from './device-transport'

export type DevicePCM={a:Record<string,AudioBuffer>;b:Record<string,AudioBuffer>}
const pcm=new Map<string,DevicePCM>()
const pcmPins=new Map<string,number>()
const pcmBindings=new Map<string,[string,string]>()
const executionIdentities=new Map<string,string>()
export const executionTrackIdentity=(id:string)=>executionIdentities.get(id)??''
const identityFor=(value:ExecutionTrack)=>JSON.stringify([value.manifestSha256,value.profile.sha256,Object.entries(value.stems).map(([stem,entry])=>[stem,entry?.sourceSha256])])
const dropPCM=(id:string)=>{pcm.delete(id);pcmBindings.delete(id)}
const sourceCache=new Map<string,Record<string,AudioBuffer>>()
const byteSize=(value:Record<string,AudioBuffer>)=>Object.values(value).reduce((sum,b)=>sum+b.length*b.numberOfChannels*4,0)
function keepPCM(result:Prepared,value:DevicePCM){
 const bytes=byteSize(value.a)+byteSize(value.b),limit=96*1024*1024
 if(bytes>limit)throw Error('本次声部窗口超过设备缓冲预算，请选择较短接点')
 while([...pcm].reduce((sum,[id,v])=>sum+(id===result.id?0:byteSize(v.a)+byteSize(v.b)),0)+bytes>limit||pcm.size>=3&&!pcm.has(result.id)){const victim=[...pcm.keys()].find(id=>id!==result.id&&!pcmPins.has(id));if(!victim)throw Error('当前交接占用设备缓冲，稍后继续预热');dropPCM(victim)}
 pcm.set(result.id,value)
}
export const hasDevicePCM=(result:Prepared)=>{if(!isDevicePrepared(result))return true;const binding=pcmBindings.get(result.id);return pcm.has(result.id)&&(!binding||binding[0]===executionTrackIdentity(result.plan.from)&&binding[1]===executionTrackIdentity(result.plan.to))}
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
export function rememberExecutionTrack(value:ExecutionTrack,t:Track){const v=validateExecutionTrack(value,t);manifests.set(t.id+':'+v.sourceSha256+':'+v.reportSha256,v);executionIdentities.set(t.id,identityFor(v))}
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
function rms(b:AudioBuffer,start=0,end=b.length){let sum=0;for(let c=0;c<2;c++){const x=b.getChannelData(c);for(let i=start;i<Math.min(end,b.length);i++)sum+=x[i]*x[i]}return Math.sqrt(sum/(2*Math.max(1,Math.min(end,b.length)-start)))}
type FeatureBudget={position:()=>number;start:number;onUnavailable?:(reason:string)=>void}
export async function pitchDifferences(buffers:DevicePCM,sampleRate:number,signal:AbortSignal,budget?:FeatureBudget){
 signal.throwIfAborted()
 if(!buffers.a.bass&&!buffers.a.other)return{bass:null,other:null}
 if(budget&&budget.start-budget.position()<=1){budget.onUnavailable?.('optional_feature_cue_deadline');return{bass:null,other:null}}
 const mono:Record<string,Float32Array>={}
 for(const side of ['a','b'] as const)for(const [stem,key] of [['bass','Bass'],['other','Other']] as const){const b=buffers[side][stem];if(!b)continue;const n=buffers.a.master.length,x=new Float32Array(n),l=b.getChannelData(0),r=b.getChannelData(1);for(let i=0;i<n;i++)x[i]=(l[i]+r[i])*.5;mono[side+key]=x}
 return new Promise<{bass:number|null;other:number|null}>((resolve,reject)=>{
  const worker=new Worker(new URL('./feature-worker.ts',import.meta.url),{type:'module'});let settled=false
  const unknown=(reason:string)=>{budget?.onUnavailable?.(reason);finish(undefined,{bass:null,other:null})},timer=setTimeout(()=>unknown('optional_feature_timeout'),15000),deadline=budget?setInterval(()=>{if(budget.start-budget.position()<=1)unknown('optional_feature_cue_deadline')},50):undefined,cancel=()=>finish(signal.reason??new DOMException('已取消','AbortError'))
  function finish(error?:unknown,value?:{bass:number|null;other:number|null}){if(settled)return;settled=true;clearTimeout(timer);clearInterval(deadline);signal.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value!)}
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return}worker.onerror=()=>finish(Error('窗口特征处理器无法启动'));worker.onmessage=({data})=>data.error?finish(Error(data.error)):finish(undefined,data.difference);worker.postMessage({mono,sampleRate},Object.values(mono).map(x=>x.buffer))
 })
}
function overlap(a:AudioBuffer,b:AudioBuffer){const size=Math.round(a.sampleRate*.125),n=Math.min(a.length,b.length),values:number[]=[];for(let i=0;i<n;i+=size){const end=Math.min(n,i+size),pa=rms(a,i,end),pb=rms(b,i,end),g=(i+size/2)/n;if(pa<10**(-45/20)||pb<10**(-45/20)){values.push(0);continue}const x=pa*(1-g),y=pb*g;values.push(2*Math.min(x,y)/(x+y+1e-12))}return Math.max(0,Math.min(1,values.reduce((s,x)=>s+x,0)/Math.max(1,values.length)))}
function vocalExit(a:Track,b:Track,buffers:DevicePCM,p:Plan){
 const av=buffers.a.vocals,bv=buffers.b.vocals;if(!av||!bv)return undefined
 const step=Math.round(av.sampleRate*.05),levels:number[]=[];for(let i=0;i<av.length;i+=step)levels.push(rms(av,i,i+step));const sorted=[...levels].sort((a,b)=>a-b),gate=Math.max(sorted[Math.floor(sorted.length*.95)]*.008,10**(-70/20));let tail=0
 for(let i=0;i<levels.length;i++)if(levels[i]>=gate)tail=Math.min(p.duration,(i+1)*.05)
 for(const [s,e] of a.vocals??[])if(s<p.end&&e>p.start)tail=Math.max(tail,Math.min(e,p.end)-p.start)
 const beat=a.alignment?.bars.flatMap(b=>b.beats).find(t=>t>=p.start+tail+.08&&t+.45<=p.end)
 if(beat===undefined||tail<p.duration*.2||p.duration-tail<.25)return undefined
 const fadeStart=beat-p.start,fadeEnd=fadeStart+.2,bSafe=p.window.start+(fadeEnd+.08)*p.rate
 if((b.vocals??[]).some(([s,e])=>s<bSafe&&e>p.window.start-.08)||rms(bv,0,Math.round((fadeEnd+.08)*bv.sampleRate))>10**(-45/20))return undefined
 return{fadeStart,fadeEnd,tailEnd:tail}
}
const names={original:'原渐混',bass:'独立贝斯交接',filter:'旋律滤波',yield:'旋律让位',vocal:'人声唱完再退出',bass_filter:'贝斯交接＋旋律滤波'}
export async function preloadDevice(p:MetricTransport,a:Track,b:Track,plan:Plan,signal:AbortSignal){const inputs=originalInputs(a,b,plan);await Promise.all([p.cache.load(nativeSegment(b,plan.window.start).asset,signal),p.cache.load(inputs.body.asset,signal)]);return inputs}
export async function prepareDevice(p:MetricTransport,a:Track,b:Track,plan:Plan,base:URL,signal:AbortSignal):Promise<DevicePrepared>{
 const inputs=originalInputs(a,b,plan);signal.throwIfAborted()
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
 try{
  const [am,bm]=await Promise.all([manifest(a,base,stemLoad.signal),manifest(b,base,stemLoad.signal)])
  await Promise.all([verifyExecutionProfile(am,base,stemLoad.signal),verifyExecutionProfile(bm,base,stemLoad.signal)])
  bindings=[identityFor(am),identityFor(bm)]
  for(const stem of ['bass','other','vocals'] as const)if(am.stems[stem]&&bm.stems[stem]){
   buffers.a[stem]=await slice(p,am.stems[stem]!.segments,plan.start,plan.duration,stemLoad.signal);buffers.b[stem]=await slice(p,bm.stems[stem]!.segments,plan.window.start,sourceDuration,stemLoad.signal)
  }
 }catch(error){signal.throwIfAborted();available=false;bindings=undefined;p.logs.push({kind:'device_stems_unavailable',reason:(error as Error).message,from:a.id,to:b.id});buffers.a={master:buffers.a.master};buffers.b={master:buffers.b.master}}
 finally{clearInterval(deadline);signal.removeEventListener('abort',cancelStems);stemLoad.abort()}
 const sourceKey=JSON.stringify([b.provenance,bindings?.[1],plan.window.start,sourceDuration,plan.rate,p.ctx.sampleRate,Object.keys(buffers.b)])
 const hit=sourceCache.get(sourceKey)
 buffers.b=hit??await workerStretch(buffers.b,p,plan.rate,Math.round((plan.duration+.008)*p.ctx.sampleRate),signal);signal.throwIfAborted()
 if(!hit&&byteSize(buffers.b)<=32*1024*1024){sourceCache.clear();sourceCache.set(sourceKey,buffers.b)}
 const bars=a.alignment!.bars.filter(r=>r.start>=plan.start-.065&&r.end<=plan.end+.065),last=bars.at(-1)!,prev=bars.at(-2)!
 const controls:Controls={duration:plan.duration,lastBarStart:last.start-plan.start,bassTiming:{duckStart:prev.start-plan.start,swapStart:prev.beats[3]-plan.start,swapEnd:last.start-plan.start},vocalExit:vocalExit(a,b,buffers,plan)}
 let differences:{bass:number|null;other:number|null}={bass:null,other:null}
 try{differences=await pitchDifferences(buffers,p.ctx.sampleRate,signal,{position:()=>p.position,start:plan.start,onUnavailable:reason=>p.logs.push({kind:'device_features_unknown',reason,from:a.id,to:b.id})});for(const key of ['bass','other'] as const)if(differences[key]!==null&&(!Number.isFinite(differences[key])||differences[key]!<0||differences[key]!>1))throw Error('本机特征范围无效')}
 catch(error){signal.throwIfAborted();differences={bass:null,other:null};p.logs.push({kind:'device_features_unknown',reason:(error as Error).message,from:a.id,to:b.id})}
 const metrics:Prepared['metrics']={bassOverlap:null,otherOverlap:null,bassDifference:null,otherDifference:null,vocalSafe:!!controls.vocalExit,vocalBenefit:controls.vocalExit?(controls.vocalExit.tailEnd??0)/plan.duration:0,definitions:{overlap:'125ms digital RMS and original gain balance; not a clash probability',difference:'Observed-window 32768-sample Hann FFT chroma cosine, matching metric_mix/features.py; not chord truth',renderStats:'Not generated: real-time headroom protection and audio observation required'}}
 for(const stem of ['bass','other'] as const)if(buffers.a[stem]&&buffers.b[stem]){metrics[`${stem}Overlap`]=overlap(buffers.a[stem],buffers.b[stem]);metrics[`${stem}Difference`]=differences[stem]}
 const methods={} as Prepared['decision']['methods'];const bass=(metrics.bassOverlap??0)>=.25&&metrics.bassDifference!==null,other=(metrics.otherOverlap??0)>=.25&&metrics.otherDifference!==null,bg=28*(metrics.bassOverlap??0)+12*(metrics.bassDifference??0),fg=24*(metrics.otherOverlap??0)+8*(metrics.otherDifference??0)
 for(const [method,eligible,benefit,cost] of [['original',true,0,0],['bass',bass,bg,6],['filter',other,fg,4],['yield',other&&(metrics.otherOverlap??0)>=.45&&(metrics.otherDifference??0)>=.65,30*(metrics.otherOverlap??0)+14*(metrics.otherDifference??0),11],['vocal',metrics.vocalSafe&&metrics.vocalBenefit>=.2,30*metrics.vocalBenefit,6],['bass_filter',bass&&other&&bg+fg-12-Math.max(bg-6,fg-4)>=6,bg+fg,12]] as [Method,boolean,number,number][]){methods[method]={name:names[method],eligible,score:eligible?50+benefit-cost:null,reason:method==='original'?'保留选点、EQ、人声检查的本机渐混参照':eligible?'本机同源分轨与窗口指标满足暂定门槛':'缺少已校验分轨或未达到暂定门槛',processingCost:cost,levelPenalty:0}}
 const sorted=(Object.keys(methods) as Method[]).filter(m=>methods[m].eligible).sort((a,b)=>methods[b].score!-methods[a].score!),best=sorted[0],recommended=best!=='original'&&methods[best].score!-50>=4?best:'original'
 if(bindings&&(bindings[0]!==executionTrackIdentity(a.id)||bindings[1]!==executionTrackIdentity(b.id)))throw Error('准备期间分轨分析版本已更新，请重新准备当前接点')
 const raw=new TextEncoder().encode(JSON.stringify({version:EXECUTION_VERSION,a:a.provenance,b:b.provenance,bindings,plan:plan.id,start:plan.start,controls,metrics})),id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('')
 const result:DevicePrepared={schema:'harbeat.device-execution-plan.v1',id,status:'ready',policyVersion:EXECUTION_VERSION,codeVersion:EXECUTION_VERSION,plan:{from:a.id,to:b.id,windowId:plan.window.id,start:plan.start,end:plan.end,duration:plan.duration,rate:plan.rate,bStart:plan.window.start,bEnd:plan.window.end,beatErrorMs:inputs.beatErrorMs},metrics,decision:{recommended,explanation:methods[recommended].reason,methods,policy:{version:EXECUTION_VERSION,maximumDuration:32,maximumRate:1.05,minimumRate:.95,renderedStats:false,localHeadroom:true},limitations:['同源共享 WSOLA 选择保持分轨同步；与 ffmpeg atempo 参考可能存在音色差异','本机指标与未渲染输出的排序需要试听校准；不代表已完成手机性能验收']},assets:{},sourceProof:{a:a.provenance,b:b.provenance,stemsAvailable:available},stats:{rendered:false},execution:{schema:'harbeat.device-execution-plan.v1',plan,controls,sourceFingerprints:{a:a.provenance,b:b.provenance},preservePitch:true,tempoAfterTakeover:'native',preparation:'device-shared-source-wsola-v1'}}
 keepPCM(result,buffers);if(bindings)pcmBindings.set(result.id,bindings);await p.cache.load(inputs.body.asset,signal);p.logs.push({kind:'device_plan_ready',planId:id,method:recommended,renderRequested:false,preservePitch:true,sourceCacheHit:!!hit,bufferBytes:byteSize(buffers.a)+byteSize(buffers.b),at:new Date().toISOString()});return result
}
