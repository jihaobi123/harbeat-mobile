import type {Asset,Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared,Method} from '../metric-upstream/metric-mix/types'
export type Segment={start:number;end:number;startFrame?:number;endFrame?:number;asset:Asset&{sampleRate?:number;channels?:number;frames?:number}}
export type ExecutionTrack={schema:'harbeat.execution-track.v1';trackId:string;runId:string;manifestSha256:string;sourceSha256:string;reportSha256:string;sampleRate:number;channels:number;duration:number;frames:number;sourceTimeOrigin:'master_audio_start';profile:{sha256:string;url:string;bytes:number};stems:Partial<Record<'drums'|'bass'|'other'|'vocals',{sourceSha256:string;segments:Segment[]}>>}
const hash=/^[a-f0-9]{64}$/
export function validateExecutionTrack(value:any,track:Track):ExecutionTrack{
 if(value?.schema!=='harbeat.execution-track.v1'||value.trackId!==track.id||value.sourceSha256!==track.provenance?.masterSha256||value.reportSha256!==track.provenance?.reportSha256||!hash.test(value.sourceSha256)||!hash.test(value.reportSha256)||typeof value.runId!=='string'||value.runId!==track.provenance?.runId||!hash.test(value.manifestSha256)||value.channels!==2||value.sampleRate!==44100||value.sourceTimeOrigin!=='master_audio_start'||!Number.isInteger(value.frames)||value.frames<1||Math.abs(value.frames/value.sampleRate-value.duration)>1e-6||Math.abs(value.duration-track.duration)>.05||!value.stems||typeof value.stems!=='object'||!hash.test(value.profile?.sha256)||value.profile.url!==`/listen/execution/profiles/${value.profile.sha256}.json`||!Number.isInteger(value.profile.bytes)||value.profile.bytes<1||value.profile.bytes>8*1024*1024)throw Error('分轨来源与当前歌曲分析不一致')
 let grid:string|undefined
 for(const [key,stem] of Object.entries(value.stems) as [string,any][]){
  if(!['drums','bass','other','vocals'].includes(key)||!hash.test(stem?.sourceSha256)||!Array.isArray(stem.segments)||!stem.segments.length||stem.segments.length>512)throw Error('分轨清单不完整')
  let end=0,lastFrame=0
  for(const s of stem.segments){const a=s?.asset;if(![s?.start,s?.end,a?.duration,a?.bytes].every(Number.isFinite)||Math.abs(s.start-end)>.0001||s.end<=s.start||s.end-s.start>16.05||Math.abs(a.duration-(s.end-s.start))>.001||!hash.test(a.sha256)||!new RegExp(`^/listen/execution-media/${a.sha256}\\.(flac|wav)$`).test(a.url)||a.bytes<=0||a.bytes>16*1024*1024||!Number.isInteger(s.startFrame)||s.startFrame!==lastFrame||!Number.isInteger(s.endFrame)||s.endFrame<=s.startFrame||a.frames!==s.endFrame-s.startFrame||a.sampleRate!==value.sampleRate||a.channels!==value.channels||Math.abs(s.startFrame/value.sampleRate-s.start)>1e-6||Math.abs(s.endFrame/value.sampleRate-s.end)>1e-6)throw Error('分轨片段身份、范围或地址无效');end=s.end;lastFrame=s.endFrame}
  if(lastFrame!==value.frames)throw Error('分轨样本长度不一致')
  const currentGrid=JSON.stringify(stem.segments.map((s:Segment)=>[s.startFrame,s.endFrame]));if(grid!==undefined&&currentGrid!==grid)throw Error('分轨片段网格不一致');grid=currentGrid
  if(Math.abs(end-track.duration)>.05)throw Error('分轨没有覆盖整首歌曲')
  if(key==='vocals'&&stem.sourceSha256!==track.provenance?.vocalSha256&&track.provenance?.vocalSha256)throw Error('人声分轨指纹不一致')
 }
 return value
}
export type Point=[number,number]
export type Controls={duration:number;lastBarStart:number;bassTiming:{duckStart:number;swapStart:number;swapEnd:number};vocalExit?:{fadeStart:number;fadeEnd:number;tailEnd?:number}}
export function valueAt(points:Point[],time:number){let before=points[0];for(const p of points.slice(1)){if(time<=p[0])return p[0]===before[0]?p[1]:before[1]+(p[1]-before[1])*(time-before[0])/(p[0]-before[0]);before=p}return before[1]}
const difference=(target:Point[],base:Point[])=>[...new Set([...target,...base].map(p=>p[0]))].sort((a,b)=>a-b).map(t=>[t,valueAt(target,t)-valueAt(base,t)] as Point)
export function stemCurves(method:Method,p:Controls){
 const d=p.duration,ga:Point[]=[[0,1],[d,0]],gb:Point[]=[[0,0],[d,1]],zero:Point[]=[[0,0],[d,0]]
 const result={aBass:zero,bBass:zero,aOther:zero,aVocal:zero,bVocal:zero}
 if(method==='bass'||method==='bass_filter'){const t=p.bassTiming;result.aBass=difference([[0,1],[t.duckStart,1],[t.swapStart,.5],[t.swapEnd,0],[d,0]],ga);result.bBass=difference([[0,0],[t.swapStart,0],[t.swapEnd,1],[d,1]],gb)}
 if(method==='yield')result.aOther=difference([[0,1],[p.lastBarStart,0],[d,0]],ga)
 if(method==='vocal'&&p.vocalExit){const v=p.vocalExit;result.aVocal=difference([[0,1],[v.fadeStart,1],[v.fadeEnd,0],[d,0]],ga);const times=[...new Set([0,...Array.from({length:41},(_,i)=>Math.min(d,v.fadeEnd+i*.002)),d])].sort((a,b)=>a-b);result.bVocal=times.map(t=>[t,valueAt(gb,t)*(valueAt([[0,0],[v.fadeEnd,0],[Math.min(d,v.fadeEnd+.08),1],[d,1]],t)-1)])}
 return result
}
export const EXECUTION_VERSION='device-source-execution-v1'
export type DevicePrepared=Prepared&{execution:{schema:'harbeat.device-execution-plan.v1';plan:Plan;controls:Controls;sourceFingerprints:{a:unknown;b:unknown};sourceBindings?:unknown;preservePitch:true;tempoAfterTakeover:'native';preparation:'device-shared-source-wsola-v1'}}
export function isDevicePrepared(result:Prepared):result is DevicePrepared{return (result as DevicePrepared).execution?.schema==='harbeat.device-execution-plan.v1'}
export const hasMethod=(result:Prepared,method:Method)=>result.decision.methods[method]?.eligible===true&&(isDevicePrepared(result)||!!result.assets[method])

