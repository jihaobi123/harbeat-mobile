import {AudioCache,type AudioBufferPool} from '../metric-upstream/realtime/cache'
import type {Asset} from '../metric-upstream/realtime/planner'

export const RESERVATION_CACHE_NAME='harbeat-reservation-audio-v1'
export const RESERVATION_MAX_BYTES=1024*1024*1024
export const RESERVATION_MAX_FILES=2048
const hash=/^[a-f0-9]{64}$/
const path=/^\/listen\/(?:(?:catalog\/[A-Za-z0-9_-]+\/)?media\/[A-Za-z0-9_.-]+\.(?:flac|wav)|execution-media\/[a-f0-9]{64}\.(?:flac|wav)|set-media\/[a-f0-9]{32}\/[a-f0-9]{64}\/(?:original|bass|filter|yield|vocal|bass_filter)\.wav)$/
export const audioFingerprint=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
function checkedKey(value:string){
 const url=new URL(value),sha=url.searchParams.get('sha256')??''
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||!path.test(url.pathname)||!hash.test(sha)||[...url.searchParams.keys()].some(k=>k!=='sha256')||url.searchParams.getAll('sha256').length!==1||(url.pathname.includes('/execution-media/')&&!url.pathname.includes('/'+sha+'.')))throw Error('预约音频地址或身份无效')
 return url
}
export function reservationAudioUrl(asset:Asset,base:URL){
 const url=new URL(asset.url,base)
 if(url.origin!==base.origin||!hash.test(asset.sha256)||!Number.isInteger(asset.bytes)||asset.bytes<=0)throw Error('预约音频地址或身份无效')
 url.searchParams.set('sha256',asset.sha256);return checkedKey(url.href)
}
type StoreOptions={storage?:()=>CacheStorage|undefined;estimate?:()=>Promise<StorageEstimate>;maxBytes?:number;maxFiles?:number}
/** Encoded reservations outlive the ordinary 256-file playback LRU. PCM stays
 * in the original bounded pool, and storage/quota failures remain observable. */
export class ReservationEncodedStore{
 private writes:Promise<void>=Promise.resolve()
 private sizes=new Map<string,number>()
 private cache?:Cache
 private initialized?:Promise<Cache>
 private maxBytes:number;private maxFiles:number
 constructor(private options:StoreOptions={}){this.maxBytes=Math.min(options.maxBytes??RESERVATION_MAX_BYTES,RESERVATION_MAX_BYTES);this.maxFiles=Math.min(options.maxFiles??RESERVATION_MAX_FILES,RESERVATION_MAX_FILES)}
 private async open(){
  if(this.cache)return this.cache
  if(!this.initialized)this.initialized=(async()=>{
   const storage=this.options.storage?.()??(typeof caches==='undefined'?undefined:caches)
   if(!storage)throw Error('当前设备无法保存本机缓存，播放时仍可联网读取')
   const cache=await storage.open(RESERVATION_CACHE_NAME)
   await this.refresh(cache)
   this.cache=cache;return cache
  })().catch(error=>{this.initialized=undefined;throw error})
  return this.initialized
 }
 private async refresh(cache:Cache){
  const sizes=new Map<string,number>()
  for(const key of await cache.keys()){
   try{checkedKey(key.url);const known=this.sizes.get(key.url),bytes=known??Number((await cache.match(key))?.headers.get('Content-Length'));if(!Number.isInteger(bytes)||bytes<=0||bytes>64*1024*1024)throw Error('invalid size');sizes.set(key.url,bytes)}catch{await cache.delete(key)}
  }
  this.sizes=sizes
 }
 private mutate(action:()=>Promise<void>){
  const work=this.writes.catch(()=>{}).then(async()=>{
   const locks=typeof navigator==='undefined'?undefined:navigator.locks
   // CacheStorage is shared between tabs. Modern browsers serialize mutations
   // under one origin-scoped lock; older WebViews retain the per-instance queue.
   if(locks?.request)await locks.request(RESERVATION_CACHE_NAME,action)
   else await action()
  })
  this.writes=work;return work
 }
 private async allowance(){
  let limit=this.maxBytes
  try{
   const estimate=this.options.estimate??(typeof navigator!=='undefined'&&navigator.storage?.estimate?()=>navigator.storage.estimate():undefined)
   const status=await estimate?.(),quota=status?.quota,usage=status?.usage
   // Existing reserved bytes already count toward usage. Spend at most 80% of
   // the remaining device quota on additional reservation data.
   if(Number.isFinite(quota)&&Number.isFinite(usage))limit=Math.min(limit,[...this.sizes.values()].reduce((s,b)=>s+b,0)+Math.floor(Math.max(0,quota!-usage!)*.8))
  }catch{}
  return Math.max(0,limit)
 }
 async budget(){const cache=await this.open();await this.refresh(cache);return this.allowance()}
 async read(key:string):Promise<ArrayBuffer|null>{
  checkedKey(key)
  try{const response=await (await this.open()).match(key);return response?await response.arrayBuffer():null}catch{return null}
 }
 async remove(key:string){
  checkedKey(key)
  return this.mutate(async()=>{const cache=await this.open();await this.refresh(cache);await cache.delete(key);this.sizes.delete(key)})
 }
 async write(key:string,bytes:ArrayBuffer){
  checkedKey(key)
  if(bytes.byteLength<=0||bytes.byteLength>64*1024*1024)throw Error('预约片段大小超出设备范围')
  const copy=bytes.slice(0)
  return this.mutate(async()=>{
   const cache=await this.open();await this.refresh(cache);const limit=await this.allowance()
   if(copy.byteLength>limit||this.maxFiles<1)throw Error('本机剩余空间不足，保留已下载的部分素材')
   if(await cache.match(key)){await cache.delete(key);this.sizes.delete(key)}
   let total=[...this.sizes.values()].reduce((sum,b)=>sum+b,0)
   for(const [old,size] of this.sizes){if(total+copy.byteLength<=limit&&this.sizes.size<this.maxFiles)break;await cache.delete(old);this.sizes.delete(old);total-=size}
   await cache.put(key,new Response(copy,{headers:{'Content-Type':key.includes('.wav?')?'audio/wav':'audio/flac','Content-Length':String(copy.byteLength)}}))
   this.sizes.set(key,copy.byteLength)
  })
 }
}
export const reservationEncodedStore=new ReservationEncodedStore()

