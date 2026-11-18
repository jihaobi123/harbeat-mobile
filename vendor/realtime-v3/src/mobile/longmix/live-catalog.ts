import type {Exit} from './contract'
import type {ContinuationAssessment} from '../set-continuity'
import {AudioCache,type AudioBufferPool} from '../../listen-upstream/realtime/cache'
import type {Asset,Track} from '../../listen-upstream/realtime/planner'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import {canonicalJson} from '../jetson-contract'
import {prepareScene} from './prepare'
import {sceneBytes} from './contract'
import type {LayerPCM} from './graph'
import type {ExtraPCM} from './multi-graph'
import type {RolePCM} from './role-graph'
import {validateLiveIndex,validateLiveScene,verifyLiveTracks,outcomeOf,approvedExits,continuationPosition,type Entry,type LiveScene,type LiveOutcome} from './live-contract'
export type {Entry} from './live-contract'
export type LivePrepared={exits?:Exit[];approval:LiveScene;pcm:LayerPCM;target:Track;bodyBuffers:Map<string,AudioBuffer>;multi?:ExtraPCM;roles?:RolePCM;release:()=>void}
type Dependencies={read?:(path:string,signal:AbortSignal)=>Promise<ArrayBuffer>;prepare?:(scene:LiveScene['scene'],ctx:AudioContext,cache:AudioCache,base:URL,variant:'live',signal:AbortSignal)=>Promise<LayerPCM>;loadBody?:(asset:Asset,signal:AbortSignal)=>Promise<AudioBuffer>}
const digest=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('')
type PoolBudget={base:number;owners:Map<symbol,number>}
const budgets=new WeakMap<AudioBufferPool,PoolBudget>()
export function reservePool(pool:AudioBufferPool,bytes:number){
 const state=budgets.get(pool)??{base:pool.limit,owners:new Map<symbol,number>()},sum=()=>[...state.owners.values()].reduce((a,b)=>a+b,0)
 // This version-pinned seam changes only the allocation budget; the upstream
 // cache and its source fingerprints stay untouched. Account any independent
 // limit adjustment rather than overwriting another owner's budget on release.
 state.base=pool.limit+sum();const limit=state.base-sum()-bytes,pins=new Set([...pool.owners].flatMap(c=>[...c.protected]))
 for(const key of pool.buffers.keys()){if(pool.bytes<=limit)break;if(!pins.has(key))pool.delete(key)}
 if(limit<0||pool.bytes>limit)throw Error('当前播放已占满实时长混剩余内存预算')
 const token=Symbol('live-scene-workspace');state.owners.set(token,bytes);budgets.set(pool,state);(pool as {limit:number}).limit=limit
 let released=false;return()=>{if(released)return;released=true;state.base=pool.limit+sum();state.owners.delete(token);(pool as {limit:number}).limit=state.base-sum();if(!state.owners.size)budgets.delete(pool)}
}
/** One scene owner shares the ordinary pool without owning its playback pins. */
export class LiveCatalog{
 private rows:Entry[]=[];private owner:AudioCache;private cache:AudioCache;private lifetime=new AbortController();private prepared:LivePrepared|null=null;private preparing=false;private releaseBudget:(()=>void)|null=null
 constructor(private ctx:AudioContext,private shared:AudioCache,private base:URL,private deps:Dependencies={},readonly outcome:LiveOutcome='takeover-b',private continuation?:(track:Track,position:number)=>Pick<ContinuationAssessment,'allowed'|'reason'>){
  this.owner=new AudioCache(ctx,base,()=>{},shared.pool)
  // The audition slicer releases decoded inputs. Its view must include live
  // pins from all owners so it cannot evict a newly prefetched A chunk.
  this.cache=new Proxy(this.owner,{get:(target,key)=>{if(key==='protected')return new Set([...shared.pool.owners].flatMap(c=>[...c.protected]));if(key==='load')return async(asset:Asset,signal?:AbortSignal)=>{this.room(shared.pool.buffers.has(asset.url)?0:Math.ceil(asset.duration*ctx.sampleRate)*8);return target.load(asset,signal)};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v}})
 }
 private room(additional=0){const pool=this.shared.pool,pins=this.cache.protected;for(const key of pool.buffers.keys()){if(pool.bytes+additional<=pool.limit)break;if(!pins.has(key))pool.delete(key)}if(pool.bytes+additional>pool.limit)throw Error('当前播放与实时长混工作区合计超过内存预算')}
 private async read(path:string,signal:AbortSignal){
  signal.throwIfAborted();if(this.deps.read){const b=await this.deps.read(path,signal);signal.throwIfAborted();if(b.byteLength>2*1024*1024)throw Error('实时长混资料超过预算');return b}
  const response=await fetch(new URL(path,this.base),{cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});if(!response.ok)throw Error('实时长混资料未就绪 '+response.status)
  const reader=response.body?.getReader();if(!reader)throw Error('实时长混资料为空');const chunks:Uint8Array[]=[];let size=0
  try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error('实时长混资料超过预算');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}signal.throwIfAborted();return bytes.buffer
 }
 async load(signal:AbortSignal){const s=AbortSignal.any([signal,this.lifetime.signal]),bytes=await this.read((this.outcome==='return-a'?'/listen/longmix-return/v1/':'/listen/longmix-live/v1/')+'index.json',s);s.throwIfAborted();this.rows=validateLiveIndex(JSON.parse(new TextDecoder().decode(bytes)),this.outcome);return this.rows}
 candidates(a:Track,targets:Track[],position:number){const targetIds=new Set(targets.map(t=>t.id));return this.rows.filter(r=>r.from===a.id&&targetIds.has(r.to)&&r.sourcePosition>position+.75).sort((a,b)=>a.sourcePosition-b.sourcePosition||a.id.localeCompare(b.id))}
 async prepare(entry:Entry,a:Track,b:Track,position:()=>number,signal:AbortSignal):Promise<LivePrepared>{
  if(this.prepared||this.preparing)throw Error('已有一个实时长混场景占用准备预算')
  const s=AbortSignal.any([signal,this.lifetime.signal]);s.throwIfAborted();this.preparing=true;let installed=false
  const check=()=>{s.throwIfAborted();if(entry.sourcePosition<=position()+.75)throw Error('实时长混入口在准备期间已过')}
  try{
   check();validateLiveIndex({schema:this.outcome==='return-a'?'harbeat.live-layering-return-index.v1':'harbeat.live-layering-index.v1',scenes:[entry]},this.outcome)
   const bytes=await this.read(entry.url,s);check();if(await digest(bytes)!==entry.sha256)throw Error('实时长混批准指纹不一致');check()
   const approval=validateLiveScene(JSON.parse(new TextDecoder().decode(bytes)));verifyLiveTracks(approval,a,b);if(outcomeOf(approval)!==this.outcome)throw Error('实时长混结局与准备模式不匹配')
   if(approval.id!==entry.id||approval.scene.sources.a.trackId!==entry.from||approval.scene.sources.b.trackId!==entry.to||approval.entry.sourcePosition!==entry.sourcePosition||approval.sceneSha256!==entry.sceneSha256||await digest(new TextEncoder().encode(canonicalJson(approval.scene)).buffer)!==approval.sceneSha256)throw Error('实时长混场景指纹或目录身份不一致')
   check();const target=this.outcome==='return-a'?a:b,segments=nativeSegments(target),bodyAssets=new Map<string,Asset>(),exits=approvedExits(approval).filter(e=>this.continuation?.(target,continuationPosition(approval,e)).allowed!==false);if(!exits.length)throw Error('所有批准出口的下一跳准备空间不足，沿用普通混音')
   for(const e of exits){const position=continuationPosition(approval,e);for(const segment of segments)if(segment.end>position&&segment.start<position+16)bodyAssets.set(segment.asset.url,segment.asset)}
   const pins=this.cache.protected,pool=this.shared.pool;let retained=0
   for(const [url,buffer] of pool.buffers)if(pins.has(url))retained+=buffer.length*buffer.numberOfChannels*4
   const bodyBytes=[...bodyAssets].reduce((n,[url,asset])=>n+(pins.has(url)&&pool.buffers.has(url)?0:Math.ceil(asset.duration*this.ctx.sampleRate)*8),0)
   const workspace=sceneBytes(approval.scene,'live')
   if(retained+bodyBytes+workspace>pool.limit)throw Error('当前播放、后备与实时长混合计超过内存预算')
   // Acquire workspace before decoding any exit body: other owners continue
   // warming during these awaits and must already see the reduced budget.
   this.releaseBudget=reservePool(pool,workspace);this.room()
   const bodyBuffers=new Map<string,AudioBuffer>();for(const [url,asset] of bodyAssets){this.owner.protected.add(url);const buffer=await (this.deps.loadBody?this.deps.loadBody(asset,s):this.cache.load(asset,s));check();if(buffer.numberOfChannels!==2||buffer.sampleRate!==this.ctx.sampleRate||Math.abs(buffer.duration-asset.duration)>.04)throw Error('实时长混后续原曲缓冲覆盖不匹配');bodyBuffers.set(url,buffer)}
   const pcm=await (this.deps.prepare??prepareScene)(approval.scene,this.ctx,this.cache,this.base,'live',s);check();this.room()
   let released=false;const ready:LivePrepared={exits,approval,pcm,target,bodyBuffers,release:()=>{if(released)return;released=true;if(this.prepared===ready)this.prepared=null;this.releaseBudget?.();this.releaseBudget=null;this.owner.protected.clear()}}
   this.prepared=ready;installed=true;return ready
  }finally{this.preparing=false;if(!installed){this.releaseBudget?.();this.releaseBudget=null;this.owner.protected.clear()}}
 }
 dispose(){this.lifetime.abort();this.prepared?.release();this.owner.dispose();this.rows=[]}
}