export type PreparedDrumAssets={a:Record<string,Pick<Asset,'sha256'|'bytes'|'duration'>>;b:Record<string,Pick<Asset,'sha256'|'bytes'|'duration'>>}
export type DrumPreludeApproval={schema:'harbeat.drum-prelude.v1';scope:'audition-only';authority:'jetson';approved:true;planId:string;proofSha256:string;sourceFingerprints:{a:unknown;b:unknown};preparedAssets:PreparedDrumAssets;takeoverAsset:Pick<Asset,'sha256'|'bytes'|'duration'>&{sourceStart:number};leadSeconds:number;fadeInSeconds:number;holdSeconds:number;maxGain:.25;sourceWindow:{aStart:number;aEnd:number;bStart:number;bEnd:number;effectiveBEnd?:number;rate:number};checks:{sourceAligned:true;beatAligned:true;vocalSafe:true;drumCompatible:true;headroomSafe:true};basis?:Record<string,unknown>;limits?:Record<string,unknown>;rejectionReasons?:string[]}
type PreludeBuffer=Pick<AudioBuffer,'duration'|'length'|'numberOfChannels'|'sampleRate'>
type PreludeBuffers={a:Record<string,PreludeBuffer>;b:Record<string,PreludeBuffer>;body?:PreludeBuffer}
const sorted=(value:any):any=>value&&typeof value==='object'?Array.isArray(value)?value.map(sorted):Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sorted(value[k])])):value
export const canonicalDrumPreludeProof=(value:unknown)=>JSON.stringify(sorted(value))
/** Experimental approval only. This does not grant automatic playback entry. */
export function validateDrumPreludeApproval(value:any,result:DevicePrepared,pcm:PreludeBuffers):DrumPreludeApproval{
 const p=result.execution.plan,d=p.duration,a=value as DrumPreludeApproval,near=(x:number,y:number)=>Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<.002
 if(a?.schema!=='harbeat.drum-prelude.v1'||a.scope!=='audition-only'||a.authority!=='jetson'||a.approved!==true||a.planId!==result.id||!hash.test(a.proofSha256)||!a.sourceFingerprints||canonicalDrumPreludeProof(a.sourceFingerprints)!==canonicalDrumPreludeProof(result.execution.sourceFingerprints)||!['sourceAligned','beatAligned','vocalSafe','drumCompatible','headroomSafe'].every(k=>(a.checks as any)?.[k]===true)||(a.rejectionReasons?.length??0)>0)throw Error('鼓叠放缺少 Jetson 批准或来源证明')
 if(![a.leadSeconds,a.fadeInSeconds,a.holdSeconds,d,p.rate].every(Number.isFinite)||a.fadeInSeconds<=0||Math.abs(a.holdSeconds-2*a.fadeInSeconds)>.1*2*a.fadeInSeconds+.002||!near(a.leadSeconds,a.fadeInSeconds+a.holdSeconds)||a.maxGain!==.25||d<1||d>32||a.leadSeconds+d>24||p.rate<.95||p.rate>1.05||!near(result.execution.controls.duration,d))throw Error('鼓叠放时长、增益或主窗口不符合本轮范围')
 const c=result.execution.controls,t=c.bassTiming,v=c.vocalExit
 if(![p.start,p.end,p.restore].every(Number.isFinite)||p.restore<p.start||p.restore>p.end||!t||![c.lastBarStart,t.duckStart,t.swapStart,t.swapEnd].every(n=>Number.isFinite(n)&&n>=0&&n<=d)||t.duckStart>t.swapStart||t.swapStart>t.swapEnd||t.swapEnd>c.lastBarStart+.002||v&&(![v.fadeStart,v.fadeEnd,v.tailEnd??0].every(n=>Number.isFinite(n)&&n>=0&&n<=d)||v.fadeEnd<=v.fadeStart||(v.tailEnd??0)>v.fadeStart))throw Error('原主交接控制曲线不完整或越界')
 if(p.v30Eq)for(const side of ['a','b'] as const){let previous=-Infinity;for(const point of p.v30Eq[side]){if(!Number.isFinite(point.t)||point.t<previous||point.t<0||point.t>d||!['low','mid','high'].every(k=>Number.isFinite((point as any)[k])&&Math.abs((point as any)[k])<=24))throw Error('原主交接 EQ 曲线不完整或越界');previous=point.t}}
 const w=a.sourceWindow
 if(!w||w.aStart<0||w.bStart<0||!near(w.aStart,p.start-a.leadSeconds)||!near(w.aEnd,p.end)||!near(w.bStart,p.window.start-a.leadSeconds*p.rate)||!Number.isFinite(w.bEnd)||w.bEnd<p.window.end-.002||w.bEnd>p.window.end+.008*p.rate+.002||!near(w.effectiveBEnd??p.window.end,p.window.end)||!near(w.rate,p.rate))throw Error('鼓叠放源时间映射不一致')
 if(!pcm.a.master||!pcm.b.master||!pcm.b.drums)throw Error('鼓叠放缺少完整同源素材')
 let bytes=0
 for(const side of ['a','b'] as const){
  const assets=a.preparedAssets?.[side]
  if(!assets||Object.keys(assets).sort().join(',')!==Object.keys(pcm[side]).sort().join(','))throw Error('鼓叠放制备文件与批准声部不一致')
  for(const [stem,buffer] of Object.entries(pcm[side])){
  const asset=assets[stem]
  if(!hash.test(asset?.sha256)||!Number.isInteger(asset.bytes)||asset.bytes<=0||asset.bytes>64*1024*1024||!Number.isFinite(asset.duration)||Math.abs(asset.duration-buffer.duration)>.04)throw Error('鼓叠放制备文件身份或时长无效')
  const duration=a.leadSeconds+d+(side==='b'?.008:0)
  if(!buffer||buffer.numberOfChannels!==2||buffer.sampleRate!==44100||!Number.isInteger(buffer.length)||buffer.length<1||Math.abs(buffer.duration-buffer.length/buffer.sampleRate)>1/buffer.sampleRate||buffer.duration+1/buffer.sampleRate<duration)throw Error('鼓叠放采样覆盖不足或声部未对齐')
  bytes+=buffer.length*buffer.numberOfChannels*4
 }}
 const body=pcm.body,takeover=a.takeoverAsset
 if(!body||!takeover||!hash.test(takeover.sha256)||!Number.isInteger(takeover.bytes)||takeover.bytes<=0||takeover.bytes>64*1024*1024||!near(takeover.sourceStart,p.window.end)||!near(takeover.duration,8)||Math.abs(body.duration-takeover.duration)>.04||body.numberOfChannels!==2||body.sampleRate!==44100||!Number.isInteger(body.length)||Math.abs(body.duration-body.length/body.sampleRate)>1/body.sampleRate)throw Error('B 正文接管缺少同源八秒素材或起点不一致')
 bytes+=body.length*body.numberOfChannels*4
 if(bytes>96*1024*1024)throw Error('鼓叠放超过 96 MiB 设备窗口预算')
 return a
}
/** Before the main cue this is the drum gain. Afterwards it is a signed
 * correction to B master: gb + max(.25-gb, 0) = max(.25, gb). */
export function drumPreludeCorrection(p:DrumPreludeApproval,duration:number):Point[]{
 return [[0,0],[p.fadeInSeconds,.25],[p.leadSeconds,.25],[p.leadSeconds+duration*.25,0],[p.leadSeconds+duration,0]]
}
