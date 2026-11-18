import {AudioCache} from '../../listen-upstream/realtime/cache'
import type {Asset} from '../../listen-upstream/realtime/planner'
import {TrackLibrary} from '../../listen-upstream/continuous/catalog'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import {loadListenIndex} from '../listen'
import {validateExecutionTrack} from '../device-execution'
import {verifyExecutionProfile} from '../device-prepare'
import {readMetadata,sliceSceneSource,stretchSceneInputs} from './prepare'
import {reservePool} from './live-catalog'
import {verifyMultiTrack} from './multi-contract'
import {validateRole,verifyRoleHashes,roleFrames,type RoleApproval} from './role-contract'
import type {RolePCM} from './role-graph'
type Dependencies={load?:(asset:Asset,signal:AbortSignal)=>Promise<AudioBuffer>}
/** Shares source verification, slicing and WSOLA with A/B; no mixed file is loaded. */
export async function prepareRoles(value:RoleApproval,ctx:AudioContext,shared:AudioCache,base:URL,signal:AbortSignal,deps:Dependencies={}):Promise<RolePCM>{
 const approval=validateRole(value);signal.throwIfAborted();if(ctx.sampleRate!==44100)throw Error('角色替换采样率不匹配')
 await verifyRoleHashes(approval);signal.throwIfAborted()
 const retained=approval.layers.reduce((n,l)=>n+roleFrames(l)*8,0),workspace=retained*6+16*1024*1024,owner=new AudioCache(ctx,base,()=>{},shared.pool),buffers=new Map<string,AudioBuffer>()
 let reservation:(()=>void)|undefined,done=false
 const pins=()=>new Set([...shared.pool.owners].flatMap(c=>[...c.protected]))
 const cache=new Proxy(owner,{get:(target,key)=>{if(key==='protected')return pins();if(key==='load')return async(asset:Asset,s?:AbortSignal)=>{
  const additional=shared.pool.buffers.has(asset.url)?0:Math.ceil(asset.duration*44100)*8,protectedUrls=pins()
  for(const key of shared.pool.buffers.keys()){if(shared.pool.bytes+additional<=shared.pool.limit)break;if(!protectedUrls.has(key))shared.pool.delete(key)}
  if(shared.pool.bytes+additional>shared.pool.limit)throw Error('角色替换解码与当前播放合计超过内存预算')
  return deps.load?deps.load(asset,s??signal):target.load(asset,s)
 };const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v}})
 try{
  reservation=reservePool(shared.pool,workspace)
  const read=(path:string,b:URL)=>readMetadata(path,b,signal),index=await loadListenIndex(base,read),library=new TrackLibrary(index.tracks,base,read)
  for(const side of Object.keys(approval.sources) as ('c'|'d')[]){
   const proof=approval.sources[side]!,track=await library.load(proof.trackId);signal.throwIfAborted();verifyMultiTrack(proof,track)
   const layers=approval.layers.filter(l=>l.source===side)
   if(!Number.isFinite(track.bpm)||track.bpm<=0||layers.some(l=>Math.abs(track.bpm-l.sourceBpm)>1e-8||Math.abs(approval.base.scene.bpm/track.bpm-l.rate)>1e-9))throw Error('角色替换来源速度与当前曲目不匹配')
   const m=validateExecutionTrack(await read('/listen/execution/tracks/'+track.id+'.json',base),track);signal.throwIfAborted()
   if(m.manifestSha256!==proof.manifestSha256||m.profile.sha256!==proof.profileSha256||(['drums','bass','other','vocals'] as const).some(r=>m.stems[r]?.sourceSha256!==proof.stemSha256[r]))throw Error('角色替换的分轨或局部分析指纹已变化')
   await verifyExecutionProfile(m,base,signal);signal.throwIfAborted()
   for(const layer of layers){
    const n=roleFrames(layer),start=layer.sourceStartFrame/44100,duration=layer.lengthFrames/44100+(layer.rate===1?0:.5)
    if(start+duration>track.duration+1/44100)throw Error('角色替换完整源片段覆盖不足')
    const inputs:Record<string,AudioBuffer>={}
    if(layer.rate!==1)inputs.master=await sliceSceneSource(ctx,cache,nativeSegments(track),start,duration,signal)
    inputs[layer.role]=await sliceSceneSource(ctx,cache,m.stems[layer.role]!.segments,start,duration,signal)
    const output=await stretchSceneInputs(inputs,ctx,layer.rate,n,signal);signal.throwIfAborted();const buffer=output[layer.role]
    if(!buffer||buffer.length!==n||buffer.numberOfChannels!==2||buffer.sampleRate!==44100)throw Error('角色替换输出 PCM 覆盖不足')
    for(let c=0;c<2;c++)for(const sample of buffer.getChannelData(c))if(!Number.isFinite(sample))throw Error('角色替换包含无效 PCM 样本')
    buffers.set(side+':'+layer.role,buffer)
   }
  }
  signal.throwIfAborted();reservation();reservation=reservePool(shared.pool,retained)
  let released=false;done=true;return{approval,buffers,release:()=>{if(released)return;released=true;buffers.clear();reservation?.();owner.dispose()}}
 }finally{
  for(const key of shared.pool.buffers.keys())if(!cache.protected.has(key))shared.pool.delete(key)
  if(!done){buffers.clear();reservation?.();owner.dispose()}
 }
}
