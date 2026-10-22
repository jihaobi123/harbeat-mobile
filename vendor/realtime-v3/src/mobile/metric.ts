import {TrackLibrary, readLibraryIndex, type LibraryIndex,type LibraryEntry} from '../metric-upstream/continuous/catalog'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import {initializeFromGesture} from '../metric-upstream/continuous/activation'
import {MetricTransport} from './device-transport'
import {canArm} from '../metric-upstream/metric-mix/plan'
import type {Prepared, Method} from '../metric-upstream/metric-mix/types'
import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {nativeSegment} from '../metric-upstream/continuous/segments'
import {candidateStages,rankContinuousChoices,rankNearbyChoices,choiceForPlan,SMART_POLICY,NEARBY_DIRECTION_POLICY,styleMatches,type SmartChoice} from './smart-selection'
import type {Host} from './session'
import {mixNearby,nearbyPlan} from './nearby'
import {localOriginal,preloadOriginal} from './local-original'
import {nearbyResult} from './nearby-result'

const hash=/^[a-f0-9]{64}$/
import {METHODS,METRIC_RELEASE,validatePrepared} from './prepared'
export {METHODS,METRIC_RELEASE,validatePrepared} from './prepared'
import {ActivitySession} from './activity-session'
import {cacheActivityAssets,type SetCacheProgress} from './set-cache'
import {prepareDevice,preloadDevice,loadPrepared,hasDevicePCM,pinDevicePCM,releaseDevicePCM,deviceBufferUsage} from './device-prepare'
import {PreparedPool} from './prepared-pool'
import {hasMethod} from './device-execution'
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

function delay(signal:AbortSignal,ms:number){return new Promise<void>((resolve,reject)=>{
 const timer=setTimeout(done,ms)
 function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('已取消','AbortError'))}
 function done(){signal.removeEventListener('abort',abort);resolve()}
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
})}

/** Stop awaiting superseded metadata even when a shared library read cannot
 * be cancelled. The original read may still populate its source-validated cache. */
function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise<T>((resolve,reject)=>{
  const cleanup=()=>signal.removeEventListener('abort',abort)
  const abort=()=>{cleanup();reject(signal.reason??new DOMException('已取消','AbortError'))}
  signal.addEventListener('abort',abort,{once:true})
  operation.then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)})
  if(signal.aborted)abort()
 })
}

function expiredCue(){return Object.assign(new Error('当前接点已过，将重新寻找后续可用窗口'),{code:'cue_expired'})}
const isExpiredCue=(error:unknown)=>(error as {code?:unknown})?.code==='cue_expired'

