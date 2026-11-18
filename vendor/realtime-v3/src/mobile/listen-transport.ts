import {LoopCatalog} from './longmix/loop-catalog'
import {LoopSession} from './longmix/loop-session'
import {assessAutoRunway,assessContinuation,CONTINUATION_RESERVE_SECONDS} from './set-continuity'
import type {ActivitySession} from './activity-session'
import {preferListenEnergy} from './listen-energy'
import {compactListenEvent,listenAuditPolicy} from './listen-export'
import {DeviceEntryCache} from './device-entry'
import {nativeAudioPriorityFetch} from './native-audio-priority'
import {LiveTransport} from '../listen-upstream/realtime/transport'
import {planContinuous} from '../listen-upstream/continuous/beatAlignment'
import {planAutomaticQuality,AUTOMATIC_POLICY} from '../listen-upstream/continuous/qualityPlan'
import {nativeSegments,nativeSegment} from '../listen-upstream/continuous/segments'
import {PerformanceEffects,scratchRouting} from './performance-effects'
import {planScratch,renderScratch,type ScratchPlan} from './performance-plan'
import {contextForSource} from '../metric-upstream/metric-mix/plan'
import type {Track,Plan,Intent,Asset} from '../listen-upstream/realtime/planner'
import {CrossGenreClient} from './crossgenre/client'
import {CrossGenreSession} from './crossgenre/lifecycle'
import {createListenCrossPort} from './crossgenre/listen-port'
import type {CrossIndex} from './crossgenre/contract'
import {StemPreparation,stemPlanKey,type StemIndex} from './stem-mix/preparation'
import {StemExecution} from './stem-mix/listen-port'
import {ListenReservationAudioCache} from './listen-reservation-cache'
import {CompetitionSession} from './competition/session'
import {MaterialCatalog} from './competition/materials'
import {validateNativeWinner} from './competition/experiments'
import type {Candidate} from './competition/candidates'
import type {CrossPlan} from './crossgenre/planner'
import type {ExecutionMethod} from './device-execution'
import type {Method} from '../metric-upstream/metric-mix/types'
import {completeGradualPlans,fixedStemTargets,resolveFixedStemPlan,matchFixedStemPlan,reservationGradualPlans} from './competition/gradual'
import {PreludeCatalog,preludeMatches} from './competition/prelude'
import {scheduleDeviceGraph} from './device-graph'
import {getDevicePCM,pinDevicePCM,deviceBufferUsage} from './device-prepare'
import {ExitAudioCache,exitSourceAssets} from './competition/exit-audio'
import {LiveCatalog} from './longmix/live-catalog'
import {MultiCatalog,type MultiMode} from './longmix/multi-catalog'
import {LiveSession} from './longmix/live-session'
import {createLivePort} from './longmix/live-port'
import type {LiveOutcome} from './longmix/live-contract'
import {PairSession} from './dj-reference/pair-session'
import {LYRIC_PAIR_REASON,PAIR_REASON,pairPlan,type CuePair,type PairReference} from './dj-reference/pair'
import {LYRIC_PAIR_SCHEMA,type LyricPair} from './dj-reference/lyric-pair'
import {queueSetContinuation} from './dj-reference/set-continuation'
/** Pin-bound output seam: neutral dry unity; upstream source/deck/EQ untouched. */
export class ListenTransport extends LiveTransport {
 private loopSession:LoopSession|null=null;private loopTimer:number|null=null
 async configureLoopExtension(enabled:boolean,base:URL,cycles=4){if(enabled&&(this.pending||this.crossGenrePending||this.liveLayeringPending||this.gate.locked))throw Error('交接完成后再开启器乐循环');if(!this.loopSession&&enabled){this.loopSession=new LoopSession(this,base,this.notify,new LoopCatalog(this.ctx,this.cache,base,(t,p)=>!this.continuityEnabled||assessContinuation(t,p).allowed));this.loopTimer=window.setInterval(()=>this.loopSession?.tick(),40)}this.loopSession?.configure(enabled,cycles);if(enabled){this.cancelLivePreparation();await this.configureLiveLayering(false,base);this.cancelPreparation();void this.loopSession?.warm()}}
 get loopExtensionStatus(){return this.loopSession?.snapshot()??{enabled:false,cycles:4,revision:0,state:'disabled',reason:'器乐循环已关闭'}}
 get loopExtensionPending(){return this.loopSession?.pending??null}
 get loopExtensionUpcoming(){return this.loopSession?.upcoming??null}
 prepareLoopExtension(){return this.loopSession?.warm()??Promise.resolve()}
 armLoopExtension(){if(!this.loopSession?.arm())return false;this.cancelPreparation();return true}
 releaseLoopExtension(){return this.loopSession?.release()??false}
 override get position():number{return this.loopSession?.position??super.position}
 private continuityEnabled=false
 setSessionContinuity(value:boolean){if(this.pending||this.crossGenrePending||this.liveLayeringPending||this.loopExtensionPending||this.gate.locked)throw Error('交接完成后再调整连续演出');this.continuityEnabled=value;this.cancelLivePreparation();this.cancelPreparation()}
 get sessionContinuity(){return{enabled:this.continuityEnabled,reserveSeconds:CONTINUATION_RESERVE_SECONDS}}
 private multiMode:MultiMode='off'
 private liveSession:LiveSession|null=null;private livePort:ReturnType<typeof createLivePort>|null=null;private liveTimer:number|null=null;private liveWarmCandidates:string[]|null=null;private liveBaselineOwner:ListenReservationAudioCache|null=null;private liveEscapePins=new Set<string>()
 private pinLiveGradual(assets:Asset[]){if(this.liveBaselineOwner)this.liveBaselineOwner.protected=new Set([...this.liveEscapePins,...assets.map(a=>a.url)])}
 async configureLiveLayering(enabled:boolean,base:URL,outcome:LiveOutcome='takeover-b',multi:MultiMode=this.multiMode){
  if(!['off','c','cd','roles-c','roles-cd'].includes(multi))throw Error('多来源模式无效')
  if(enabled&&this.loopExtensionPending)throw Error('器乐循环释放后再开启自动长混');if(enabled)this.loopSession?.configure(false)
  if(this.liveSession&&(this.liveSession.outcome!==outcome||this.multiMode!==multi)){if(this.liveLayeringPending||this.pending||this.crossGenrePending||this.gate.locked)throw Error('交接完成后再调整长混结局');this.liveSession.dispose();this.liveSession=null;this.livePort?.dispose();this.livePort=null;if(this.liveTimer!==null)clearInterval(this.liveTimer);this.liveTimer=null}
  if(!this.liveSession&&enabled){const port=this.livePort=createLivePort(this,base,this.notify);this.liveBaselineOwner??=new ListenReservationAudioCache(this.ctx,base,()=>{},this.cache.pool);this.liveSession=new LiveSession(port,new MultiCatalog(new LiveCatalog(this.ctx,this.cache,base,{},outcome,(t,p)=>this.continuityEnabled?assessContinuation(t,p):assessAutoRunway(t,p)),this.ctx,this.cache,base,multi,{playing:()=>this.playing,log:(kind,data)=>this.log(kind,data)}),outcome);this.liveTimer=window.setInterval(()=>this.liveSession?.tick(),40)}
  this.multiMode=multi;this.liveSession?.setEnabled(enabled)
  if(enabled&&this.liveSession){
   const catalog=this.liveSession.initialize().catch(error=>this.log('longmix_catalog_unavailable',{reason:(error as Error).message}))
   if(multi!=='off')await catalog
  }
 }
 get liveLayeringStatus(){return {multiMode:this.multiMode,...this.liveSession?.snapshot()??{enabled:false,state:'disabled',reason:'自动长混已关闭',outcome:'takeover-b' as const,duration:undefined},buffers:{sharedBytes:this.cache.pool.bytes,sharedLimit:this.cache.pool.limit,legacy:deviceBufferUsage(),combinedCeilingBytes:320*1024*1024,basis:'192MiB shared pool plus reserved scene, 96MiB legacy stem PCM, 32MiB legacy source cache; excludes process/decoder overhead'}}}
 get liveLayeringUpcoming(){return this.liveSession?.upcoming??null}
 get liveLayeringPending(){return this.liveSession?.pending??null}
 get liveLayeringReturnRevision(){return this.liveSession?.returnRevision??0}
 livePreferredTargets(targets:Track[]){return this.liveSession?.enabled?this.liveSession.candidateIds(targets):[]}
 prepareLiveLayering(ids:string[]){if(this.liveSession?.upcoming||this.liveSession?.snapshot().state==='preparing')return Promise.resolve();return this.liveSession?.warm(ids)??Promise.resolve()}
 cancelLivePreparation(){this.liveSession?.cancelPreparation()}
 armLiveLayering(){if(!this.liveSession?.arm())return false;this.cancelPreparation();return true}
 exitLiveLayering(){return this.liveSession?.requestExit()??false}
 private pairSession:PairSession|null=null
 private learnedPairs=new Map<string,PairReference[]>()
 configurePairReferences(rows:PairReference[],learned:PairReference[]=[],policy:LyricPair[]=[],base?:URL){
  this.pairSession?.cancel()
  const references=[...rows,...policy]
  this.pairSession=references.length?new PairSession(this,references,(track,position)=>!this.continuityEnabled||assessContinuation(track,position).allowed,base):null
  this.learnedPairs.clear()
  for(const row of learned){
   const id=row.sources.b.trackId,targets=this.learnedPairs.get(id)??[]
   targets.push(row);this.learnedPairs.set(id,targets)
  }
 }
 private nearbyLearnedPair(id:string,start:number){
  const rows=this.learnedPairs.get(id),a=this.current,b=this.tracks.find(t=>t.id===id),position=this.position
  // Preserve the ordinary automatic trigger plus the six-second device preparation bound.
  if(!rows||!a||!b||start<position+14||this.reservation||this.loopExtensionStatus.enabled)return
  return rows.find(row=>{
   if(Math.abs(row.sources.a.sourceStart-start)>8||row.sources.a.sourceStart<position+14)return false
   const plan=pairPlan(row,a,b,position,a.duration-position-.1,true)
   return !!plan&&(!this.continuityEnabled||assessContinuation(b,plan.window.end).allowed)
  })
 }
 get pairReferencePlan(){const plan=this.pending?.plan;return plan&&(plan.reason===PAIR_REASON||plan.reason===LYRIC_PAIR_REASON)?plan:this.pairSession?.upcoming??null}
 async readySetPair(id:string){
  this.pairSession?.cancel()
  await this.pairSession?.prepare([id],true,this.setPairBudget())
  return this.pairSession?.upcoming??null
 }
 armSetPair(id:string){return this.pairSession?.arm(id,this.setPairBudget(),true)??false}
 queueSetContinuation(track:Track,signal:AbortSignal,origin:'set'|'automatic'='set'){return queueSetContinuation(this,track,signal,origin)}
 private setPairBudget(){return Math.max(0,(this.current?.duration??0)-this.position-.1)}
 private preparePair(ids:string[],automatic:boolean,budget:number,accept?:(recipe:CuePair)=>boolean){
  if(this.reservation||this.loopExtensionStatus.enabled)return Promise.resolve(null)
  const limit=automatic&&this.current?Math.max(0,this.current.duration-this.position-.1):budget
  return this.pairSession?.prepare(ids,automatic,limit,accept)??Promise.resolve(null)
 }
 private reservation:ActivitySession|null=null
 private gradualEvidence:{code:string;reason:string;count:number}[]=[]
 setReservation(session:ActivitySession|null){this.cancelPreparation();this.reservation=session?.strategyVersion==='jetson-decision-v1'?session:null}
 private preference:{energy:number};private restoreAudioPriority:()=>void=()=>{};
 private crossSession:CrossGenreSession|null=null;private crossClient:CrossGenreClient|null=null;private crossTimer:number|null=null
 private stemPreparation:StemPreparation|null=null;private stemExecution:StemExecution|null=null;private stemCache:ListenReservationAudioCache|null=null;private stemTimer:number|null=null;private competition!:CompetitionSession;private materials!:MaterialCatalog;private preludes!:PreludeCatalog;private selectedStem:Candidate|null=null;private selectedGradual:Plan|null=null;private allowOriginal=false;private creativeRequestRevision=0
 setEnergy(value:number){this.preference.energy=value}
 private effects!:PerformanceEffects;private lastScratch:ScratchPlan|null=null;private lastScratchTiming:Record<string,number>|null=null
 constructor(tracks:Track[],private notify:()=>void,base:URL,deviceTempo=true){const preference={energy:3};let selected:()=>Plan|null=()=>null;let narrow=(tracks:Track[])=>tracks;let choose:<T extends {best:Plan|null;candidates:Plan[]}>(r:T)=>T=r=>r;super(tracks,notify,base,{planner:(a,tracks,...args)=>choose(preferListenEnergy(planContinuous(a,narrow(tracks),...args),a,tracks,preference.energy)),automaticPlanner:(a,tracks,position,intent,ready,requireReady=false)=>{const fixed=selected(),search=fixed?planContinuous(a,narrow(tracks),position,intent,ready,Math.max(0,fixed.end-position+.5),requireReady):planAutomaticQuality(a,narrow(tracks),position,intent,ready,requireReady);if(fixed&&(fixed.from!==a.id||fixed.start<a.duration*.5||fixed.end>=a.duration-.1))return{...search,best:null,planningPosition:position};return{...choose(preferListenEnergy(search,a,tracks,preference.energy)),planningPosition:position}},automaticPolicyVersion:AUTOMATIC_POLICY,autoNext:false,prewarm:false,policyVersion:'vocal-overlap-v1',noPlanMessage:'附近没有可靠接点，当前歌曲继续播放；可以稍后重试或换歌。'});selected=()=>this.selectedStem?.plan as Plan??this.selectedGradual;narrow=tracks=>fixedStemTargets(tracks,selected());choose=r=>{const p=this.selectedStem?.plan as Plan??this.selectedGradual;if(!p||!this.active)return r;const b=this.tracks.find(t=>t.id===p.to);if(!b)return{...r,best:null};const exact=matchFixedStemPlan(this.active.track,b,p,r.candidates);return{...r,best:exact??null}};this.preference=preference;if(base.origin==='https://appassets.androidplatform.net'){
  const previous=globalThis.fetch,prioritized=nativeAudioPriorityFetch(base,url=>{
   if(!this.active)return true
   const tracks=[this.active.track,...(this.pending?[this.pending.deck.track]:[]),...(this.crossGenrePending?[this.crossGenrePending.deck.track]:[]),...(this.liveLayeringPending?[this.liveLayeringPending.deck.track]:[])]
   return tracks.some(track=>nativeSegments(track).some(({asset})=>{const source=new URL(asset.url,base);source.searchParams.set('sha256',asset.sha256);return source.href===url.href}))
  },previous)
  globalThis.fetch=prioritized;this.restoreAudioPriority=()=>{if(globalThis.fetch===prioritized)globalThis.fetch=previous}
 }if(deviceTempo){this.cache.dispose();this.cache=new DeviceEntryCache(this.ctx,base,(kind,data)=>this.log(kind,data))}
  this.materials=new MaterialCatalog(base);this.preludes=new PreludeCatalog(this.ctx,base);this.competition=new CompetitionSession({continuation:(t,p)=>this.continuityEnabled?assessContinuation(t,p):assessAutoRunway(t,p),active:()=>this.active,position:()=>this.position,now:()=>this.ctx.currentTime,tracks:()=>this.tracks,energy:()=>this.preference.energy,reservation:()=>!!this.reservation,client:()=>this.crossClient,native:()=>this.crossSession,materials:this.materials,prelude:this.preludes,
   gradualDiagnostics:()=>this.gradualEvidence,gradual:(a,targets,position,budget,automatic)=>{this.gradualEvidence=[];if(this.reservation){const plans=reservationGradualPlans(this.reservation,a,targets,position,budget,automatic,this.preference.energy);if(!plans.length)this.gradualEvidence=[{code:'reservation-cue-unavailable',reason:'预约范围内没有仍在前方且通过当前来源复核的批准接点',count:1}];return plans}const r=preferListenEnergy(automatic?planAutomaticQuality(a,targets,position,{kind:'next'},this.cache.ready,false):planContinuous(a,targets,position,{kind:'next'},this.cache.ready,budget,false),a,targets,this.preference.energy);const evidence=new Map<string,{code:string;reason:string;count:number}>();for(const {code,reason,count} of r.exclusions){const key=code+'|'+reason,old=evidence.get(key);if(old)old.count+=count;else evidence.set(key,{code,reason,count})}this.gradualEvidence=[...evidence.values()];return completeGradualPlans(a,targets,[...(r.best?[r.best]:[]),...r.candidates])},
   warmPriority:p=>this.reservation?.preparationPriority(p)??0,learnedCue:(id,start)=>!!this.nearbyLearnedPair(id,start),retainStem:(p,committed)=>this.stemPreparation?.retain(p,committed),stemStatus:p=>this.stemPreparation?.assess(p)??{canPrepare:false,code:'source-unpublished',reason:'分轨发布索引尚未载入'},warm:p=>this.stemPreparation?.warm(p)??Promise.resolve(),stem:p=>this.stemPreparation?.ready(p)??null,
   loadGradual:async(p,signal)=>{const b=this.tracks.find(t=>t.id===p.to);if(!b)throw Error('目标歌曲已经变化');let exact:Plan;try{exact=resolveFixedStemPlan(this.active!.track,b,p,this.position)}catch(error){this.log('competition_fixed_window_mismatch',{from:p.from,to:p.to,...(error as any).evidence});throw error}const assets=[b.native,exact.asset,nativeSegment(b,exact.window.end).asset];this.pinLiveGradual(assets);for(const a of assets){await this.cache.load(a,signal);signal.throwIfAborted()}},
   executeStem:async(c,budget,automatic)=>{this.selectedStem=c;this.allowOriginal=false;try{await super.request({kind:'next',targetId:c.plan.to},budget,{automatic,origin:'competition'});if(!this.pending||(c.prelude?!this.stemExecution?.prelude:this.stemExecution?.method!==c.method))throw Error(this.status||'获胜分轨方案未执行')}finally{this.selectedStem=null}},
   executeFallback:async(id,budget,automatic=false,plan)=>{this.selectedStem=null;this.selectedGradual=plan??null;this.allowOriginal=true;try{await super.request({kind:'next',targetId:id},budget,{automatic,origin:automatic?'automatic_competition_fallback':'manual_competition_fallback'});if(!this.pending)throw Error(this.status)}finally{this.allowOriginal=false;this.selectedGradual=null}},
   log:(kind,data)=>this.log(kind,data),changed:()=>this.notify()})
 }

