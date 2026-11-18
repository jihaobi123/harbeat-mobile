import {validateScene,sceneBytes,sceneOutputFrames,type Scene,type Role,type ScenePreparation} from './contract'
import type {LayerPCM,PCM} from './graph'
import type {AudioCache} from '../../listen-upstream/realtime/cache'
import type {Track} from '../../listen-upstream/realtime/planner'
import {TrackLibrary} from '../../listen-upstream/continuous/catalog'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import {loadListenIndex} from '../listen'
import {validateExecutionTrack,type ExecutionTrack,type Segment} from '../device-execution'
import {verifyExecutionProfile} from '../device-prepare'

const roles:Role[]=['drums','bass','other','vocals'],limit=96*1024*1024
const bytes=(buffers:Record<string,AudioBuffer|undefined>)=>Object.values(buffers).reduce((n,b)=>n+(b?b.length*b.numberOfChannels*4:0),0)
function verifyTracks(scene:Scene,tracks:Record<'a'|'b',Track>){
 for(const side of ['a','b'] as const){const t=tracks[side],p=scene.sources[side];if(!t||t.id!==p.trackId||['masterSha256','reportSha256','runId','vocalSha256'].some(k=>t.provenance?.[k]!==p[k as keyof typeof p]))throw Error('长混批准与当前歌曲来源不一致')}
}
export function verifySceneSources(scene:Scene,tracks:Record<'a'|'b',Track>,manifests:Record<'a'|'b',ExecutionTrack>){
 verifyTracks(scene,tracks)
 for(const side of ['a','b'] as const){const m=validateExecutionTrack(manifests[side],tracks[side]),p=scene.sources[side];if(m.manifestSha256!==p.manifestSha256||m.profile.sha256!==p.profileSha256||roles.some(role=>m.stems[role]?.sourceSha256!==p.stemSha256[role]))throw Error('长混批准的分轨版本已改变')}
}

/** Copy source frames exactly; no decoded gap may become implicit zero padding. */
export async function sliceSceneSource(ctx:AudioContext,cache:AudioCache,segments:Segment[],start:number,duration:number,signal:AbortSignal):Promise<AudioBuffer>{
 signal.throwIfAborted()
 const sr=ctx.sampleRate,n=Math.round(duration*sr),first=Math.round(start*sr),end=first+n
 if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||n<1)throw Error('长混音频源区间无效')
 const selected=segments.filter(s=>Math.round(s.end*sr)>first&&Math.round(s.start*sr)<end)
 if(!selected.length)throw Error('音频片段未覆盖本次源区间')
 // Validate complete frame coverage before allocating or decoding any source.
 let cursor=first
 for(const s of selected){const left=Math.round(s.start*sr),right=Math.round(s.end*sr);if(!Number.isFinite(left)||!Number.isFinite(right)||right<=left||left>cursor)throw Error('音频源时间轴有空缺');cursor=Math.max(cursor,Math.min(end,right))}
 if(cursor<end)throw Error('音频片段未覆盖本次源区间')
 const out=ctx.createBuffer(2,n,sr);cursor=first
 for(const s of selected){
  signal.throwIfAborted();const left=Math.max(cursor,Math.round(s.start*sr)),right=Math.min(end,Math.round(s.end*sr)),count=right-left;if(count<=0)continue
  try{
   const buffer=await cache.load(s.asset,signal);signal.throwIfAborted()
   const offset=left-Math.round(s.start*sr),target=left-first
   if(buffer.numberOfChannels!==2||buffer.sampleRate!==sr||buffer.length<offset+count)throw Error('已解码音频的声道或样本覆盖不足，不能补零')
   for(let c=0;c<2;c++)out.getChannelData(c).set(buffer.getChannelData(c).subarray(offset,offset+count),target)
   cursor=right
  }finally{if(!cache.protected.has(s.asset.url))cache.pool.delete(s.asset.url)}
 }
 signal.throwIfAborted();return out
}

export async function readMetadataBytes(path:string,base:URL,signal:AbortSignal){
 signal.throwIfAborted();const response=await fetch(new URL(path,base),{cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});signal.throwIfAborted()
 if(!response.ok)throw Error('长混来源资料尚未发布 '+response.status)
 const reader=response.body?.getReader();if(!reader)throw Error('长混来源资料为空')
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error('长混来源资料超过预算');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 signal.throwIfAborted();const joined=new Uint8Array(size);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.length}return joined.buffer
}

export async function readMetadata(path:string,base:URL,signal:AbortSignal){return JSON.parse(new TextDecoder().decode(await readMetadataBytes(path,base,signal)))}

