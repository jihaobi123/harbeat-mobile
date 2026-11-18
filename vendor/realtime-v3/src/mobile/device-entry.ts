import {ListenReservationAudioCache as AudioCache} from './listen-reservation-cache'
import {nativeSegments} from '../listen-upstream/continuous/segments'
import type {Track,Asset,Window} from '../listen-upstream/realtime/planner'
export const DEVICE_TEMPO='device-ffmpeg-atempo-v1'
type Entry={track:Track;window:Window;asset:Asset;reference:Asset|null;key:string}
const sha=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
export function entryFrames(window:Pick<Window,'start'|'end'>,duration:number,sampleRate:number){
 if(![window.start,window.end,duration,sampleRate].every(Number.isFinite)||window.start<0||window.end<=window.start||duration<.5||duration>40||sampleRate!==44100)throw Error('端侧变速参数不完整')
 return {start:Math.round(Number(window.start.toFixed(6))*sampleRate),end:Math.round(Number(window.end.toFixed(6))*sampleRate),frames:Math.round(duration*sampleRate)}
}
/** Virtual generated assets have their own URL and measured PCM SHA, never the
 * published reference SHA. Only native sources are downloaded and SHA checked. */
export class DeviceEntryCache extends AudioCache{
 private entries=new Map<string,Entry>();private jobs=new Map<string,{controller:AbortController;users:number;promise:Promise<AudioBuffer>}>();private queue:Promise<unknown>=Promise.resolve();private worker:Worker|null=null;private sequence=0;private pending=new Map<number,{resolve:(v:ArrayBuffer)=>void;reject:(e:unknown)=>void;timer:ReturnType<typeof setTimeout>}>()
 private sourceCache:AudioCache;private sourcePins=new Map<string,number>()
 readonly renders:Record<string,unknown>[]=[]
 private bodySegments(e:Entry){return nativeSegments(e.track).filter(s=>s.end>e.window.end&&s.start<Math.min(e.track.duration,e.window.end+30))}
 private protectSources(){
  const urls=new Set(this.disposed?[]:this.sourcePins.keys())
  if(!this.disposed)for(const url of this.protected){const e=this.entries.get(url);if(e)for(const s of this.bodySegments(e))urls.add(s.asset.url)}
  this.sourceCache.protected=urls
 }
 override get ready(){
  this.protectSources();const ready=super.ready
  for(const url of ready){const e=this.entries.get(url);if(e&&this.bodySegments(e).some(s=>!ready.has(s.asset.url)))ready.delete(url)}
  return ready
 }
 private pinSources(urls:string[]){
  for(const url of urls)this.sourcePins.set(url,(this.sourcePins.get(url)??0)+1);this.protectSources()
  return ()=>{for(const url of urls){const n=(this.sourcePins.get(url)??1)-1;if(n)this.sourcePins.set(url,n);else this.sourcePins.delete(url)}this.protectSources()}
 }
 constructor(private context:AudioContext,private origin:URL,private event:(kind:string,data:Record<string,unknown>)=>void){super(context,origin,()=>{});this.sourceCache=new AudioCache(context,origin,()=>{},this.pool)}
 async register(track:Track,derivedTargets:readonly {id:string;bpm:number}[]=[]):Promise<Track>{
  if(derivedTargets.length&&!/^[a-f0-9]{64}$/.test(String(track.provenance?.masterSha256)))throw Error('原曲来源身份缺失，不能生成进入段')
  const windows=await Promise.all(track.windows.map(async window=>{
   const specs=new Map(Object.entries(window.variants).map(([id,reference])=>[id,{reference:reference as Asset|null,rate:reference.rate!,duration:reference.duration}]))
   for(const target of derivedTargets){
    if(target.id===track.id||specs.has(target.id)||!Number.isFinite(target.bpm)||target.bpm<=0)continue
    if(![2,4].includes(window.bars)||!Number.isFinite(window.start)||!Number.isFinite(window.end)||window.start<0||window.end<=window.start||window.end>track.duration)throw Error('来源接点参数无效')
    const exact=window.bars*240/target.bpm,rate=(window.end-window.start)/exact
    if(rate<.8||rate>1.2)continue
    const duration=Math.round(exact*this.context.sampleRate)/this.context.sampleRate
    entryFrames(window,duration,this.context.sampleRate)
    specs.set(target.id,{reference:null,rate,duration})
   }
   const variants=Object.fromEntries(await Promise.all([...specs].map(async([id,{reference,rate,duration}])=>{
    const key=await sha(new TextEncoder().encode(JSON.stringify([DEVICE_TEMPO,track.id,track.provenance,track.native,track.audioSegments,window.id,window.start,window.end,rate,duration,this.context.sampleRate])))
    const url='device-entry/'+key+'.f32',existing=this.entries.get(url),measured=this.pool.identities.get(url)?.split('|')[1]
    const asset=existing?.asset??{url,rate,duration,sha256:measured??'pending-device-pcm',bytes:Math.round(duration*this.context.sampleRate)*8}
    if(!existing)this.entries.set(url,{track,window,asset,reference,key})
    return [id,asset]
   })))
   return {...window,variants}
  }))
  return {...track,windows:windows as Track['windows']}
 }
 retainTracks(ids:string[]){const keep=new Set(ids);for(const [url,e] of this.entries)if(!keep.has(e.track.id)&&!this.jobs.has(url)&&!this.protected.has(url))this.entries.delete(url)}
 async load(asset:Asset,signal?:AbortSignal):Promise<AudioBuffer>{
  signal?.throwIfAborted();this.protectSources();const entry=this.entries.get(asset.url);if(!entry)return super.load(asset,signal)
  if(this.disposed)throw Error('播放器已关闭')
  const hit=this.buffers.get(asset.url)
  if(hit){
   const body=this.bodySegments(entry),release=this.pinSources(body.map(s=>s.asset.url)),controller=new AbortController(),abort=()=>controller.abort(signal?.reason)
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
   try{await Promise.all(body.map(s=>this.sourceCache.load(s.asset,controller.signal)));controller.signal.throwIfAborted();if(this.disposed)throw Error('播放器已关闭');return hit}
   finally{controller.abort();signal?.removeEventListener('abort',abort);release()}
  }
  let job=this.jobs.get(asset.url)
  if(job?.controller.signal.aborted)job=undefined
  if(!job){
   const controller=new AbortController(),work={controller,users:0,promise:Promise.resolve(null as unknown as AudioBuffer)}
   work.promise=this.queue.catch(()=>{}).then(()=>{controller.signal.throwIfAborted();return this.render(entry,controller.signal)}).finally(()=>{if(this.jobs.get(asset.url)===work)this.jobs.delete(asset.url)})
   this.queue=work.promise.then(()=>{},()=>{});this.jobs.set(asset.url,work);job=work
  }
  const shared=job;shared.users++
  return new Promise((resolve,reject)=>{let done=false;const finish=(error?:unknown,value?:AudioBuffer)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);shared.users--;if(!shared.users)shared.controller.abort();error?reject(error):resolve(value!)},abort=()=>finish(signal?.reason??new DOMException('已取消','AbortError'));signal?.addEventListener('abort',abort,{once:true});shared.promise.then(v=>finish(undefined,v),e=>finish(e));if(signal?.aborted)abort()})
 }

 private process(pcm:Float32Array,rate:number,frames:number,signal:AbortSignal):Promise<ArrayBuffer>{
  if(!this.worker){this.worker=new Worker(new URL('device-atempo-worker.js',this.origin));this.worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);if(data.error)p.reject(Error(data.error));else p.resolve(data.output)};this.worker.onerror=()=>this.resetWorker(Error('端侧变速组件未能启动'))}
  const id=++this.sequence
  return new Promise((resolve,reject)=>{const abort=()=>this.resetWorker(new DOMException('已取消','AbortError'));signal.addEventListener('abort',abort,{once:true});const clean=()=>signal.removeEventListener('abort',abort);const timer=setTimeout(()=>this.resetWorker(Error('端侧变速超时，当前歌曲继续播放')),25000);this.pending.set(id,{resolve:v=>{clean();resolve(v)},reject:e=>{clean();reject(e)},timer});this.worker!.postMessage({id,pcm:pcm.buffer,sampleRate:this.context.sampleRate,rate,frames},[pcm.buffer]);if(signal.aborted)abort()})
 }
 private resetWorker(error:Error){this.worker?.terminate();this.worker=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}this.pending.clear()}
 private async render(e:Entry,signal:AbortSignal){
  signal.throwIfAborted()
  const began=performance.now(),sr=this.context.sampleRate,{start,end,frames}=entryFrames(e.window,e.asset.duration,sr),segments=nativeSegments(e.track).filter(s=>Math.round(s.end*sr)>start&&Math.round(s.start*sr)<end)
  const body=this.bodySegments(e),required=[...new Map([...segments,...body].map(s=>[s.asset.url,s])).values()],release=this.pinSources(required.map(s=>s.asset.url))
  try{
   const loaded=await Promise.all(required.map(s=>this.sourceCache.load(s.asset,signal)));if(this.disposed)throw Error('播放器已关闭');signal.throwIfAborted()
   const byUrl=new Map(required.map((s,i)=>[s.asset.url,loaded[i]])),buffers=segments.map(s=>byUrl.get(s.asset.url)!)
   const pcm=new Float32Array((end-start)*2);let cursor=start
   for(let i=0;i<segments.length;i++){const s=segments[i],buffer=buffers[i],base=Math.round(s.start*sr),from=Math.max(start,base),to=Math.min(end,Math.round(s.end*sr));if(from!==cursor||buffer.sampleRate!==sr||buffer.numberOfChannels!==2||buffer.length<to-base)throw Error('原曲未连续覆盖变速窗口');for(let c=0;c<2;c++){const channel=buffer.getChannelData(c);for(let j=from;j<to;j++)pcm[(j-start)*2+c]=channel[j-base]}cursor=to}
   if(cursor!==end)throw Error('原曲未覆盖完整进入段')
   this.event('device_entry_preparing',{trackId:e.track.id,windowId:e.window.id,rate:e.asset.rate,referenceSha256:e.reference?.sha256??null,rendering:DEVICE_TEMPO})
   const bytes=await this.process(pcm,e.asset.rate!,frames,signal);if(this.disposed)throw Error('播放器已关闭');signal.throwIfAborted();const samples=new Float32Array(bytes);if(samples.some(v=>!Number.isFinite(v)))throw Error('变速输出无效')
   e.asset.sha256=await sha(bytes);const buffer=this.context.createBuffer(2,frames,sr);for(let c=0;c<2;c++){const channel=buffer.getChannelData(c);for(let i=0;i<frames;i++)channel[i]=samples[i*2+c]}
   const proof={rendering:DEVICE_TEMPO,trackId:e.track.id,windowId:e.window.id,source:e.track.provenance,sourceAssets:segments.map(s=>s.asset),continuationAssets:body.map(s=>s.asset),continuationSourceEnd:body.at(-1)?.end??e.window.end,sourceStart:e.window.start,sourceEnd:e.window.end,rate:e.asset.rate,output:{...e.asset,format:'interleaved-f32le',sampleRate:sr,channels:2},referenceEntry:e.reference,entrySpecification:e.reference?'published-reference':'source-window-geometry',elapsedMs:performance.now()-began,referenceDownloaded:false}
   this.renders.push(proof);this.event('device_entry_ready',proof);return this.pool.put(e.asset.url,e.key+'|'+e.asset.sha256,buffer)
  }finally{release()}
 }
 dispose(){for(const job of this.jobs.values())job.controller.abort();super.dispose();this.sourceCache.dispose();this.resetWorker(Error('播放器已关闭'))}
}