 get upcomingPlan(){if(this.pairReferencePlan)return this.pairReferencePlan;const c=this.competition?.upcoming;return c?.kind==='stem'?c.plan as Plan:this.competition?.upcomingFallback??null}
 get crossGenrePending(){return this.crossSession?.pending??null}
 get upcomingCrossPlan(){const c=this.competition?.upcoming;return c?.kind==='native'?c.plan as CrossPlan:null}
 configureStemMix(index:StemIndex|null,base:URL){
  const value=index??{schema:'harbeat.execution-library.v1' as const,tracks:[]}
  if(this.stemPreparation){this.stemPreparation.setIndex(value);return}
  const host=this,cache=this.stemCache=new ListenReservationAudioCache(this.ctx,base,()=>{},this.cache.pool)
  const port={ctx:this.ctx,cache,cachedApprovalOnly:()=>!!host.reservation,get position(){return host.position},logs:{push:(...events:any[])=>{for(const {kind,...data} of events)host.log(kind,data);return 0}},active:()=>host.active,tracks:()=>host.tracks,log:(kind:string,data:Record<string,unknown>)=>host.log(kind,data),changed:()=>host.notify()}
  this.stemPreparation=new StemPreparation(port,value,base);this.stemExecution=new StemExecution(this,{ready:p=>{const g=this.selectedStem?.prelude,a=this.active?.track,b=this.tracks.find(t=>t.id===p.to);return g&&a&&b&&preludeMatches(g,a,b)&&stemPlanKey(a,b,p)===stemPlanKey(a,b,g.result.execution.plan)&&this.preludes.ready(g)?g.result:this.stemPreparation!.ready(p)}},this.notify,{graph:scheduleDeviceGraph,pcm:r=>this.preludes.pcm(r.id)??getDevicePCM(r),pin:r=>this.preludes.pcm(r.id)?()=>{}:pinDevicePCM(r)},{allowOriginal:()=>this.allowOriginal,method:p=>this.selectedStem?.plan.id===p.id?(this.selectedStem.prelude?.singleMethod??this.selectedStem.method as ExecutionMethod):'original',prelude:p=>this.selectedStem?.plan.id===p.id?this.selectedStem.prelude?.approval??null:null});this.stemTimer=window.setInterval(()=>this.stemExecution?.tick(),40)
 }
 stemComparison(targetId?:string|null){return this.competition?.snapshot(targetId)??{state:'idle',reason:'',recommended:'original',methods:{}}}
 setExperimentalTransitions(value:boolean){if(this.gate.locked||!this.cancel())throw Error('交接完成后再调整手法');this.competition.setExperimental(value)}
 override get automaticStart(){return this.pairReferencePlan?.start??this.competition?.automaticStart??null}
 configureCrossGenre(index:CrossIndex|null,base:URL){
  if(this.crossSession?.pending)return
  this.crossSession?.dispose();this.crossSession=null;this.crossClient=null
  if(this.crossTimer!==null){clearInterval(this.crossTimer);this.crossTimer=null}
  if(!index)return
  this.crossClient=new CrossGenreClient(base,index)
  const port=createListenCrossPort(this,base,this.notify,()=>this.preference.energy,{buffer:p=>p.bridge?port.cache instanceof ListenReservationAudioCache?port.cache.buffers.get(this.materials.asset(p.bridge.material).url):undefined:undefined,exit:p=>exitAudio.get(p)}),exitAudio=new ExitAudioCache(this.ctx,port.cache)
  this.crossSession=new CrossGenreSession(port,this.crossClient,{validate:(p,a,b,ap,bp)=>validateNativeWinner(p,a,b,ap,bp,this.materials.materials,this.competition.experimental,this.materials.sha256),prepare:async(p,signal)=>{if(p.bridge)await port.cache.load(this.materials.asset(p.bridge.material),signal);if(p.fx){const a=this.tracks.find(t=>t.id===p.from);if(!a)throw Error('退出效果的原曲已变化');const ready=await exitAudio.prepare(a,p,signal);signal.throwIfAborted();this.log('phone_exit_effect_ready',{planId:p.id,method:p.family,renderedOn:'phone',proof:ready.proof})}},pins:p=>p.bridge?[this.materials.asset(p.bridge.material).url]:p.fx?exitSourceAssets(this.tracks.find(t=>t.id===p.from)!,p).map(a=>a.url):[]})
  this.crossTimer=window.setInterval(()=>this.crossSession?.tick(),40)
 }
 override cancelPreparation(){this.pairSession?.cancel();this.loopSession?.cancelPreparation();this.liveWarmCandidates=null;this.liveEscapePins.clear();this.liveBaselineOwner?.protected.clear();super.cancelPreparation();this.crossSession?.cancelPreparation();this.stemPreparation?.cancel();this.competition?.cancel()}
 override async prepareNext(id:string,options:{automatic?:boolean;budget?:number}={}){this.cancelPreparation();if(await this.preparePair([id],options.automatic===true,options.budget??30))return;await this.competition.prepare([id],options.automatic===true,options.budget??30)}
 override async prepareAutomatic(ids:string[]){
  this.cancelPreparation()
  const batch=this.liveWarmCandidates=[...ids]
  try{
   const legacy=await this.preparePair(ids,true,0,row=>row.schema===LYRIC_PAIR_SCHEMA||!this.learnedPairs.get(row.sources.b.trackId)?.includes(row))
   if(legacy)return legacy
   const winner=await this.competition.prepare(ids,true)
   const start=this.competition.automaticStart
   if(start!==null&&this.liveWarmCandidates===batch&&this.competition.upcoming?.method!=='stem-handover'){
    const reference=this.nearbyLearnedPair(winner,start)
    if(reference)await this.preparePair([winner],true,0,row=>row===reference)
   }
   return winner
  }finally{if(this.liveWarmCandidates===batch)this.liveWarmCandidates=null}
 }
 override async request(intent:Intent,budget=18,options:{resumeId?:string;origin?:string;automatic?:boolean}={}){
  if(this.loopExtensionPending&&!this.cancel()){this.releaseLoopExtension();return}
  if(this.liveLayeringPending&&!this.cancel()){this.exitLiveLayering();return}
  const id=intent.targetId;if(!id)throw Error('请先选择下一首')
  if(this.gate.locked)throw Error('正在交接，完成后可继续切歌')
  if(!this.playing)throw Error('请先继续播放当前歌曲')
  if((this.pending||this.crossSession?.pending||this.busy)&&!this.cancel())throw Error('正在交接，完成后可继续切歌')
  const owner=++this.creativeRequestRevision,automatic=options.automatic===true,limit=automatic&&this.current?Math.max(0,this.current.duration-this.position-.1):budget
  this.busy=true;this.notify()
  try{if(!this.pairSession?.arm(id,limit,automatic))await this.competition.request(id,limit,automatic)}catch(error){if((error as Error).name==='AbortError')throw error;this.status=(error as Error).message;this.log('competition_unavailable',{trackId:id,automatic,reason:this.status})}
  finally{if(owner===this.creativeRequestRevision){this.busy=false;this.notify()}}
 }
 override cancel(){if(this.loopExtensionPending&&!this.loopSession!.cancel())return false;if(this.liveLayeringPending&&!this.liveSession!.cancel())return false;if(this.gate.locked)return false;this.pairSession?.cancel();this.cancelLivePreparation();if(this.crossSession?.pending&&!this.crossSession.cancel())return false;this.crossSession?.cancelPreparation();this.competition?.cancel();this.competition?.clearActive();this.creativeRequestRevision++;return super.cancel()}
 override cancelAutomatic(){if(this.loopExtensionPending){if(!this.loopSession!.cancel())this.loopSession!.release()}if(this.liveLayeringPending){if(!this.liveSession!.cancel())this.liveSession!.requestExit()}if(this.crossSession?.pending?.automatic)this.cancel();super.cancelAutomatic()}
 retainTracks(ids:string[]){if(this.cache instanceof DeviceEntryCache)this.cache.retainTracks(ids)}
 async registerTrack(track:Track,targets:readonly {id:string;bpm:number}[]=[]){return this.cache instanceof DeviceEntryCache?this.cache.register(track,targets):track}
 log(kind:string,data:Record<string,any>={}){if(kind==='competition_baseline_protected')this.liveEscapePins=new Set(this.liveBaselineOwner?.protected??[]);if(kind==='handoff_state_commit')this.competition?.clearActive();if(kind==='decision_search'||kind==='plan_scheduled'){const {kind:_,...audit}=compactListenEvent({...data,kind});super.log(kind,audit)}else super.log(kind,data);if(kind==='competition_baseline_protected'&&this.liveWarmCandidates&&this.liveSession?.enabled)void this.prepareLiveLayering([...this.liveWarmCandidates]).catch(error=>this.log('longmix_preparation_unavailable',{reason:(error as Error).message}))}
 export(){return {...super.export(),loopExtension:this.loopExtensionStatus,liveLayering:this.liveLayeringStatus,auditCapturePolicy:listenAuditPolicy,tempoExecution:this.cache instanceof DeviceEntryCache?'device-ffmpeg-atempo-v1':'published-reference',competitionPolicy:'musical-transition-competition-v1',competition:this.competition?.snapshot(),stemPolicy:'jetson-calibrated-stem-timeline-v1',crossGenrePolicy:'crossgenre-structural-v1',crossGenrePending:this.crossSession?.pending?.plan??null,entryRenders:this.cache instanceof DeviceEntryCache?this.cache.renders:[]}}
 async initialize(){await super.initialize();const output=this as unknown as {monitor:AudioWorkletNode;volume:GainNode};this.effects=new PerformanceEffects(this.ctx,output.volume);output.monitor.disconnect(output.volume);output.monitor.connect(this.effects.input)}
 /** Performance availability is independent from recommendation/preparation state. */
 private scratchPlan(){
  if(this.loopExtensionPending)throw Error('正在器乐循环，释放后可使用搓碟回应');
  if(this.liveLayeringPending)throw Error('正在自动长混，完成后可使用搓碟回应')
  if(!this.playing||this.buffering||this.busy||!this.active)throw Error('播放稳定后可使用搓碟回应')
  if(this.effects.scratching)throw Error('正在搓碟回应，请稍候')
  const plan=planScratch(this.active.track,this.position),at=contextForSource(this.active.at,this.active.offset,plan.start)
  const next=Math.min(this.pending?.start??Infinity,this.crossGenrePending?.start??Infinity)
  if(at+plan.duration+.15>=next)throw Error('临近交接，暂不能搓碟')
  this.excerpt(plan.sourceStart,plan.sourceDuration,false)
  return{plan,at}
 }
 private excerpt(start:number,duration:number,copy=true){
  const track=this.active!.track,sr=this.ctx.sampleRate,startFrame=Math.round(start*sr),count=Math.ceil(duration*sr),endFrame=startFrame+count
  let covered=0,channels:Float32Array[]|null=null
  for(const segment of nativeSegments(track)){
   const segmentStart=Math.round(segment.start*sr),from=Math.max(startFrame,segmentStart),to=Math.min(endFrame,Math.round(segment.end*sr))
   if(to<=from)continue
   const buffer=this.cache.buffers.get(segment.asset.url)
   if(!buffer||buffer.sampleRate!==sr||buffer.numberOfChannels<1||buffer.length<to-segmentStart)throw Error('当前片段缓存尚未覆盖搓碟窗口，请稍后再试')
   if(!channels)channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},()=>new Float32Array(copy?count:0))
   if(channels.length!==Math.min(2,buffer.numberOfChannels))throw Error('缓存声道不一致，暂不能搓碟')
   if(copy)channels.forEach((channel,c)=>channel.set(buffer.getChannelData(c).subarray(from-segmentStart,to-segmentStart),from-startFrame))
   covered+=to-from
  }
  if(!channels||covered!==count)throw Error('当前片段缓存覆盖不足，暂不能搓碟')
  return channels
 }
 get performance(){
  if(!this.effects)return {supported:false,mc:false,scratching:false,canScratch:false,scratchReason:"正在准备音频"}
  let canScratch=false,scratchReason=''
  try{this.scratchPlan();canScratch=true}catch(error){scratchReason=(error as Error).message}
  return{supported:true,mc:this.effects.mc,scratching:this.effects.scratching,canScratch,scratchReason,routing:scratchRouting,lastScratch:this.lastScratch,lastScratchTiming:this.lastScratchTiming}
 }
 setMC(enabled:boolean){this.effects.setMC(enabled);this.log('mc_mode',{enabled,lowpassHz:320,order:4,bassGain:1});this.notify()}
 scratch(){
  const began=performance.now(),{plan,at}=this.scratchPlan(),planned=performance.now(),pcm=this.excerpt(plan.sourceStart,plan.sourceDuration),copied=performance.now(),samples=renderScratch(pcm,this.ctx.sampleRate,plan),rendered=performance.now()
  const clip=this.ctx.createBuffer(samples.length,samples[0].length,this.ctx.sampleRate)
  samples.forEach((channel,c)=>clip.getChannelData(c).set(channel))
  // Recheck the clock after PCM generation; never silently start late.
  if(at<this.ctx.currentTime+.02)throw Error('搓碟拍点已过，请重新触发')
  const buffered=performance.now(),wasMC=this.effects.mc
  if(!this.effects.scratch(clip,at))throw Error('正在搓碟回应，请稍候')
  if(wasMC)this.log('mc_mode',{enabled:false,reason:'scratch_response'})
  this.lastScratchTiming={renderMs:performance.now()-began,leadMs:(at-this.ctx.currentTime)*1000,planningMs:planned-began,copyMs:copied-planned,pcmMs:rendered-copied,bufferMs:buffered-rendered,scheduleMs:performance.now()-buffered};this.lastScratch=plan;this.log('scratch_response',{track:this.current!.id,plan,renderMs:performance.now()-began,scheduleLeadMs:(at-this.ctx.currentTime)*1000,contextStart:at,contextEnd:this.effects.lastScratchEnd,sourceSha256:this.current!.provenance?.masterSha256,routing:scratchRouting,backingGain:scratchRouting.originalGain});this.notify()
 }
 stop(invalidate=true){this.loopSession?.stop();this.liveSession?.stop();this.creativeRequestRevision++;this.competition?.cancel();this.competition?.clearActive();this.stemExecution?.stop();this.preludes?.clear();this.stemPreparation?.cancel();this.crossSession?.stop();this.effects?.cancelScratch(true);super.stop(invalidate)}
 dispose(){if(this.loopTimer!==null)clearInterval(this.loopTimer);this.loopSession?.dispose();if(this.liveTimer!==null)clearInterval(this.liveTimer);this.liveSession?.dispose();this.livePort?.dispose();this.liveBaselineOwner?.dispose();if(this.stemTimer!==null)clearInterval(this.stemTimer);this.stemExecution?.dispose();this.stemPreparation?.dispose();this.stemCache?.dispose();if(this.crossTimer!==null)clearInterval(this.crossTimer);this.crossSession?.dispose();super.dispose();this.effects?.dispose();this.restoreAudioPriority()}
}