type ReservedLoad={controller:AbortController;users:number;promise:Promise<AudioBuffer|null>}
/** Reserved bytes use the same browser decoder and bounded PCM pool directly.
 * Reading an existing reservation never requires another successful disk write. */
export class ReservationAudioCache extends AudioCache{
 private reservedLoads=new Map<string,ReservedLoad>()
 constructor(private reservationContext:AudioContext,private reservationBase:URL,private reservationProgress:(s:string)=>void,pool?:AudioBufferPool,private saved:Pick<ReservationEncodedStore,'read'|'remove'>=reservationEncodedStore){super(reservationContext,reservationBase,reservationProgress,pool)}
 override async load(asset:Asset,signal?:AbortSignal):Promise<AudioBuffer>{
  signal?.throwIfAborted();if(this.disposed)throw Error('播放器已关闭')
  const raw=new URL(asset.url,this.reservationBase)
  if(raw.protocol==='blob:')return super.load(asset,signal)
  const url=reservationAudioUrl(asset,this.reservationBase)
  if(asset.bytes>64*1024*1024)throw Error('素材超过本次内存限制')
  const identity=`${raw}|${asset.sha256}|${asset.duration}|${this.reservationContext.sampleRate}`
  if(this.buffers.has(asset.url)&&this.pool.identities.get(asset.url)===identity)return super.load(asset,signal)
  const reserved=await this.loadReserved(asset,url.href,identity,signal)
  return reserved??super.load(asset,signal)
 }
 private loadReserved(asset:Asset,url:string,identity:string,signal?:AbortSignal){
  let entry=this.reservedLoads.get(identity)
  if(entry?.controller.signal.aborted)entry=undefined
  if(!entry){
   const controller=new AbortController(),work:ReservedLoad={controller,users:0,promise:null!}
   work.promise=(async()=>{
    const bytes=await this.saved.read(url);controller.signal.throwIfAborted();if(this.disposed)throw Error('播放器已关闭');if(!bytes)return null
    if(bytes.byteLength!==asset.bytes||await audioFingerprint(bytes)!==asset.sha256){try{await this.saved.remove(url)}catch{};return null}
    controller.signal.throwIfAborted();if(this.disposed)throw Error('播放器已关闭')
    this.reservationProgress('正在读取预约音频并解码…')
    const buffer=await this.reservationContext.decodeAudioData(bytes)
    controller.signal.throwIfAborted();if(this.disposed)throw Error('播放器已关闭')
    if(Math.abs(buffer.duration-asset.duration)>.04)throw Error('解码时长与素材记录不一致')
    const installed=this.pool.put(asset.url,identity,buffer);this.reservationProgress('素材已就绪');return installed
   })().finally(()=>{if(this.reservedLoads.get(identity)===work)this.reservedLoads.delete(identity)})
   this.reservedLoads.set(identity,work);entry=work
  }
  const shared=entry;shared.users++
  return new Promise<AudioBuffer|null>((resolve,reject)=>{
   let finished=false
   const done=(error?:unknown,value?:AudioBuffer|null)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);shared.users--;if(!shared.users)shared.controller.abort();error?reject(error):resolve(value??null)}
   const cancel=()=>done(signal?.reason??new DOMException('音频准备已取消','AbortError'))
   signal?.addEventListener('abort',cancel,{once:true});shared.promise.then(value=>done(undefined,value),error=>done(error));if(signal?.aborted)cancel()
  })
 }
 override dispose(){for(const work of this.reservedLoads.values())work.controller.abort();this.reservedLoads.clear();super.dispose()}
}
