import {TrackLibrary, readLibraryIndex, type LibraryIndex} from '../metric-upstream/continuous/catalog'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import {initializeFromGesture} from '../metric-upstream/continuous/activation'
import {MetricTransport} from '../metric-upstream/metric-mix/transport'
import {canArm} from '../metric-upstream/metric-mix/plan'
import type {Prepared, Method} from '../metric-upstream/metric-mix/types'
import type {Track} from '../metric-upstream/realtime/planner'
import type {Host} from './session'

const hash=/^[a-f0-9]{64}$/
export const METHODS:Method[]=['original','bass','filter','yield','vocal','bass_filter']
export const METRIC_RELEASE={id:'metric-mix-mobile-20261020',sourceCommit:'978df49191450a602f1b473b31f630a687585a8d',policyVersion:'metric-mix-v1.0'}
let nativeSequence=0
export function nativeMetricJob(host:Host,payload:object,signal:AbortSignal){return new Promise<any>((resolve,reject)=>{
 const id=++nativeSequence
 const finish=(error?:Error,data?:any)=>{clearTimeout(timer);window.removeEventListener('harbeat-metric-result',received);signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(data)}
 const abort=()=>finish(new DOMException('已取消','AbortError'))
 const received=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.id!==id)return;try{const reply=JSON.parse(detail.reply);finish(reply.ok?undefined:new Error(reply.error||'云端准备失败'),reply.data)}catch{finish(new Error('混音服务响应不完整'))}}
 const timer=setTimeout(()=>finish(new Error('混音服务连接超时，请重试')),35000)
 window.addEventListener('harbeat-metric-result',received);signal.addEventListener('abort',abort,{once:true})
 if(signal.aborted){abort();return}
 try{host.requestMetric!(id,JSON.stringify(payload))}catch{finish(new Error('手机混音服务连接未完成'))}
})}
async function requestJson(url:URL,options:RequestInit,signal?:AbortSignal){
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason)
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
 const timer=setTimeout(()=>controller.abort(),35000)
 try{const response=await fetch(url,{...options,signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'混音服务暂不可用，请重试');return data}
 catch(e){if(controller.signal.aborted&&!signal?.aborted)throw Error('混音服务读取超时，请重试');throw e}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
export async function readMetricJson(path:string,base:URL,signal?:AbortSignal){
 return requestJson(new URL(path,base),{cache:'no-store'},signal)
}
export function validatePrepared(value:Prepared,a:Track,b:Track,start:number,windowId:string):Prepared{
 if(value?.schema!=='harbeat.metric-mix-result.v1'||value.status!=='ready'||!hash.test(value.id)||value.policyVersion!==METRIC_RELEASE.policyVersion||!hash.test(value.codeVersion))throw Error('混音结果版本不匹配')
 const p=value.plan
 if(!p||p.from!==a.id||p.to!==b.id||p.windowId!==windowId||!Number.isFinite(p.start)||Math.abs(p.start-start)>.002||
  ![p.end,p.duration,p.rate,p.bStart,p.bEnd,p.beatErrorMs].every(Number.isFinite)||p.duration<1||p.duration>32||
  Math.abs(p.end-p.start-p.duration)>.01||p.end>a.duration+.05||p.rate<.95||p.rate>1.05||p.bStart<0||p.bEnd>b.duration-12||Math.abs(p.bStart+p.duration*p.rate-p.bEnd)>.05||p.beatErrorMs>65||p.beatErrorMs<0)throw Error('云端结果与本次接点不一致')
 if(!value.decision?.methods||!METHODS.includes(value.decision.recommended))throw Error('推荐方案不完整')
 for(const [key,asset] of Object.entries(value.assets??{})){
  if(!METHODS.includes(key as Method)||!asset||asset.url!==`/listen/smart-media/${value.id}/${key}.wav`||!hash.test(asset.sha256)||!Number.isFinite(asset.bytes)||asset.bytes<=0||asset.bytes>64*1024*1024||!Number.isFinite(asset.duration)||Math.abs(asset.duration-p.duration)>.04)throw Error('交接素材身份或时长不一致')
 }
 const method=value.decision.recommended
 if(!value.assets[method]||value.decision.methods[method]?.eligible!==true)throw Error('推荐方案没有通过素材检查')
 return value
}
function delay(signal:AbortSignal,ms:number){return new Promise<void>((resolve,reject)=>{
 const timer=setTimeout(done,ms)
 function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('已取消','AbortError'))}
 function done(){signal.removeEventListener('abort',abort);resolve()}
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
})}

