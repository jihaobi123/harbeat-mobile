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
export type DevicePrepared=Prepared&{execution:{schema:'harbeat.device-execution-plan.v1';plan:Plan;controls:Controls;sourceFingerprints:{a:unknown;b:unknown};preservePitch:true;tempoAfterTakeover:'native';preparation:'device-shared-source-wsola-v1'}}
export function isDevicePrepared(result:Prepared):result is DevicePrepared{return (result as DevicePrepared).execution?.schema==='harbeat.device-execution-plan.v1'}
export const hasMethod=(result:Prepared,method:Method)=>result.decision.methods[method]?.eligible===true&&(isDevicePrepared(result)||!!result.assets[method])