export function stretchSceneInputs(input:Record<string,AudioBuffer>,ctx:AudioContext,rate:number,frames:number,signal:AbortSignal):Promise<Record<string,AudioBuffer>>{
 signal.throwIfAborted()
 if(rate===1){const out:Record<string,AudioBuffer>={};for(const key of Object.keys(input)){const b=input[key];if(b.numberOfChannels!==2||b.sampleRate!==ctx.sampleRate||b.length<frames)throw Error('保调变速输入没有覆盖输出')
  // prepareScene owns these independently copied source slices. Transfer an
  // exact-size slice instead of keeping a second full stem during a copy.
  if(b.length===frames)out[key]=b
  else{const next=ctx.createBuffer(2,frames,ctx.sampleRate);for(let c=0;c<2;c++)next.copyToChannel(b.getChannelData(c).subarray(0,frames),c);out[key]=next}
  delete input[key]}return Promise.resolve(out)}
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../stretch-worker.ts',import.meta.url),{type:'module'});let finished=false
  const timer=setTimeout(()=>finish(Error('本机保调变速准备超时')),30000),cancel=()=>finish(signal.reason??new DOMException('已取消','AbortError'))
  function finish(error?:unknown,value?:Record<string,AudioBuffer>){if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value!)}
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return}
  worker.onerror=()=>finish(Error('本机保调变速处理器无法启动'))
  worker.onmessage=({data})=>{
   if(finished)return
   try{signal.throwIfAborted();if(data.error)throw Error(data.error)
    if(!data.output||Object.keys(data.output).sort().join()!==keys.sort().join())throw Error('保调变速输出声部不完整')
    const out:Record<string,AudioBuffer>={};for(const key of keys){const x=data.output[key];if(!(x instanceof Float32Array)||x.length!==frames*2)throw Error('保调变速输出样本覆盖不足');const b=ctx.createBuffer(2,frames,ctx.sampleRate);for(let c=0;c<2;c++){const channel=b.getChannelData(c);for(let i=0;i<frames;i++){const value=x[2*i+c];if(!Number.isFinite(value))throw Error('保调变速输出包含无效样本');channel[i]=value}}out[key]=b;delete data.output[key]}finish(undefined,out)
   }catch(error){finish(error)}
  }
  const keys=Object.keys(input),arrays:Record<string,Float32Array>={}
  try{for(const key of keys){const b=input[key],x=new Float32Array(b.length*2),l=b.getChannelData(0),r=b.getChannelData(1);for(let i=0;i<b.length;i++){x[2*i]=l[i];x[2*i+1]=r[i]}arrays[key]=x;delete input[key]}signal.throwIfAborted();worker.postMessage({input:arrays,sampleRate:ctx.sampleRate,rate,frames},Object.values(arrays).map(a=>a.buffer))}catch(error){finish(error)}
 })
}

export function prepareScene(value:Scene,ctx:AudioContext,cache:AudioCache,base:URL,variant:'live',signal:AbortSignal):Promise<LayerPCM>
export function prepareScene(value:Scene,ctx:AudioContext,cache:AudioCache,base:URL,variant:'long'|'reference',signal:AbortSignal):Promise<PCM>
export async function prepareScene(value:Scene,ctx:AudioContext,cache:AudioCache,base:URL,variant:ScenePreparation,signal:AbortSignal):Promise<LayerPCM|PCM>{
 signal.throwIfAborted();const scene=validateScene(value,variant==='live'?'live':'long')
 if(scene.rate!==1)throw Error('首轮长混仅启用同速素材，变速场景尚未完成设备内存验证')
 if(ctx.sampleRate!==scene.sampleRate||!['long','reference','live'].includes(variant)||sceneBytes(scene,variant)>limit)throw Error('长混场景超过设备采样率或缓冲预算')
 const read=(path:string,b:URL)=>readMetadata(path,b,signal)
 try{
  const index=await loadListenIndex(base,read);signal.throwIfAborted()
  const library=new TrackLibrary(index.tracks,base,read),a=await library.load(scene.sources.a.trackId);signal.throwIfAborted();const b=await library.load(scene.sources.b.trackId);signal.throwIfAborted()
  const tracks={a,b};verifyTracks(scene,tracks)
  const am=await read('/listen/execution/tracks/'+a.id+'.json',base);signal.throwIfAborted();const bm=await read('/listen/execution/tracks/'+b.id+'.json',base);signal.throwIfAborted()
  const manifests={a:am,b:bm};verifySceneSources(scene,tracks,manifests)
  for(const m of [am,bm]){signal.throwIfAborted();await verifyExecutionProfile(m,base,signal);signal.throwIfAborted()}
  const {aStart,aEnd,bStart,bEnd}=scene.clips
  const pcm:LayerPCM={a:{},b:{}},inputs:Record<string,AudioBuffer>={}
  const outputFrames=sceneOutputFrames(scene),sourceDuration=outputFrames/ctx.sampleRate*scene.rate+(scene.rate===1?0:.35)
  if(variant==='reference'){inputs.master=await sliceSceneSource(ctx,cache,nativeSegments(b),bStart,sourceDuration,signal);signal.throwIfAborted()}
  else{
   for(const role of ['drums','bass','other'] as const){pcm.a[role]=await sliceSceneSource(ctx,cache,am.stems[role]!.segments,aStart,aEnd-aStart,signal);signal.throwIfAborted()}
   for(const role of roles){inputs[role]=await sliceSceneSource(ctx,cache,bm.stems[role]!.segments,bStart,sourceDuration,signal);signal.throwIfAborted()}
  }
  pcm.b=await stretchSceneInputs(inputs,ctx,scene.rate,outputFrames,signal);signal.throwIfAborted()
  // Live playback keeps the existing A deck and prewarms only the native
  // B chunks needed for approved exits. Full master copies are audition-only.
  if(variant==='live'){
   if(bytes(pcm.a)+bytes(pcm.b)>limit)throw Error('实时长混声部超过 96 MiB 保留缓冲预算')
   return pcm
  }
  const aMaster=await sliceSceneSource(ctx,cache,nativeSegments(a),aStart-scene.lead,scene.lead+aEnd-aStart+.008,signal);signal.throwIfAborted()
  const bMaster=await sliceSceneSource(ctx,cache,nativeSegments(b),bStart,bEnd-bStart+scene.tail+.35,signal);signal.throwIfAborted()
  if(bytes({aMaster,bMaster})+bytes(pcm.a)+bytes(pcm.b)>limit)throw Error('长混场景超过 96 MiB 保留缓冲预算')
  return {...pcm,aMaster,bMaster}
 }finally{for(const key of cache.pool.buffers.keys())if(!cache.protected.has(key))cache.pool.delete(key)}
}