/** Mobile orchestration only. The pinned upstream planner/cache/audio clock are separate. */
export class MetricRun{
 readonly library:TrackLibrary
 player:MetricTransport|null=null
 selected:string|null=null;label='';query='';volume=.85
 working=false;notice='选择当前歌曲后开始播放';error=''
 result:Prepared|null=null;method:Method='original'
 private pair:{a:Track;b:Track}|null=null;private revision=0;private request:AbortController|null=null;private alive=true;private lastCurrent:string|null=null
 constructor(readonly index:LibraryIndex,readonly base:URL,private changed:()=>void,private host?:Host,
  private create=(base:URL,changed:()=>void)=>new MetricTransport(base,changed),private read=readMetricJson){
  this.library=new TrackLibrary(index.tracks,base,(path,base)=>this.read(path,base))
 }
 private update(){
  const current=this.player?.current
  if(current&&current.id!==this.lastCurrent){
   if(this.lastCurrent){this.notice='交接完成，已进入 '+current.title+'，可以继续选择下一首'}
   this.lastCurrent=current.id
   if(this.selected===current.id)this.selected=null
  }
  if(this.alive)this.changed()
 }
 private invalidate(clear=true){this.revision++;this.request?.abort();this.request=null;this.working=false;this.error='';if(clear){this.result=null;this.pair=null}this.update()}
 private async ensure(){
  if(this.host&&!this.host.requestFocus())throw Error('请回到前台后再播放')
  if(!this.player){this.player=this.create(this.base,()=>this.update());this.player.setVolume(this.volume)}
  await initializeFromGesture(this.player)
  return this.player
 }
 async start(id:string){
  if(this.player?.transition)throw Error('请先完成交接或停止，再更换当前歌曲')
  this.invalidate();const token=this.revision;this.working=true;this.update()
  try{const p=await this.ensure(),track=await this.library.load(id);if(!this.alive||token!==this.revision)return;await p.start(track);if(!this.alive||token!==this.revision)return;this.library.trim(new Set([id,this.selected??'']));this.notice='当前歌曲继续播放，选择下一首后准备智能交接'}finally{if(token===this.revision){this.working=false;this.update()}}
 }
 choose(id:string){
  if(this.player?.transition)throw Error('已安排交接，请等待完成或停止后重选')
  if(!this.index.tracks.some(t=>t.id===id&&t.playStatus==='ready'&&t.mixStatus==='ready'))throw Error('这首歌尚未具备智能混音条件')
  if(id===this.player?.current?.id)throw Error('请选择不同的下一首')
  this.invalidate();this.selected=id;this.notice='已选择下一首，当前歌曲继续播放';this.update()
 }
 async prepare(){
  const p=this.player,id=this.selected;if(!p?.current||!id||id===p.current.id||p.transition||p.busy)throw Error('先播放当前歌曲并选择不同的下一首')
  this.invalidate();const token=this.revision,controller=this.request=new AbortController(),a=p.current
  this.working=true;this.notice='正在读取下一首的分析资料…';this.update()
  try{
   const b=await this.library.load(id);if(!this.alive||token!==this.revision)return
   this.library.trim(new Set([a.id,b.id]))
   const plan=planContinuous(a,[b],p.position+25,{kind:'next',targetId:b.id},new Set(),60,false).best
   if(!plan)throw Error('附近没有通过拍点、人声和速度检查的接点。请换一首，或将当前歌定位到较早位置')
   if(Math.abs(plan.rate-1)>.05)throw Error('这组需要超过 5% 的变速，请换一首速度更接近的歌')
   this.notice='云端正在分析分轨并准备转场，当前歌曲继续播放…';this.update()
   const payload={from:a.id,to:b.id,windowId:plan.window.id,start:plan.start}
   let job:any
   if(this.host?.requestMetric)job=await nativeMetricJob(this.host,payload,controller.signal)
   else if(this.host?.prepareMetric){const response=JSON.parse(this.host.prepareMetric(JSON.stringify(payload)));if(!response.ok)throw Error(response.error||'云端准备失败');job=response.data}
   else job=await requestJson(new URL('/listen/smart-api/jobs',this.base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},controller.signal)
   if(!hash.test(job?.id))throw Error('云端任务编号无效')
   for(let i=0;i<180;i++){
    if(!this.alive||token!==this.revision)return
    const data=await this.read('/listen/smart-api/jobs/'+job.id,this.base,controller.signal)
    if(!this.alive||token!==this.revision)return
    if(data.status==='failed')throw Error(data.message||'本次准备未完成，请换歌或重试')
    if(data.status==='ready'){
     if(data.id!==job.id)throw Error('交接任务身份不一致')
     this.result=validatePrepared(data,a,b,plan.start,plan.window.id);this.pair={a,b};this.method=this.result.decision.recommended
     this.notice=canArm(data.plan,p.current?.id??null,p.position)?'智能交接已就绪，确认方案后接歌':'原接点已过，可试听这组交接，或重新准备';return
    }
    this.notice=data.message||'云端准备中，当前歌曲继续播放…';this.update();await delay(controller.signal,2000)
   }
   throw Error('云端准备超时，请稍后重试')
  }catch(e){if(token===this.revision&&(e as Error).name!=='AbortError')this.error=(e as Error).message}
  finally{if(token===this.revision){this.working=false;this.update()}}
 }
 selectMethod(method:Method){if(this.player?.transition||this.player?.busy)throw Error('请等待本次交接完成');if(!this.result?.assets[method]||!this.result.decision.methods[method]?.eligible)throw Error('该方法没有通过本轮检查');this.method=method;this.update()}
 async apply(audition=false){
  if(!this.result||!this.pair||this.working||this.player?.transition)throw Error('请先准备本次交接')
  const result=this.result,pair=this.pair,method=this.method,token=++this.revision;this.working=true;this.update()
  try{const p=await this.ensure();if(!this.alive||token!==this.revision)return;if(audition)await p.audition(result,method,pair.a,pair.b);else await p.arm(result,method,pair.b)}finally{if(token===this.revision){this.working=false;this.update()}}
 }
 pause(){this.invalidate(false);this.player?.pause();this.save()}
 async resume(){const p=await this.ensure();await p.resume()}
 async seek(position:number){if(this.player?.transition)throw Error('请先完成交接或停止，再调整位置');this.invalidate();const paused=this.player?.paused;await this.player?.seek(position);if(paused)this.player?.pause()}
 cancel(){if(this.player?.transition)throw Error('已安排交接；暂停可暂停时间轴，停止可取消');this.invalidate();this.notice='已取消准备，当前歌曲继续播放';this.update()}
 stop(){this.invalidate();this.player?.stop();this.notice='已停止';this.save();this.update()}
 pauseForHost(){this.invalidate(false);if(this.player?.busy){this.player.stop();this.notice='已暂停准备，回到前台后重新开始'}else this.player?.pause();this.save()}
 setVolume(value:number){if(!Number.isFinite(value))throw Error('音量无效');this.volume=Math.max(0,Math.min(1,value));this.player?.setVolume(this.volume);this.update()}
 filters(value:{label?:string;query?:string}){this.label=value.label??this.label;this.query=value.query??this.query;this.update()}
 export(){return {...this.player?.export(),schema:'harbeat.metric-mix-session.v1',release:METRIC_RELEASE,selectedResult:this.result,selectedMethod:this.method,exportedAt:new Date().toISOString()}}
 save(){if(this.player)this.host?.saveSession(JSON.stringify(this.export()))}
 dispose(){this.alive=false;this.invalidate();this.save();this.player?.dispose()}
 snapshot(){const p=this.player,r=this.result;return {release:METRIC_RELEASE,selected:this.selected,label:this.label,query:this.query,volume:this.volume,working:this.working,notice:this.error||this.notice,canArm:!!r&&canArm(r.plan,p?.current?.id??null,p?.position??0)&&!p?.transition,
  result:r?{id:r.id,policyVersion:r.policyVersion,plan:r.plan,metrics:r.metrics,decision:r.decision,available:METHODS.filter(m=>r.assets[m]&&r.decision.methods[m]?.eligible)}:null,method:this.method}}
}
export async function loadMetricIndex(base:URL){return readLibraryIndex(await readMetricJson('/listen/library.json',base))}