/** One player: source playback, recommendation, cloud stem choice and handoff. */
export class MetricRun {
 readonly library:TrackLibrary
 player:MetricTransport|null=null
 selected:string|null=null;label='';query='';volume=.85
 automatic=true;energyLevel=3;targetStyle=''
 working=false;notice='选择音乐后开始播放，系统会自动准备下一首';error=''
 result:Prepared|null=null;method:Method='original'
 recommendation:Record<string,unknown>|null=null
 phase='idle'
 private refreshTask:Promise<void>|null=null
 private activity:ActivitySession|null=null
 private automaticSet=false
 private autoSetSequence=0
 private pendingAutoSet:ActivitySession|null=null
 private autoManifest:unknown=null
 private autoName=''
 private autoDownloading=false
 private autoPreparation:{state:string;message:string}|null=null
 private cloudPreparing=false
 setAutoPreparationPending(pending:boolean){
  if(pending===this.cloudPreparing)return
  this.cloudPreparing=pending
  if(pending&&!this.player?.transition&&!this.player?.continuation){this.resetWarm();this.invalidate(false)}
  this.update()
 }
 private sessionSequence=0;private cacheSequence=0
 private setCacheController:AbortController|null=null
 private setCache:SetCacheProgress|null=null
 private cachePackId:string|null=null
 private pair:{a:Track;b:Track}|null=null
 private revision=0;private request:AbortController|null=null;private alive=true;private lastCurrent:string|null=null
 private explicit:string|null=null;private recent:string[]=[];private excludedPlans=new Set<string>()
 private excludedTracks=new Set<string>()
 private warmController:AbortController|null=null;private warmKey='';private warmRunning=false;private warmAt=0
 private preparedPool=new PreparedPool<Prepared>(3,hasDevicePCM,releaseDevicePCM)
 private resultPin:(()=>void)|null=null
 private warmPreparing:{from:string;to:string;start:number;end:number}|null=null
 private userIntent:{kind:'user-next'|'user-direction';preferred:string|null}|null=null
 private nearbyTask:Promise<void>|null=null
 private nativeRetryAt=0;private retryAt=0;private autoTask:Promise<void>|null=null;private lastResult:Prepared|null=null
 private history:Record<string,unknown>[]=[]
 private selection:{available:number;styleCandidates:number;tempoCandidates:number;recentCandidates:number;checked:number;metadataFailed:number;qualified:number;stage:string|null;usedRecent:boolean}|null=null
 constructor(readonly index:LibraryIndex,readonly base:URL,private changed:()=>void,private host?:Host,
  private create=(base:URL,changed:()=>void)=>new MetricTransport(base,changed),private read=readMetricJson,private renderOriginal=localOriginal){
  this.library=new TrackLibrary(index.tracks,base,(path,base)=>this.read(path,base))
 }
 private update(){
  const current=this.player?.current
  if(current&&current.id!==this.lastCurrent){
   if(this.lastCurrent){
    this.resetWarm(true)
    this.resultPin?.();this.resultPin=null
    this.revision++;this.request?.abort();this.request=null;this.working=false
    this.userIntent=null;this.lastResult=this.result;this.result=null;this.pair=null;this.recommendation=null;this.phase='idle'
    this.selection=null;this.selected=null;this.explicit=null;this.notice='已进入 '+current.title+'，继续按你的方向推荐'
   }
   this.lastCurrent=current.id;this.recent.push(current.id);this.recent=this.recent.slice(-8)
   if(this.selected===current.id){this.selected=null;this.explicit=null}
   this.retryAt=0;this.excludedPlans.clear();this.excludedTracks.clear()
  }
  if(this.alive)this.changed()
 }
 private invalidate(clear=true){
  this.revision++;this.request?.abort();this.request=null;this.working=false;this.error=''
  // A manual request can still adopt its previously prepared cue. Keep that
  // PCM pinned until a replacement is adopted or a hard playback reset occurs.
  if(clear){this.result=null;this.pair=null;this.recommendation=null;this.selection=null;this.phase='idle'}
  this.update()
 }
 private resetWarm(clear=false){this.warmController?.abort();this.warmController=null;this.warmKey='';this.warmRunning=false;this.warmPreparing=null;this.warmAt=0;if(clear){this.resultPin?.();this.resultPin=null;this.preparedPool.clear()}}
 private deviceResult(p:MetricTransport,a:Track,b:Track,plan:Plan,signal:AbortSignal,background=false){
  // Profiles are validated by hasDevicePCM, including profiles first fetched
  // during this operation. Keep the lookup stable across that initial fetch.
  const w=plan.window,asset=plan.asset
  // A reservation trims variants belonging to unrelated sets. Their presence
  // cannot change the identity of this exact A/B source interval.
  const key=JSON.stringify([a.id,a.provenance,b.id,b.provenance,plan.id,plan.start,plan.end,plan.duration,[w.id,w.start,w.end,w.bars],asset?[asset.url,asset.sha256,asset.bytes,asset.duration,asset.rate]:null,plan.rate,plan.v30Eq,p.ctx.sampleRate])
  const hit=this.preparedPool.entries().some(e=>e.key===key)
  if(hit)p.logs?.push({kind:'device_prepared_reused',from:a.id,to:b.id,start:plan.start,sourcePosition:p.position})
  // Subscribe before releasing background work: an exact shared preparation
  // survives, while an unrelated cold job yields its CPU/network budget.
  const operation=this.preparedPool.get(key,inner=>prepareDevice(p,a,b,plan,this.base,inner),signal)
  if(!background&&this.warmRunning)this.resetWarm()
  return operation
 }
 private async ensure(wake=true){
  if(this.host&&!this.host.requestFocus())throw Error('请回到前台后再播放')
  if(!this.player){this.player=this.create(this.base,()=>this.update());this.player.setVolume(this.volume)}
  if(wake)await initializeFromGesture(this.player)
  else await this.player.initialize()
  return this.player
 }
 /** Append published imports without replacing a playing source or its committed clock. */
 refreshLibrary(){
  if(this.refreshTask)return this.refreshTask
  const task=(async()=>{
   const fresh=readLibraryIndex(await this.read('/listen/library.json',this.base))
   if(!this.alive)return
   const ids=new Set(this.index.tracks.map(t=>t.id))
   for(const entry of fresh.tracks)if(!ids.has(entry.id)){this.index.tracks.push(entry);ids.add(entry.id)}
   this.update()
  })().finally(()=>{if(this.refreshTask===task)this.refreshTask=null})
  this.refreshTask=task;return task
 }
 async setSession(manifest:unknown,name:string){
  this.cancelAutoSet();this.automaticSet=false
  const sequence=++this.sessionSequence
  const activity=await ActivitySession.open(manifest,name,id=>this.library.load(id))
  await activity.cacheStrategies?.(this.base)
  if(!this.alive||sequence!==this.sessionSequence)throw new DOMException('预约载入已取消','AbortError')
  if(this.player?.transition||this.player?.continuation)throw Error('请先完成交接或停止，再进入预约')
  this.stop();this.library.trim(new Set([activity.initialTrackId]),4);this.activity=activity;this.selected=this.explicit=null;this.recent=[];this.error='';this.notice='预约 set 已载入，可以开始播放';this.update()
 }
 clearSet(){this.sessionSequence++;if(this.player?.transition||this.player?.continuation)throw Error('交接完成后可退出预约');this.cancelAutoSet();this.resetWarm(true);this.invalidate();this.activity=null;this.notice='已回到完整曲库';this.update()}
 get autoPreparationStatus(){return this.autoPreparation}
 /** Prepare in the background, then adopt between committed handoffs. Never
  * restart the current song or turn a partial download into ready. */
 async prepareAutoSet(manifest:unknown,name:string){
  if(this.activity&&!this.automaticSet)throw Error('正在播放已选舞程，退出后可自动准备新的方向')
  const sequence=++this.autoSetSequence
  this.autoManifest=manifest;this.autoName=name;this.pendingAutoSet=null;this.autoDownloading=true
  this.autoPreparation={state:'downloading',message:'正在自动下载并校验分轨，当前歌曲继续播放'};this.update()
  try{
   const cache=await this.cacheSet(manifest)
   if(!this.alive||sequence!==this.autoSetSequence)return
   if(cache.state!=='ready')throw Error('分轨只下载了部分，可重试继续准备；当前歌曲继续播放')
   const session=await ActivitySession.open(manifest,name,id=>this.library.load(id))
   if(!this.alive||sequence!==this.autoSetSequence)return
   this.pendingAutoSet=session;this.autoPreparation={state:'waiting',message:'分轨已下载，当前交接后启用'}
   this.player?.logs.push({kind:'automatic_set_downloaded',at:new Date().toISOString(),packId:session.packId,tracks:[...session.ids],files:cache.completed,bytes:cache.bytes})
  }catch(e){if(this.alive&&sequence===this.autoSetSequence)this.autoPreparation={state:'partial',message:(e as Error).name==='AbortError'?'下载已暂停，继续播放时自动接着准备':(e as Error).message}}
  finally{if(sequence===this.autoSetSequence){this.autoDownloading=false;this.update()}}
 }
 private cancelAutoSet(){
  this.autoSetSequence++;this.pendingAutoSet=null;this.autoManifest=null;this.cloudPreparing=false
  if(this.autoDownloading)this.setCacheController?.abort()
  this.autoDownloading=false;this.autoPreparation=null
  if(this.automaticSet){this.activity=null;this.automaticSet=false}
 }
 async cacheSet(manifest:unknown){
  const sequence=++this.cacheSequence;this.setCacheController?.abort();const controller=this.setCacheController=new AbortController()
  if(this.setCache?.state==='downloading'){this.setCache={...this.setCache,state:'partial',message:'上一次下载已暂停'};this.update()}
  let session:ActivitySession
  try{session=await ActivitySession.open(manifest,'',id=>this.library.load(id))}catch(e){if(this.setCacheController===controller)this.setCacheController=null;throw e}
  if(!this.alive||sequence!==this.cacheSequence||controller.signal.aborted)throw new DOMException('素材下载已取消','AbortError')
  this.library.trim(new Set([this.player?.current?.id??'']),4);this.cachePackId=session.packId
  this.setCache={completed:0,total:session.assets().length,bytes:0,state:'downloading',message:'正在下载到本机'};this.update()
  try{await session.cacheMetadata(this.base,controller.signal);return await cacheActivityAssets(session.assets(),this.base,controller.signal,progress=>{if(this.setCacheController===controller){this.setCache=progress;this.update()}})}catch(e){if(this.setCacheController===controller&&this.setCache){this.setCache={...this.setCache,state:'partial',message:controller.signal.aborted?'下载已暂停，可再次准备':(e as Error).message};this.update()}throw e}finally{if(this.setCacheController===controller)this.setCacheController=null}
 }
 async start(id:string){
  if(this.activity&&!this.automaticSet&&!this.activity.ids.has(id))throw Error('这首歌不在预约 set 中，请先退出预约')
  this.resetWarm(true);this.userIntent=null
  if(this.player?.transition||this.player?.continuation)throw Error('请先完成交接或停止，再更换当前歌曲')
  this.invalidate();const token=this.revision;this.working=true;this.update()
  try{
   const p=await this.ensure(),track=await this.library.load(id)
   if(!this.alive||token!==this.revision)return
   await p.start(track)
   if(!this.alive||token!==this.revision)return
   this.library.trim(new Set([id,this.selected??'']),10);this.retryAt=0
   this.notice=this.automatic?'正在播放，系统将自动推荐并准备下一首':'正在播放，自动接歌已关闭'
  }finally{if(token===this.revision){this.working=false;this.update()}}
 }
 choose(id:string){
  if(this.activity&&!this.automaticSet&&!this.activity.ids.has(id))throw Error('这首歌不在预约 set 中，请先退出预约')
  if(this.player?.transition||this.player?.continuation)throw Error('正在交接；完成后可以选择下一首')
  if(!this.index.tracks.some(t=>t.id===id&&t.playStatus==='ready'&&t.mixStatus==='ready'))throw Error('这首歌尚未具备智能混音条件')
  if(id===this.player?.current?.id)throw Error('请选择不同的下一首')
  this.resetWarm(true);this.invalidate();this.selected=this.explicit=id;this.retryAt=0;this.excludedPlans.clear();this.excludedTracks.clear()
  this.notice='已指定下一首，系统会自动寻找合适接点';this.update()
 }
 private playbackEntries(){return this.activity?this.index.tracks.filter(t=>this.activity!.ids.has(t.id)||this.automaticSet&&t.id===this.explicit):this.index.tracks}
 direction(value:{style?:string;energy?:number;automatic?:boolean}){
  const changed=(value.style!==undefined&&value.style!==this.targetStyle)||(value.energy!==undefined&&value.energy!==this.energyLevel)
  if(value.energy!==undefined&&(!Number.isInteger(value.energy)||value.energy<1||value.energy>5))throw Error('能量档位无效')
  if(value.style!==undefined&&value.style!==''&&!this.index.tracks.some(t=>t.styleLabels.some(s=>s.toLocaleLowerCase().replace(/[\s_-]/g,'')===value.style!.toLocaleLowerCase().replace(/[\s_-]/g,''))))throw Error('当前曲库还没有这个风格')
  if(value.style!==undefined)this.targetStyle=value.style
  if(value.energy!==undefined)this.energyLevel=value.energy
  if(value.automatic!==undefined)this.automatic=value.automatic
  if(changed||value.automatic===false)this.cancelAutoSet()
  // Once scheduled, the shared clock finishes that handoff. New preferences
  // apply to the following song; never stop A or partially replace automation.
  if(this.player?.transition||this.player?.continuation){this.notice='当前交接完成后采用新的音乐方向';this.update();return}
  const enabled=this.automatic
  this.invalidate(value.automatic===false?false:true)
  if(changed){this.resetWarm(true);this.explicit=null;this.selected=null;this.userIntent=this.player?.current?{kind:'user-direction',preferred:null}:null}
  else if(value.automatic===false)this.userIntent=null
  this.retryAt=0;this.excludedPlans.clear();this.excludedTracks.clear()
  this.notice=enabled?'方向已更新，正在自动寻找下一首':'自动接歌已关闭，当前歌曲继续播放'
  this.update()
 }
 private async cloud(a:Track,b:Track,plan:Plan,signal:AbortSignal,pollMs=2000){
  if(this.player?.localExecution)return this.deviceResult(this.player,a,b,plan,signal)
  const payload={from:a.id,to:b.id,windowId:plan.window.id,start:plan.start}
  const started=Date.now(),event=(kind:string,data:Record<string,unknown>)=>this.player?.logs?.push({kind,at:new Date().toISOString(),...payload,elapsedMs:Date.now()-started,...data})
  event('metric_cloud_requested',{})
  let job:any
  if(this.host?.requestMetric)job=await nativeMetricJob(this.host,payload,signal)
  else if(this.host?.prepareMetric){const response=JSON.parse(this.host.prepareMetric(JSON.stringify(payload)));if(!response.ok)throw Error(response.error||'云端准备失败');job=response.data}
  else job=await requestJson(new URL('/listen/smart-api/jobs',this.base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},signal)
  if(!hash.test(job?.id))throw Error('云端任务编号无效')
  event('metric_cloud_ack',{jobId:job.id,status:job.status??'unknown',cached:job.cached===true})
  let previousStatus=''
  for(let i=0;i<180;i++){
   signal.throwIfAborted()
   const data=await this.read('/listen/smart-api/jobs/'+job.id,this.base,signal)
   signal.throwIfAborted()
   if(data.status!==previousStatus){event('metric_cloud_state',{jobId:job.id,status:data.status});previousStatus=data.status}
   if(data.status==='failed')throw Error(data.message||'本次准备未完成')
   if(data.status==='ready'){
    if(data.id!==job.id)throw Error('交接任务身份不一致')
    const result=validatePrepared(data,a,b,plan.start,plan.window.id)
    event('metric_cloud_ready',{jobId:job.id,method:result.decision.recommended});return result
   }
   this.notice=data.message||'云端正在准备转场，当前歌曲继续播放';this.update()
   await delay(signal,pollMs)
  }
  throw Error('云端准备超时，请稍后重试')
 }
 /** One bounded cloud attempt per explicit action. Retries retain the same
  * local fallback and cannot fill the remote queue with expired cues. */
 private livePreparation(p:MetricTransport,a:Track,b:Track,budget={attempted:false}){
  if(p.localExecution)return (plan:Plan,signal:AbortSignal)=>this.deviceResult(p,a,b,plan,signal)
  return (plan:Plan,signal:AbortSignal)=>{
   const saved=this.activity?.find(a,b,plan)
   if(saved)return nearbyResult({plan,position:()=>p.position,signal,cloud:async()=>saved,original:local=>this.renderOriginal(p,a,b,plan,local),load:(r,remote)=>Promise.all([p.cache.load(r.assets[r.decision.recommended]!,remote),p.cache.load(nativeSegment(b,r.plan.bEnd).asset,remote)]),event:(kind,data)=>p.logs.push({kind,at:new Date().toISOString(),packId:this.activity?.packId,...data})})
   if(budget.attempted)return this.renderOriginal(p,a,b,plan,signal)
   return nearbyResult({plan,position:()=>p.position,signal,
    cloud:remote=>{budget.attempted=true;return this.cloud(a,b,plan,remote,250)},original:local=>this.renderOriginal(p,a,b,plan,local),
    load:(r,remote)=>Promise.all([p.cache.load(r.assets[r.decision.recommended]!,remote),p.cache.load(nativeSegment(b,r.plan.bEnd).asset,remote)]),
    event:(kind,data)=>p.logs.push({kind,at:new Date().toISOString(),from:a.id,to:b.id,start:plan.start,sourcePosition:p.position,...data})})
  }
 }
 /** Reserve local preparation time at an already selected automatic cue. */
 private async automaticResult(p:MetricTransport,a:Track,b:Track,plan:Plan,signal:AbortSignal){
  if(p.localExecution)return this.deviceResult(p,a,b,plan,signal)
  const saved=this.activity?.find(a,b,plan);if(saved){p.logs.push({kind:'activity_prepared_reused',packId:this.activity?.packId,jobId:saved.id,at:new Date().toISOString()});return saved}
  const cloud=new AbortController(),cancel=()=>cloud.abort(signal.reason)
  let budgetExpired=false
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()
  const timer=setInterval(()=>{
   if(plan.start-p.position<=12){budgetExpired=true;cloud.abort(Error('分轨尚未就绪，改用同接点原渐混'))}
  },250)
  try{return await abortable(this.cloud(a,b,plan,cloud.signal),cloud.signal)}
  catch(error){
   signal.throwIfAborted()
   if(!budgetExpired||!canArm(plan,p.current?.id??null,p.position))throw error
   this.notice='分轨未及时就绪，正在为原定接点准备原渐混';this.update()
   this.history.push({kind:'automatic_original_fallback',at:new Date().toISOString(),from:a.id,to:b.id,start:plan.start,sourcePosition:p.position,reason:'cloud_preparation_budget'})
   this.history=this.history.slice(-12)
   return await this.renderOriginal(p,a,b,plan,signal)
  }finally{clearInterval(timer);signal.removeEventListener('abort',cancel);cloud.abort()}
 }
 private adopt(result:Prepared,a:Track,b:Track,origin='manual'){
  this.resultPin?.();this.resultPin=hasDevicePCM(result)?pinDevicePCM(result):null
  this.result=result;this.pair={a,b};this.method=result.decision.recommended
  this.history.push({at:new Date().toISOString(),kind:'prepared',origin,policy:SMART_POLICY,style:this.targetStyle,energy:this.energyLevel,recommendation:this.recommendation,result})
  this.history=this.history.slice(-12)
 }
 async prepare(){
  const p=this.player,id=this.selected
  if(!p?.current||!id||id===p.current.id||p.transition||p.continuation||p.busy)throw Error('先播放当前歌曲并选择不同的下一首')
  this.invalidate();const token=this.revision,controller=this.request=new AbortController(),a=p.current
  this.working=true;this.notice='正在读取下一首的分析资料';this.update()
  try{
   const b=await this.library.load(id);if(!this.alive||token!==this.revision)return
   this.library.trim(new Set([a.id,b.id]),10)
   const plan=planContinuous(a,[b],p.position+25,{kind:'next',targetId:b.id},new Set(),60,false).best
   if(!plan)throw Error('附近没有通过拍点、人声和速度检查的接点，请换歌或调整位置')
   if(Math.abs(plan.rate-1)>.05)throw Error('这组需要超过 5% 的变速，请换一首速度更接近的歌')
   this.notice=p.localExecution?'正在缓存同源素材并安排本机声部控制':'云端正在准备转场，当前歌曲继续播放';this.update()
   const result=await this.cloud(a,b,plan,controller.signal)
   if(!this.alive||token!==this.revision)return
   this.adopt(result,a,b);this.phase='ready'
   this.notice=canArm(result.plan,p.current?.id??null,p.position)?'交接已就绪':'接点已过，可以试听或重新推荐'
  }catch(e){if(token===this.revision&&(e as Error).name!=='AbortError')this.error=(e as Error).message}
  finally{if(token===this.revision){this.working=false;this.update()}}
 }
 private async recommend(intent?:{kind:'user-next'|'user-direction';preferred:string|null}){
  const p=this.player,a=p?.current,entry=this.index.tracks.find(t=>t.id===a?.id)
  if(!p||!a||!entry)return
  const ready=this.result?{result:this.result,method:this.method}:undefined
  this.invalidate();const token=this.revision,controller=this.request=new AbortController()
  const valid=()=>this.alive&&token===this.revision&&p.current?.id===a.id
  this.working=true;this.phase='selecting';this.notice='正在按风格、能量和接点比较下一首';this.update()
  try{
   const search=candidateStages(this.playbackEntries(),entry,this.targetStyle,this.recent,this.excludedTracks,intent?null:this.explicit,intent?.preferred)
   const selection:NonNullable<MetricRun['selection']>={...search.counts,checked:0,metadataFailed:0,qualified:0,stage:null,usedRecent:false}
   this.selection=selection
   if(entry.mixStatus!=='ready')throw Error('当前歌曲的混音资料尚未发布，播完后将按方向续播原曲')
   if(!search.stages.length)throw Error(`当前风格有 ${selection.styleCandidates} 首候选，速度相容 ${selection.tempoCandidates} 首；请换个方向或补充这个速度区间的音乐`)
   const energy=this.energyLevel
   let choices:SmartChoice[]=[]
   for(const stage of search.stages){
    selection.stage=stage.kind
    this.notice=stage.kind==='recent'?'未播候选暂不合适，正在回查已播歌曲':'正在逐首比较候选的合格接点';this.update()
    const qualified=new Set<string>()
    const compare=(x:SmartChoice,y:SmartChoice)=>(stage.kind==='recent'?this.recent.lastIndexOf(x.track.id)-this.recent.lastIndexOf(y.track.id):0)||
     (intent?(x.nearbyBudget??60)-(y.nearbyBudget??60)||y.score-x.score||x.plan.start-y.plan.start:y.score-x.score||y.plan.end-x.plan.end)||x.plan.id.localeCompare(y.plan.id)
    // Use the prepared, source-verified cloud candidates in automatic mode.
    // Ranking an unrelated fresh cue would throw away all precomputed approvals.
    if(!intent){
     const allowed=new Set(stage.entries.map(t=>t.id))
     choices=(this.activity?.approvedCandidates?.(a,p.position+12,energy)??[])
      .filter(c=>allowed.has(c.track.id)&&!this.excludedPlans.has(c.plan.id))
      .map(c=>choiceForPlan(a,c.track,c.plan,energy)).filter((c):c is SmartChoice=>!!c)
      .sort((x,y)=>x.plan.start-y.plan.start||compare(x,y)).slice(0,3)
     if(choices.length){selection.checked=choices.length;selection.qualified=choices.length;break}
    }
    // Rank and release each eight-track batch. Keep only the three render
    // attempts, rather than holding every track's full analysis in memory.
    for(let batch=0;batch<stage.entries.length;batch+=8){
     const loaded:Track[]=[]
     for(let i=batch;i<Math.min(batch+8,stage.entries.length);i+=2){
      const group=await abortable(Promise.allSettled(stage.entries.slice(i,Math.min(i+2,batch+8,stage.entries.length)).map(t=>this.library.load(t.id).finally(()=>{if(!valid())this.library.trim(new Set([p.current?.id??'',this.selected??'']),10)}))),controller.signal)
      if(!valid())return
      selection.checked+=group.length
      for(const r of group)if(r.status==='fulfilled')loaded.push(r.value);else selection.metadataFailed++
     }
     if(!valid())return
     const ranked=intent?rankNearbyChoices(a,loaded,p.position,energy):rankContinuousChoices(a,loaded,p.position,energy,p.cache.ready)
     const eligible=ranked.choices.filter(c=>!this.excludedPlans.has(c.plan.id))
     for(const c of eligible)qualified.add(c.track.id)
     choices=[...choices,...eligible].sort(compare).slice(0,3)
     selection.qualified=qualified.size
     this.library.trim(new Set([a.id,...choices.map(c=>c.track.id)]),10)
     if(batch+8<stage.entries.length)await delay(controller.signal,0)
     if(!valid())return
    }
    if(choices.length)break
   }
   if(!valid())return
   if(!choices.length)throw Error(`已检查 ${selection.checked} 首，暂时没有通过接点与响度连续性检查的歌曲${selection.metadataFailed?`（${selection.metadataFailed} 首分析资料读取失败）`:''}；当前音乐继续播放`)
   let lastError='',expired=false
   const liveBudget={attempted:false}
   for(const choice of choices.slice(0,3)){
    if(!valid())return
    if(!intent&&choice.plan.start<p.position+12){
     this.excludedPlans.add(choice.plan.id);expired=true;lastError='准备期间接点已过，将重新寻找后续可用窗口';continue
    }
    const b=choice.track
    const describe=(chosen:SmartChoice)=>{
    selection.usedRecent=this.recent.includes(chosen.track.id)
    this.selected=chosen.track.id;this.phase='preparing'
    this.recommendation={id:chosen.track.id,title:chosen.track.title,style:this.targetStyle,energyLevel:this.energyLevel,reason:chosen.reason,styleLabels:this.index.tracks.find(t=>t.id===chosen.track.id)?.styleLabels??[],selection:{...selection},energy:chosen.energy,score:chosen.score,qualityScore:chosen.plan.score,energyPenalty:chosen.plan.score-chosen.score,policy:SMART_POLICY,qualityPolicy:intent?NEARBY_DIRECTION_POLICY:'continuous-auto-quality-v1',
     cue:{start:chosen.plan.start,end:chosen.plan.end,bStart:chosen.plan.window.start,bEnd:chosen.plan.window.end,bars:chosen.plan.window.bars},
     alternatives:choices.slice(0,3).map(c=>({id:c.track.id,title:c.track.title,start:c.plan.start,windowId:c.plan.window.id,score:c.score}))}
    }
    describe(choice)
    this.notice='为 '+b.title+' 缓存同源素材并准备本机交接';this.update()
    // A cloud queue/read or audio download must not keep an obsolete cue in
    // charge. This stops local waiting; the server has no job-cancel endpoint.
    const candidate=new AbortController()
    const cancel=()=>candidate.abort(controller.signal.reason)
    controller.signal.addEventListener('abort',cancel,{once:true})
    if(controller.signal.aborted)cancel()
    const deadline=intent?undefined:setInterval(()=>{if(!canArm(choice.plan,p.current?.id??null,p.position))candidate.abort(expiredCue())},250)
    try{
     if(intent){
      const outcome=await mixNearby({player:p,a,b,signal:candidate.signal,ready,material:choice.plan,
       preload:(plan,signal)=>(p.localExecution?preloadDevice(p,a,b,plan,signal):preloadOriginal(p,a,b,plan,signal)),
       acceptPlan:plan=>!!choiceForPlan(a,b,plan,energy),
       scorePlan:plan=>choiceForPlan(a,b,plan,energy)?.score??-Infinity,
       onCandidate:plan=>{if(valid()){const actual=choiceForPlan(a,b,plan,energy);if(actual)describe(actual)}},
       prepare:this.livePreparation(p,a,b,liveBudget),
       onStatus:message=>{if(valid()){this.notice=message;this.update()}}})
      if(!valid())return
      this.adopt(outcome.result,a,b,intent.kind);this.method=outcome.method;this.phase='armed';this.notice='已按当前音乐方向安排最近合格接点'
      this.history.push({kind:'handoff_requested',origin:intent.kind,jobId:outcome.result.id,method:outcome.method,sourcePosition:p.position,at:new Date().toISOString()});this.history=this.history.slice(-12)
      this.library.trim(new Set([a.id,b.id]),10);this.retryAt=0;return
     }
     const result=await abortable(this.automaticResult(p,a,b,choice.plan,candidate.signal),candidate.signal)
     if(!valid())return
     if(!canArm(result.plan,p.current?.id??null,p.position))throw expiredCue()
     const method=result.decision.recommended
     await abortable(loadPrepared(p,result,b,candidate.signal),candidate.signal)
     if(!valid())return
     if(!canArm(result.plan,p.current?.id??null,p.position))throw expiredCue()
     this.adopt(result,a,b,'automatic');this.phase='ready';this.notice='下一首已就绪，将在合适的小节自动接入'
     this.library.trim(new Set([a.id,b.id]),10);this.retryAt=0;return
    }catch(e){
     if(!valid()||controller.signal.aborted)return
     this.excludedPlans.add(choice.plan.id);lastError=(e as Error).message
     this.history.push({at:new Date().toISOString(),kind:'candidate_failed',planId:choice.plan.id,reason:lastError})
     this.history=this.history.slice(-12)
     if(isExpiredCue(e)){expired=true;break}
    }finally{clearInterval(deadline);controller.signal.removeEventListener('abort',cancel);candidate.abort()}
   }
   if(expired)throw expiredCue()
   throw Error(lastError||'本轮转场尚未准备成功，当前音乐继续播放')
  }catch(e){if(valid()&&(e as Error).name!=='AbortError'){this.phase='no_match';this.error=(e as Error).message;p.logs.push({kind:'automatic_no_match',at:new Date().toISOString(),track:a.id,sourcePosition:p.position,duration:a.duration,selection:{...this.selection},reason:this.error});this.recommendation=null;this.selected=null;this.retryAt=Date.now()+(isExpiredCue(e)?1000:30000)}}
  finally{this.library.trim(new Set([p.current?.id??'',this.selected??'']),10);if(token===this.revision){this.working=false;this.update()}}
 }
 /** Roll a small device-ready horizon. This timer only prepares immutable
  * plans; the common audio clock still schedules every accepted handoff. */
 private warmNearby(){
  if((this.cloudPreparing||this.autoDownloading)&&!this.automaticSet)return
  const p=this.player,a=p?.current
  const key=this.alive&&p?.playing&&this.index.tracks.find(t=>t.id===a?.id)?.mixStatus==='ready'&&!p.continuation&&!p.paused&&!p.busy&&!p.transition&&a?[a.id,this.targetStyle,this.energyLevel,this.explicit??'',this.activity?.packId??''].join(':'):''
  if(key!==this.warmKey){this.resetWarm();this.warmKey=key}
  if(!key||!p||!a||this.working||this.warmRunning||Date.now()<this.warmAt)return
  this.preparedPool.prune(r=>r.plan.from===a.id&&canArm(r.plan,a.id,p.position))
  const controller=this.warmController=new AbortController();this.warmRunning=true
  void (async()=>{
   if(!p.localExecution){const id=this.selected;if(!id)return;const b=await abortable(this.library.load(id),controller.signal),plan=nearbyPlan(a,b,p.position);if(plan)await preloadOriginal(p,a,b,plan,controller.signal);return}
   const entry=this.index.tracks.find(t=>t.id===a.id);if(!entry)return
   const search=candidateStages(this.playbackEntries(),entry,this.targetStyle,this.recent,this.excludedTracks,this.explicit,this.selected)
   const allowed=new Set(search.stages.flatMap(s=>s.entries.map(t=>t.id)))
   const session=this.activity as (ActivitySession&{candidates?:(a:Track,position:number,energy:number)=>{track:Track;plan:Plan}[]})|null
   const tracks:Track[]=[]
   // Use every retained reservation track when selecting the live nearest
   // material. Sparse cloud coverage is useful backup evidence, but cannot
   // substitute its sampled point for the point a click would choose now.
   const retained=session?.ids.has(a.id)?session.tracks?.filter(t=>allowed.has(t.id)&&Array.isArray(t.windows))??[]:[]
   if(retained.length)tracks.push(...retained)
   else for(const id of [...allowed].slice(0,8)){controller.signal.throwIfAborted();try{tracks.push(await abortable(this.library.load(id),controller.signal))}catch(error){controller.signal.throwIfAborted()}}
   let primary:{track:Track;plan:Plan}[]=[]
   for(const stage of search.stages){const ids=new Set(stage.entries.map(t=>t.id)),ranked=rankNearbyChoices(a,tracks.filter(t=>ids.has(t.id)),p.position,this.energyLevel);primary=ranked.choices.filter(c=>!this.excludedPlans.has(c.plan.id));if(primary.length)break}
   // A tap is delivered after preparation has begun, often after the first
   // cue has passed. Reserve the second slot for that same target's next
   // formal live choice, using the unchanged selector at a future position.
   // Cache availability never changes the actual click-time selection.
   const first=primary[0],successor=first?rankNearbyChoices(a,[first.track],first.plan.start+.001,this.energyLevel).best:null
   const next=successor&&!this.excludedPlans.has(successor.plan.id)?[successor]:[]
   const backups=session?.candidates?.(a,p.position,this.energyLevel).filter(c=>allowed.has(c.track.id)&&!this.excludedPlans.has(c.plan.id))??[]
   const eligible=(c:{track:Track;plan:Plan})=>allowed.has(c.track.id)&&!this.excludedPlans.has(c.plan.id)&&c.plan.start>p.position+1.5&&!!choiceForPlan(a,c.track,c.plan,this.energyLevel)
   // Precomputed approvals otherwise sit behind a cold live request. Prepare
   // one usable reservation point first, retaining the unchanged nearest and
   // adjacent live choices for a tap. This order affects preparation only.
   const approved=session?.approvedCandidates?.(a,p.position,this.energyLevel).filter(eligible).slice(0,1)??[]
   // A selected/committed PCM owns one of the existing three device slots.
   // The device cache still enforces its independent 96 MiB hard budget.
   const limit=Math.min(approved.length?3:2,this.resultPin?2:3)
   const candidates=[...new Map([...approved,...(first?[first]:[]),...next,...primary.slice(1),...backups].filter(eligible).map(c=>[c.plan.id,c])).values()].slice(0,limit)
   for(const {track:b,plan} of candidates){
    controller.signal.throwIfAborted();if(p.current?.id!==a.id||!canArm(plan,a.id,p.position))continue
    this.warmPreparing={from:a.id,to:b.id,start:plan.start,end:plan.end};this.update()
    try{const result=await this.deviceResult(p,a,b,plan,controller.signal,true);if(canArm(result.plan,a.id,p.position))p.logs.push({kind:'device_rolling_ready',from:a.id,to:b.id,start:plan.start,method:result.decision.recommended,sourcePosition:p.position,renderRequested:false})}
    catch(error){controller.signal.throwIfAborted();p.logs.push({kind:'device_rolling_unavailable',to:b.id,start:plan.start,reason:(error as Error).message})}
   }
  })().catch(e=>{if(!controller.signal.aborted)p.logs.push({kind:'nearby_preload_failed',reason:(e as Error).message})})
   .finally(()=>{if(this.warmController===controller){this.warmRunning=false;this.warmPreparing=null;this.warmAt=Date.now()+2000;this.update()}})
 }
 tick(){
  const p=this.player
  if(this.pendingAutoSet&&!p?.transition&&!p?.continuation&&!p?.busy&&!this.working&&!this.autoTask&&!this.nearbyTask){
   this.resetWarm(true);this.invalidate();this.activity=this.pendingAutoSet;this.pendingAutoSet=null;this.automaticSet=true
   this.autoPreparation={state:'ready',message:`分轨已下载 · ${this.activity.ids.size} 首音乐自动接续`}
   p?.logs.push({kind:'automatic_set_attached',at:new Date().toISOString(),packId:this.activity.packId,current:p.current?.id,position:p.position})
   this.update()
  }
  if(this.automatic&&p?.playing&&!p.paused&&!p.transition&&!p.continuation&&!this.working&&!this.autoTask&&!this.nearbyTask&&['no_match','waiting_assets'].includes(this.phase)&&p.current&&p.current.duration-p.position<=30&&Date.now()>=this.nativeRetryAt){
   const task=this.queueNativeContinuation().finally(()=>{if(this.autoTask===task)this.autoTask=null});this.autoTask=task;return
  }
  if(p?.continuation)return
  this.warmNearby()
  if(!this.alive||!p?.playing||p.continuation||p.paused||p.busy||p.buffering||p.transition||this.working||this.autoTask||this.nearbyTask)return
  if((this.cloudPreparing||this.autoDownloading)&&!this.automaticSet&&!this.result){this.phase='waiting_assets';this.notice='后台正在准备下一组分轨，当前歌曲继续播放';return}
  if(this.userIntent){
   const intent=this.userIntent;this.userIntent=null
   const task=this.recommend(intent).finally(()=>{if(this.autoTask===task)this.autoTask=null})
   this.autoTask=task;return
  }
  if(!this.automatic)return
  if(this.result&&this.result.plan.from===p.current?.id){
   if(!canArm(this.result.plan,p.current!.id,p.position)){this.invalidate();this.retryAt=0;return}
   if(this.result.plan.start-p.position>10)return
   this.phase='scheduling';this.notice='已准备好，正在安排自动交接'
   const operation=this.apply(false,'automatic'),token=this.revision
   const task=operation.then(()=>{if(token===this.revision&&p.transition){this.phase='armed';this.notice='即将在选定小节接入下一首'}}).catch(e=>{
    if(token!==this.revision)return
    this.invalidate();this.error=(e as Error).message;this.retryAt=Date.now()+3000
   }).finally(()=>{if(this.autoTask===task)this.autoTask=null;this.update()})
   this.autoTask=task;return
  }
  if(Date.now()<this.retryAt)return
  const task=this.recommend().finally(()=>{if(this.autoTask===task)this.autoTask=null})
  this.autoTask=task
 }
 private nativeCandidates(entry:LibraryEntry){
  const rows=this.playbackEntries().filter(t=>t.id!==entry.id&&t.playStatus==='ready'&&styleMatches(t.styleLabels,this.targetStyle))
  const search=candidateStages(rows.map(t=>({...t,mixStatus:'ready' as const})),entry,this.targetStyle,this.recent,new Set(),this.explicit)
  const ordered=search.stages.flatMap(s=>s.entries)
  return [...ordered,...rows.filter(t=>!ordered.some(x=>x.id===t.id))].slice(0,3)
 }
 private async queueNativeContinuation(){
  const p=this.player,a=p?.current,entry=this.index.tracks.find(t=>t.id===a?.id);if(!p||!a||!entry)return
  this.resetWarm();this.invalidate();const token=this.revision,controller=this.request=new AbortController()
  this.working=true;this.phase='preparing';this.notice='本轮混音未就绪，正在准备原曲顺序续播';this.update()
  try{
   let last='没有可续播的同风格原曲'
   for(const row of this.nativeCandidates(entry)){
    try{const b=await abortable(this.library.load(row.id),controller.signal);if(token!==this.revision)return
     await p.queueNativeNext(b,controller.signal);this.selected=b.id;this.phase='armed';this.notice='混音资料或接点未就绪，本次按原曲顺序续播';this.error='';return
    }catch(e){controller.signal.throwIfAborted();last=(e as Error).message}
   }
   throw Error(last)
  }catch(e){if(token===this.revision&&!controller.signal.aborted){this.phase='no_match';this.error=(e as Error).message;this.nativeRetryAt=Date.now()+3000;p.logs.push({kind:'sequential_unavailable',at:new Date().toISOString(),reason:this.error,position:p.position})}}
  finally{if(token===this.revision){this.working=false;this.update()}}
 }
 mixSoon(){
  if(this.nearbyTask)return this.nearbyTask
  const task=this.performNearby().finally(()=>{if(this.nearbyTask===task){this.nearbyTask=null;this.update()}})
  this.nearbyTask=task;return task
 }
 private async performNearby(){
  const p=this.player,a=p?.current,id=this.selected
  if(!p?.playing||!a||p.transition||p.continuation||p.busy)throw Error('先播放当前歌曲，再点击最近接点切歌')
  if(!id||id===a.id)throw Error('先选择下一首，或等待推荐出现')
  const ready=this.result?{result:this.result,method:this.method}:undefined
  this.invalidate();const token=this.revision,controller=this.request=new AbortController()
  this.working=true;this.phase='preparing';this.notice='正在寻找当前位置附近的合适接点';this.update()
  try{
   const b=await abortable(this.library.load(id),controller.signal)
   if(!this.alive||token!==this.revision)return
   const outcome=await mixNearby({player:p,a,b,signal:controller.signal,ready,preload:(plan,signal)=>(p.localExecution?preloadDevice(p,a,b,plan,signal):preloadOriginal(p,a,b,plan,signal)),prepare:this.livePreparation(p,a,b),onStatus:message=>{if(this.alive&&token===this.revision){this.notice=message;this.update()}}})
   if(!this.alive||token!==this.revision)return
   this.adopt(outcome.result,a,b,'nearby');this.method=outcome.method;this.phase='armed';this.notice='已安排附近合适接点，将自动混入下一首'
   this.history.push({kind:'handoff_requested',origin:'nearby',jobId:outcome.result.id,method:outcome.method,sourcePosition:p.position,at:new Date().toISOString()});this.history=this.history.slice(-12)
  }catch(e){if(token===this.revision&&(e as Error).name!=='AbortError'){this.phase='no_match';this.error=(e as Error).message;this.retryAt=Date.now()+30000}}
  finally{if(token===this.revision){this.working=false;this.update()}}
 }
 requestNext(){
  if(this.player?.transition||this.player?.continuation)throw Error('正在交接，稍后可以继续换歌')
  const preferred=this.selected
  this.invalidate(false);this.userIntent={kind:'user-next',preferred};this.excludedPlans.clear();this.excludedTracks.clear();this.retryAt=0
  this.notice=this.player?.playing?'正在按当前方向接入下一首':'继续播放后，按当前方向接入下一首';this.update()
 }

