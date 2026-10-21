import {TrackLibrary, readLibraryIndex, type LibraryIndex} from '../metric-upstream/continuous/catalog'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import {initializeFromGesture} from '../metric-upstream/continuous/activation'
import {MetricTransport} from '../metric-upstream/metric-mix/transport'
import {canArm} from '../metric-upstream/metric-mix/plan'
import type {Prepared, Method} from '../metric-upstream/metric-mix/types'
import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {nativeSegment} from '../metric-upstream/continuous/segments'
import {candidateStages,rankChoices,rankNearbyChoices,choiceForPlan,SMART_POLICY,NEARBY_DIRECTION_POLICY,type SmartChoice} from './smart-selection'
import type {Host} from './session'
import {mixNearby,nearbyPlan} from './nearby'
import {localOriginal,preloadOriginal} from './local-original'

const hash=/^[a-f0-9]{64}$/
export const METHODS:Method[]=['original','bass','filter','yield','vocal','bass_filter']
export const METRIC_RELEASE={id:'metric-mix-mobile-20261021',sourceCommit:'978df49191450a602f1b473b31f630a687585a8d',policyVersion:'metric-mix-v1.0'}
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
 private pair:{a:Track;b:Track}|null=null
 private revision=0;private request:AbortController|null=null;private alive=true;private lastCurrent:string|null=null
 private explicit:string|null=null;private recent:string[]=[];private excludedPlans=new Set<string>()
 private excludedTracks=new Set<string>()
 private warmController:AbortController|null=null;private warmKey='';private warmRunning=false;private warmAt=0
 private userIntent:{kind:'user-next'|'user-direction';preferred:string|null}|null=null
 private nearbyTask:Promise<void>|null=null
 private retryAt=0;private autoTask:Promise<void>|null=null;private lastResult:Prepared|null=null
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
  if(clear){this.result=null;this.pair=null;this.recommendation=null;this.selection=null;this.phase='idle'}
  this.update()
 }
 private async ensure(){
  if(this.host&&!this.host.requestFocus())throw Error('请回到前台后再播放')
  if(!this.player){this.player=this.create(this.base,()=>this.update());this.player.setVolume(this.volume)}
  await initializeFromGesture(this.player)
  return this.player
 }
 async start(id:string){
  this.userIntent=null
  if(this.player?.transition)throw Error('请先完成交接或停止，再更换当前歌曲')
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
  if(this.player?.transition)throw Error('正在交接；完成后可以选择下一首')
  if(!this.index.tracks.some(t=>t.id===id&&t.playStatus==='ready'&&t.mixStatus==='ready'))throw Error('这首歌尚未具备智能混音条件')
  if(id===this.player?.current?.id)throw Error('请选择不同的下一首')
  this.invalidate();this.selected=this.explicit=id;this.retryAt=0;this.excludedPlans.clear();this.excludedTracks.clear()
  this.notice='已指定下一首，系统会自动寻找合适接点';this.update()
 }
 direction(value:{style?:string;energy?:number;automatic?:boolean}){
  const changed=(value.style!==undefined&&value.style!==this.targetStyle)||(value.energy!==undefined&&value.energy!==this.energyLevel)
  if(value.energy!==undefined&&(!Number.isInteger(value.energy)||value.energy<1||value.energy>5))throw Error('能量档位无效')
  if(value.style!==undefined&&value.style!==''&&!this.index.tracks.some(t=>t.styleLabels.some(s=>s.toLocaleLowerCase().replace(/[\s_-]/g,'')===value.style!.toLocaleLowerCase().replace(/[\s_-]/g,''))))throw Error('当前曲库还没有这个风格')
  if(value.style!==undefined)this.targetStyle=value.style
  if(value.energy!==undefined)this.energyLevel=value.energy
  if(value.automatic!==undefined)this.automatic=value.automatic
  // Once scheduled, the shared clock finishes that handoff. New preferences
  // apply to the following song; never stop A or partially replace automation.
  if(this.player?.transition){this.notice='当前交接完成后采用新的音乐方向';this.update();return}
  const enabled=this.automatic
  this.invalidate(value.automatic===false?false:true)
  if(changed){this.explicit=null;this.selected=null;this.userIntent=this.player?.current?{kind:'user-direction',preferred:null}:null}
  else if(value.automatic===false)this.userIntent=null
  this.retryAt=0;this.excludedPlans.clear();this.excludedTracks.clear()
  this.notice=enabled?'方向已更新，正在自动寻找下一首':'自动接歌已关闭，当前歌曲继续播放'
  this.update()
 }
 private async cloud(a:Track,b:Track,plan:Plan,signal:AbortSignal){
  const payload={from:a.id,to:b.id,windowId:plan.window.id,start:plan.start}
  let job:any
  if(this.host?.requestMetric)job=await nativeMetricJob(this.host,payload,signal)
  else if(this.host?.prepareMetric){const response=JSON.parse(this.host.prepareMetric(JSON.stringify(payload)));if(!response.ok)throw Error(response.error||'云端准备失败');job=response.data}
  else job=await requestJson(new URL('/listen/smart-api/jobs',this.base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},signal)
  if(!hash.test(job?.id))throw Error('云端任务编号无效')
  for(let i=0;i<180;i++){
   signal.throwIfAborted()
   const data=await this.read('/listen/smart-api/jobs/'+job.id,this.base,signal)
   signal.throwIfAborted()
   if(data.status==='failed')throw Error(data.message||'本次准备未完成')
   if(data.status==='ready'){
    if(data.id!==job.id)throw Error('交接任务身份不一致')
    return validatePrepared(data,a,b,plan.start,plan.window.id)
   }
   this.notice=data.message||'云端正在准备转场，当前歌曲继续播放';this.update()
   await delay(signal,2000)
  }
  throw Error('云端准备超时，请稍后重试')
 }
 /** Reserve local preparation time at an already selected automatic cue. */
 private async automaticResult(p:MetricTransport,a:Track,b:Track,plan:Plan,signal:AbortSignal){
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
  this.result=result;this.pair={a,b};this.method=result.decision.recommended
  this.history.push({at:new Date().toISOString(),kind:'prepared',origin,policy:SMART_POLICY,style:this.targetStyle,energy:this.energyLevel,recommendation:this.recommendation,result})
  this.history=this.history.slice(-12)
 }
 async prepare(){
  const p=this.player,id=this.selected
  if(!p?.current||!id||id===p.current.id||p.transition||p.busy)throw Error('先播放当前歌曲并选择不同的下一首')
  this.invalidate();const token=this.revision,controller=this.request=new AbortController(),a=p.current
  this.working=true;this.notice='正在读取下一首的分析资料';this.update()
  try{
   const b=await this.library.load(id);if(!this.alive||token!==this.revision)return
   this.library.trim(new Set([a.id,b.id]),10)
   const plan=planContinuous(a,[b],p.position+25,{kind:'next',targetId:b.id},new Set(),60,false).best
   if(!plan)throw Error('附近没有通过拍点、人声和速度检查的接点，请换歌或调整位置')
   if(Math.abs(plan.rate-1)>.05)throw Error('这组需要超过 5% 的变速，请换一首速度更接近的歌')
   this.notice='云端正在准备转场，当前歌曲继续播放';this.update()
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
   const search=candidateStages(this.index.tracks,entry,this.targetStyle,this.recent,this.excludedTracks,intent?null:this.explicit,intent?.preferred)
   const selection:NonNullable<MetricRun['selection']>={...search.counts,checked:0,metadataFailed:0,qualified:0,stage:null,usedRecent:false}
   this.selection=selection
   if(!search.stages.length)throw Error(`当前风格有 ${selection.styleCandidates} 首候选，速度相容 ${selection.tempoCandidates} 首；请换个方向或补充这个速度区间的音乐`)
   const energy=this.energyLevel
   let choices:SmartChoice[]=[]
   for(const stage of search.stages){
    selection.stage=stage.kind
    this.notice=stage.kind==='recent'?'未播候选暂不合适，正在回查已播歌曲':'正在逐首比较候选的合格接点';this.update()
    const qualified=new Set<string>()
    const compare=(x:SmartChoice,y:SmartChoice)=>(stage.kind==='recent'?this.recent.lastIndexOf(x.track.id)-this.recent.lastIndexOf(y.track.id):0)||
     (intent?(x.nearbyBudget??60)-(y.nearbyBudget??60)||y.score-x.score||x.plan.start-y.plan.start:y.score-x.score||y.plan.end-x.plan.end)||x.plan.id.localeCompare(y.plan.id)
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
     const ranked=intent?rankNearbyChoices(a,loaded,p.position,energy):rankChoices(a,loaded,p.position+35,energy,p.cache.ready)
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
    this.notice='为 '+b.title+' 准备最合适的分轨转场';this.update()
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
       preload:(plan,signal)=>preloadOriginal(p,a,b,plan,signal),
       acceptPlan:plan=>!!choiceForPlan(a,b,plan,energy),
       scorePlan:plan=>choiceForPlan(a,b,plan,energy)?.score??-Infinity,
       onCandidate:plan=>{if(valid()){const actual=choiceForPlan(a,b,plan,energy);if(actual)describe(actual)}},
       prepare:(plan,signal)=>this.renderOriginal(p,a,b,plan,signal),
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
     await abortable(Promise.all([p.cache.load(result.assets[method]!,candidate.signal),p.cache.load(nativeSegment(b,result.plan.bEnd).asset,candidate.signal)]),candidate.signal)
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
  }catch(e){if(valid()&&(e as Error).name!=='AbortError'){this.phase='no_match';this.error=(e as Error).message;this.recommendation=null;this.selected=null;this.retryAt=Date.now()+(isExpiredCue(e)?1000:30000)}}
  finally{this.library.trim(new Set([p.current?.id??'',this.selected??'']),10);if(token===this.revision){this.working=false;this.update()}}
 }
 /** Called by the host's existing timer. All actual source scheduling remains
  * in the pinned AudioContext transport, never in this polling timer. */
 private warmNearby(){
  const p=this.player,a=p?.current,id=this.selected
  const key=this.alive&&p?.playing&&!p.paused&&!p.busy&&!p.transition&&a&&id&&id!==a.id?a.id+':'+id:''
  if(key!==this.warmKey){this.warmController?.abort();this.warmKey=key;this.warmRunning=false;this.warmAt=0}
  if(!key||!p||!a||!id||this.warmRunning||Date.now()<this.warmAt)return
  const controller=this.warmController=new AbortController();this.warmRunning=true
  void this.library.load(id).then(async b=>{
   controller.signal.throwIfAborted()
   const plan=nearbyPlan(a,b,p.position)
   if(plan)await preloadOriginal(p,a,b,plan,controller.signal)
  }).catch(e=>{if(!controller.signal.aborted)p.logs.push({kind:'nearby_preload_failed',reason:(e as Error).message})})
   .finally(()=>{if(this.warmController===controller){this.warmRunning=false;this.warmAt=Date.now()+2000}})
 }
 tick(){
  this.warmNearby()
  const p=this.player
  if(!this.alive||!p?.playing||p.paused||p.busy||p.buffering||p.transition||this.working||this.autoTask||this.nearbyTask)return
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
 mixSoon(){
  if(this.nearbyTask)return this.nearbyTask
  const task=this.performNearby().finally(()=>{if(this.nearbyTask===task){this.nearbyTask=null;this.update()}})
  this.nearbyTask=task;return task
 }
 private async performNearby(){
  const p=this.player,a=p?.current,id=this.selected
  if(!p?.playing||!a||p.transition||p.busy)throw Error('先播放当前歌曲，再点击最近接点切歌')
  if(!id||id===a.id)throw Error('先选择下一首，或等待推荐出现')
  const ready=this.result?{result:this.result,method:this.method}:undefined
  this.invalidate();const token=this.revision,controller=this.request=new AbortController()
  this.working=true;this.phase='preparing';this.notice='正在寻找当前位置附近的合适接点';this.update()
  try{
   const b=await abortable(this.library.load(id),controller.signal)
   if(!this.alive||token!==this.revision)return
   const outcome=await mixNearby({player:p,a,b,signal:controller.signal,ready,preload:(plan,signal)=>preloadOriginal(p,a,b,plan,signal),prepare:(plan,signal)=>this.renderOriginal(p,a,b,plan,signal),onStatus:message=>{if(this.alive&&token===this.revision){this.notice=message;this.update()}}})
   if(!this.alive||token!==this.revision)return
   this.adopt(outcome.result,a,b,'nearby');this.method=outcome.method;this.phase='armed';this.notice='已安排附近合适接点，将自动混入下一首'
   this.history.push({kind:'handoff_requested',origin:'nearby',jobId:outcome.result.id,method:outcome.method,sourcePosition:p.position,at:new Date().toISOString()});this.history=this.history.slice(-12)
  }catch(e){if(token===this.revision&&(e as Error).name!=='AbortError'){this.phase='no_match';this.error=(e as Error).message;this.retryAt=Date.now()+30000}}
  finally{if(token===this.revision){this.working=false;this.update()}}
 }
 requestNext(){
  if(this.player?.transition)throw Error('正在交接，稍后可以继续换歌')
  const preferred=this.selected
  this.invalidate(false);this.userIntent={kind:'user-next',preferred};this.excludedPlans.clear();this.excludedTracks.clear();this.retryAt=0
  this.notice=this.player?.playing?'正在按当前方向接入下一首':'继续播放后，按当前方向接入下一首';this.update()
 }

 selectMethod(method:Method){if(this.player?.transition||this.player?.busy)throw Error('请等待本次交接完成');if(!this.result?.assets[method]||!this.result.decision.methods[method]?.eligible)throw Error('该方法没有通过本轮检查');this.method=method;this.update()}
 async apply(audition=false,origin='manual'){
  if(!this.result||!this.pair||this.working||this.player?.transition)throw Error('请先准备本次交接')
  this.request?.abort();const controller=this.request=new AbortController()
  const result=this.result,pair=this.pair,method=this.method,token=++this.revision;this.working=true;this.update()
  try{const p=await this.ensure();if(!this.alive||token!==this.revision)return;if(audition)await p.audition(result,method,pair.a,pair.b);else await p.arm(result,method,pair.b,controller.signal)
   if(p.transition?.result.id===result.id){this.history.push({kind:'handoff_requested',origin,jobId:result.id,method,sourcePosition:p.position,at:new Date().toISOString()});this.history=this.history.slice(-12)}
  }finally{if(token===this.revision){this.working=false;this.update()}}
 }
 pause(){this.userIntent=null;this.invalidate(false);this.player?.pause();this.phase=this.result?'ready':'idle';this.notice='已暂停，继续播放后按你的方向自动推荐';this.save();this.update()}
 async resume(){const p=await this.ensure();await p.resume();this.retryAt=0}
 async seek(position:number){this.userIntent=null;if(this.player?.transition)throw Error('请先完成交接或停止，再调整位置');this.invalidate();this.excludedPlans.clear();this.retryAt=0;const paused=this.player?.paused;await this.player?.seek(position);if(paused)this.player?.pause()}
 cancel(){this.userIntent=null;if(this.player?.transition)throw Error('已安排交接，暂停可暂停时间轴，停止可取消');this.invalidate();this.retryAt=Date.now()+30000;this.notice='已取消这次准备，当前歌曲继续播放';this.update()}
 stop(){this.userIntent=null;this.invalidate();this.player?.stop();this.lastCurrent=null;this.retryAt=0;this.notice='已停止';this.save();this.update()}
 pauseForHost(){this.userIntent=null;this.invalidate(false);if(this.player?.busy){this.player.stop();this.notice='已暂停准备，回到前台后重新开始'}else this.player?.pause();this.save()}
 setVolume(value:number){if(!Number.isFinite(value))throw Error('音量无效');this.volume=Math.max(0,Math.min(1,value));this.player?.setVolume(this.volume);this.update()}
 filters(value:{label?:string;query?:string}){this.label=value.label??this.label;this.query=value.query??this.query;this.update()}
 export(){return {...this.player?.export(),schema:'harbeat.metric-mix-session.v1',release:METRIC_RELEASE,automaticPolicy:SMART_POLICY,direction:{style:this.targetStyle,energy:this.energyLevel,automatic:this.automatic},history:this.history,selectedResult:this.result??this.lastResult,selectedMethod:this.method,selection:this.selection,exportedAt:new Date().toISOString()}}
 save(){if(this.player)this.host?.saveSession(JSON.stringify(this.export()))}
 dispose(){this.warmController?.abort();this.alive=false;this.invalidate();this.save();this.player?.dispose()}
 snapshot(){const p=this.player,r=this.result;return {release:METRIC_RELEASE,selected:this.selected,label:this.label,query:this.query,volume:this.volume,working:this.working,notice:this.error||this.notice,canArm:!!r&&canArm(r.plan,p?.current?.id??null,p?.position??0)&&!p?.transition,
  automatic:this.automatic,energyLevel:this.energyLevel,targetStyle:this.targetStyle,phase:this.phase,nearbyWorking:!!this.nearbyTask,recommendation:this.recommendation,selection:this.selection,
  result:r?{id:r.id,policyVersion:r.policyVersion,plan:r.plan,metrics:r.metrics,decision:r.decision,available:METHODS.filter(m=>r.assets[m]&&r.decision.methods[m]?.eligible)}:null,method:this.method}}
}
export async function loadMetricIndex(base:URL){return readLibraryIndex(await readMetricJson('/listen/library.json',base))}
