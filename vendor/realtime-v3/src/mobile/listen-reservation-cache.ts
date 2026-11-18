import {AudioCache,type AudioBufferPool} from '../listen-upstream/realtime/cache'
import type {Asset} from '../listen-upstream/realtime/planner'
import {reservationEncodedStore,reservationAudioUrl,audioFingerprint, type ReservationEncodedStore} from './reservation-cache'
type ReservedLoad={controller:AbortController;users:number;promise:Promise<AudioBuffer|null>}
/** Reserved bytes use the same browser decoder and bounded PCM pool directly.
 * Reading an existing reservation never requires another successful disk write. */
export class ListenReservationAudioCache extends AudioCache{
 private reservedLoads=new Map<string,ReservedLoad>()
 constructor(private reservationContext:AudioContext,private reservationBase:URL,private reservationProgress:(s:string)=>void,pool?:AudioBufferPool,private saved:Pick<ReservationEncodedStore,'read'|'remove'>=reservationEncodedStore){super(reservationContext,reservationBase,reservationProgress,pool)}
 override async load(asset:Asset,signal?:AbortSignal):Promise<AudioBuffer>{
  signal?.throwIfAborted();if(this.disposed)throw Error('播放器已关闭')
  const raw=new URL(asset.url,this.reservationBase)
  if(raw.protocol==='blob:')return super.load(asset,signal)
  if(raw.origin!==this.reservationBase.origin)throw Error('音频来源不属于当前曲库')
  if(!raw.pathname.startsWith('/listen/'))return super.load(asset,signal)
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