 selectMethod(method:Method){if(this.player?.transition||this.player?.busy)throw Error('请等待本次交接完成');if(!this.result||!hasMethod(this.result,method))throw Error('该方法没有通过本轮检查');this.method=method;this.update()}
 async apply(audition=false,origin='manual'){
  if(!this.result||!this.pair||this.working||this.player?.transition||this.player?.continuation)throw Error('请先准备本次交接')
  this.request?.abort();const controller=this.request=new AbortController()
  const result=this.result,pair=this.pair,method=this.method,token=++this.revision;this.working=true;this.update()
  try{const p=await this.ensure(audition||!this.player?.paused);if(!this.alive||token!==this.revision)return;if(audition)await p.audition(result,method,pair.a,pair.b);else await p.arm(result,method,pair.b,controller.signal)
   if(p.transition?.result.id===result.id){this.history.push({kind:'handoff_requested',origin,jobId:result.id,method,sourcePosition:p.position,at:new Date().toISOString()});this.history=this.history.slice(-12)}
  }finally{if(token===this.revision){this.working=false;this.update()}}
 }
 pause(){this.resetWarm();this.userIntent=null;this.invalidate(false);this.player?.pause();this.phase=this.result?'ready':'idle';this.notice='已暂停，继续播放后按你的方向自动推荐';this.save();this.update()}
 async resume(){
  if(this.autoManifest&&!this.autoDownloading&&this.autoPreparation?.state==='partial')void this.prepareAutoSet(this.autoManifest,this.autoName)
  const p=await this.ensure(),a=p.current
  if(a&&p.position>=a.duration-.1){
   const entry=this.index.tracks.find(t=>t.id===a.id),next=this.automatic&&entry?this.nativeCandidates(entry)[0]:null
   if(this.automatic&&!next)throw Error('歌曲已结束，当前方向暂无其他可播放音乐')
   p.logs?.push({kind:'resume_ended_track',at:new Date().toISOString(),from:a.id,to:next?.id??a.id,mixed:false})
   await this.start(next?.id??a.id);return
  }
  await p.resume();this.retryAt=0
 }
 async seek(position:number){this.userIntent=null;if(this.player?.transition||this.player?.continuation)throw Error('请先完成交接或停止，再调整位置');this.resetWarm(true);this.invalidate();this.excludedPlans.clear();this.retryAt=0;const paused=this.player?.paused;await this.player?.seek(position);if(paused)this.player?.pause()}
 cancel(){this.userIntent=null;if(this.player?.transition||this.player?.continuation)throw Error('已安排交接，暂停可暂停时间轴，停止可取消');this.invalidate();this.retryAt=Date.now()+30000;this.notice='已取消这次准备，当前歌曲继续播放';this.update()}
 stop(){this.resetWarm(true);this.sessionSequence++;this.userIntent=null;this.invalidate();this.player?.stop();this.lastCurrent=null;this.retryAt=0;this.notice='已停止';this.save();this.update()}
 pauseForHost(reason='host-inactive'){this.resetWarm();this.sessionSequence++;this.cacheSequence++;this.setCacheController?.abort();this.userIntent=null;this.invalidate(false);if(this.player?.busy&&!this.player.current){this.player.stop();this.notice='已暂停准备，回到前台后重新开始'}else this.player?.pause(reason);this.save()}
 setVolume(value:number){if(!Number.isFinite(value))throw Error('音量无效');this.volume=Math.max(0,Math.min(1,value));this.player?.setVolume(this.volume);this.update()}
 filters(value:{label?:string;query?:string}){this.label=value.label??this.label;this.query=value.query??this.query;this.update()}
 export(){return {...this.player?.export(),schema:'harbeat.metric-mix-session.v1',release:METRIC_RELEASE,automaticPolicy:SMART_POLICY,direction:{style:this.targetStyle,energy:this.energyLevel,automatic:this.automatic},history:this.history,selectedResult:this.result??this.lastResult,selectedMethod:this.method,selection:this.selection,exportedAt:new Date().toISOString()}}
 save(){if(this.player)this.host?.saveSession(JSON.stringify(this.export()))}
 dispose(){this.cancelAutoSet();this.setCacheController?.abort();this.resetWarm(true);this.alive=false;this.invalidate();this.save();this.player?.dispose()}
 snapshot(){const p=this.player,r=this.result,ready=[...new Map([...this.preparedPool.entries().map(e=>e.value),...(r?[r]:[])].filter(value=>hasDevicePCM(value)&&value.plan.from===p?.current?.id&&canArm(value.plan,p.current!.id,p.position)).map(value=>[value.id,value])).values()];return {activitySet:this.activity?{packId:this.activity.packId,name:this.activity.name,trackCount:this.activity.ids.size,prepared:this.activity.strategyVersion?this.activity.strategyCount:this.activity.candidateCount??this.activity.results.length,strategyVersion:this.activity.strategyVersion,approved:this.activity.strategyCount??0,candidates:this.activity.candidateCount??this.activity.results.length,cloudCoverage:this.activity.cloudCoverage,cache:this.cachePackId===this.activity.packId?this.setCache:null}:null,cache:this.setCache?{packId:this.cachePackId,...this.setCache}:null,release:METRIC_RELEASE,selected:this.selected,label:this.label,query:this.query,volume:this.volume,working:this.working,notice:this.error||this.notice,canArm:!!r&&hasDevicePCM(r)&&canArm(r.plan,p?.current?.id??null,p?.position??0)&&!p?.transition,
  automatic:this.automatic,energyLevel:this.energyLevel,targetStyle:this.targetStyle,phase:this.phase,nearbyWorking:!!this.nearbyTask,recommendation:this.recommendation,selection:this.selection,
  warm:{state:this.warmRunning?'preparing':ready.length?'ready':'idle',preparing:this.warmPreparing,ready:ready.map(value=>({from:value.plan.from,to:value.plan.to,start:value.plan.start,end:value.plan.end,method:value.decision.recommended})),sourcePosition:p?.position??0,limit:3,...deviceBufferUsage()},
  result:r?{id:r.id,policyVersion:r.policyVersion,plan:r.plan,metrics:r.metrics,decision:r.decision,available:METHODS.filter(m=>hasMethod(r,m))}:null,method:this.method}}
}
export async function loadMetricIndex(base:URL){
 const index=readLibraryIndex(await readMetricJson('/listen/library.json',base))
 try{const execution=await readMetricJson('/listen/execution/index.json',base)
  if(execution?.schema!=='harbeat.execution-library.v1'||!Array.isArray(execution.tracks))throw Error('混音发布目录不可用')
  const published=new Set(execution.tracks.filter((t:any)=>typeof t?.trackId==='string'&&/^[a-f0-9]{64}$/.test(t?.profile?.sha256??'')).map((t:any)=>t.trackId))
  for(const row of index.tracks)if(!published.has(row.id)){row.mixStatus='unavailable';row.reason='原曲可播放，混音资料尚未发布'}
 }catch{for(const row of index.tracks){row.mixStatus='unavailable';row.reason='混音发布目录暂不可用，原曲可播放'}}
 return index
}
