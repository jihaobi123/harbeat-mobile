import type {AudioCache} from '../../listen-upstream/realtime/cache'
import {AudioCache as Cache} from '../../listen-upstream/realtime/cache'
import type {Asset} from '../../listen-upstream/realtime/planner'
import {TrackLibrary} from '../../listen-upstream/continuous/catalog'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import {loadListenIndex} from '../listen'
import {validateExecutionTrack} from '../device-execution'
import {verifyExecutionProfile} from '../device-prepare'
import {readMetadata,readMetadataBytes,sliceSceneSource,stretchSceneInputs} from './prepare'
import {reservePool} from './live-catalog'
import {extraFrames,validateMulti,verifyMultiTrack,type MultiApproval} from './multi-contract'
import type {ExtraPCM} from './multi-graph'
import {filterLoop} from './multi-dsp'

export async function prepareExtra(value:MultiApproval,ctx:AudioContext,shared:AudioCache,base:URL,signal:AbortSignal):Promise<ExtraPCM>{
 const approval=validateMulti(value);signal.throwIfAborted();if(ctx.sampleRate!==44100)throw Error('多来源采样率不匹配')
 const retained=approval.layers.reduce((n,l)=>n+extraFrames(l)*8,0),workspace=retained*6+16*1024*1024,owner=new Cache(ctx,base,()=>{},shared.pool)
 let reservation:(()=>void)|undefined,done=false
 const cache=new Proxy(owner,{get:(target,key)=>{if(key==='protected')return new Set([...shared.pool.owners].flatMap(c=>[...c.protected]));if(key==='load')return async(asset:Asset,s?:AbortSignal)=>{const pins=new Set([...shared.pool.owners].flatMap(c=>[...c.protected]));for(const key of shared.pool.buffers.keys()){if(shared.pool.bytes+asset.duration*44100*8<=shared.pool.limit)break;if(!pins.has(key))shared.pool.delete(key)}return target.load(asset,s)};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v}})
 try{
  reservation=reservePool(shared.pool,workspace)
  const read=(p:string,b:URL)=>readMetadata(p,b,signal),index=await loadListenIndex(base,read),library=new TrackLibrary(index.tracks,base,read),buffers=new Map<string,AudioBuffer>()
  for(const side of Object.keys(approval.sources)as ('c'|'d')[]){
   const proof=approval.sources[side]!,track=await library.load(proof.trackId);signal.throwIfAborted();verifyMultiTrack(proof,track)
   const m=validateExecutionTrack(await read('/listen/execution/tracks/'+track.id+'.json',base),track);signal.throwIfAborted()
   if(m.manifestSha256!==proof.manifestSha256||m.profile.sha256!==proof.profileSha256||(['drums','bass','other','vocals']as const).some(r=>m.stems[r]?.sourceSha256!==proof.stemSha256[r]))throw Error('多来源声部分轨指纹已变化')
   await verifyExecutionProfile(m,base,signal);signal.throwIfAborted()
   for(const layer of approval.layers.filter(l=>l.source===side)){
    const n=extraFrames(layer),duration=layer.lengthFrames/44100+(layer.rate===1?0:.5),start=layer.sourceStartFrame/44100
    if(start+duration>track.duration)throw Error('多来源源片段覆盖不足')
    const inputs:Record<string,AudioBuffer>={}
    if(layer.rate!==1)inputs.master=await sliceSceneSource(ctx,cache,nativeSegments(track),start,duration,signal)
    inputs[layer.role]=await sliceSceneSource(ctx,cache,m.stems[layer.role]!.segments,start,duration,signal)
    const output=await stretchSceneInputs(inputs,ctx,layer.rate,n,signal);signal.throwIfAborted();const input=output[layer.role],interleaved=new Float32Array(n*2)
    for(let i=0;i<n;i++){interleaved[2*i]=input.getChannelData(0)[i];interleaved[2*i+1]=input.getChannelData(1)[i]}
    const filtered=filterLoop(interleaved,44100,layer.filter),buffer=ctx.createBuffer(2,n,44100)
    for(let c=0;c<2;c++){const channel=buffer.getChannelData(c);for(let i=0;i<n;i++)channel[i]=filtered[2*i+c]}
    buffers.set(side+':'+layer.role,buffer)
   }
  }
  signal.throwIfAborted();reservation();reservation=reservePool(shared.pool,retained)
  let released=false;done=true;return{approval,buffers,release:()=>{if(released)return;released=true;buffers.clear();reservation?.();owner.dispose()}}
 }finally{for(const key of shared.pool.buffers.keys())if(!cache.protected.has(key))shared.pool.delete(key);if(!done){reservation?.();owner.dispose()}}
}
export {readMetadataBytes}
