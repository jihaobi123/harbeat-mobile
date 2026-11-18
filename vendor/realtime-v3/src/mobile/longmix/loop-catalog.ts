import {AudioCache} from '../../listen-upstream/realtime/cache'
import type {Asset,Track} from '../../listen-upstream/realtime/planner'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import {validateExecutionTrack} from '../device-execution'
import {verifyExecutionProfile} from '../device-prepare'
import {sliceSceneSource,readMetadata,readMetadataBytes} from './prepare'
import {reservePool} from './live-catalog'
import {validateLoopIndex,validateLoop,verifyLoopTrack,loopBytes,type LoopApproval,type LoopEntry} from './loop-contract'
export type LoopPrepared={approval:LoopApproval;track:Track;buffer:AudioBuffer;bodyBuffers:Map<string,AudioBuffer>;release:()=>void}
export class LoopCatalog{
 private owner:AudioCache;private cache:AudioCache;private lifetime=new AbortController();private held:LoopPrepared|null=null;private busy=false
 constructor(private ctx:AudioContext,private shared:AudioCache,private base:URL,private continuation?:(track:Track,position:number)=>boolean){this.owner=new AudioCache(ctx,base,()=>{},shared.pool);this.cache=new Proxy(this.owner,{get:(target,key)=>{if(key==='protected')return new Set([...shared.pool.owners].flatMap(c=>[...c.protected]));if(key==='load')return async(a:Asset,s?:AbortSignal)=>{const needed=shared.pool.buffers.has(a.url)?0:Math.ceil(a.duration*ctx.sampleRate)*8;for(const u of shared.pool.buffers.keys()){if(shared.pool.bytes+needed<=shared.pool.limit)break;if(!this.cache.protected.has(u))shared.pool.delete(u)}if(shared.pool.bytes+needed>shared.pool.limit)throw Error('循环与当前播放超出共享预算');return target.load(a,s)};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v}})}
 async candidates(track:Track,position:number,signal:AbortSignal){const v=await readMetadata('/listen/loop-extension/v1/index.json',this.base,signal);return validateLoopIndex(v).filter(r=>r.trackId===track.id&&r.startFrame/44100>position+1).sort((a,b)=>a.startFrame-b.startFrame)}
 async prepare(entry:LoopEntry,track:Track,position:()=>number,signal:AbortSignal):Promise<LoopPrepared>{
  if(this.busy||this.held)throw Error('循环准备已有所有者');this.busy=true;let release=()=>{},installed=false
  const s=AbortSignal.any([signal,this.lifetime.signal]),check=()=>{s.throwIfAborted();if(entry.startFrame/44100<=position()+.75)throw Error('循环入口已过')}
  try{check();const bytes=await readMetadataBytes(entry.url,this.base,s);check();const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');if(sha!==entry.sha256)throw Error('循环批准指纹不符');const raw=JSON.parse(new TextDecoder().decode(bytes));const p=validateLoop(raw);verifyLoopTrack(p,track);if(this.continuation?.(track,(p.startFrame+p.lengthFrames)/44100)===false)throw Error('循环释放后缺少下一跳准备空间');if(p.id!==entry.id||p.startFrame!==entry.startFrame||p.source.trackId!==entry.trackId)throw Error('循环目录身份不匹配')
   const m=validateExecutionTrack(await readMetadata('/listen/execution/tracks/'+track.id+'.json',this.base,s),track);if(m.manifestSha256!==p.source.manifestSha256||m.profile.sha256!==p.source.profileSha256||(['drums','bass','other','vocals'] as const).some(r=>m.stems[r]?.sourceSha256!==p.source.stemSha256[r]))throw Error('循环声部版本已变更');await verifyExecutionProfile(m,this.base,s);check()
   release=reservePool(this.shared.pool,loopBytes(p,16));const assets=new Map<string,Asset>();for(const phase of [p.lengthFrames/2,p.lengthFrames]){const pos=(p.startFrame+phase)/44100;for(const z of nativeSegments(track))if(z.end>pos&&z.start<pos+16)assets.set(z.asset.url,z.asset)}
   const bodyBuffers=new Map<string,AudioBuffer>();for(const [url,a] of assets){this.owner.protected.add(url);const b=await this.cache.load(a,s);check();if(b.numberOfChannels!==2||b.sampleRate!==44100||Math.abs(b.duration-a.duration)>.04)throw Error('循环出口素材覆盖不符');bodyBuffers.set(url,b)}
   const buffer=await sliceSceneSource(this.ctx,this.cache,nativeSegments(track),p.startFrame/44100,(p.lengthFrames+Math.ceil(.008*44100))/44100,s);check();if(buffer.length!==p.lengthFrames+Math.ceil(.008*44100)||this.ctx.sampleRate!==44100)throw Error('循环源样本覆盖不符')
   let released=false;const ready:LoopPrepared={approval:p,track,buffer,bodyBuffers,release:()=>{if(released)return;released=true;release();this.owner.protected.clear();if(this.held===ready)this.held=null}};this.held=ready;installed=true;return ready
  }finally{this.busy=false;if(!installed){release();this.owner.protected.clear()}}
 }
 dispose(){this.lifetime.abort();this.held?.release();this.owner.dispose()}
}
