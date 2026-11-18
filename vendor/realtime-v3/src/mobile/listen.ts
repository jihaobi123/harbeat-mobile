import {TrackLibrary,readLibraryIndex,refreshLibraryTracks,type LibraryIndex} from '../listen-upstream/continuous/catalog'
import {NextSelection} from '../listen-upstream/continuous/selection'
import {automaticAction} from '../listen-upstream/continuous/automatic'
import {initializeFromGesture} from '../listen-upstream/continuous/activation'
import {ListenTransport} from './listen-transport'
import type {Plan} from '../listen-upstream/realtime/planner'
import {selectSessionBatch,SESSION_SELECTION_POLICY} from './listen-selection'
import {exportListenAudit} from './listen-export'
import type {Host} from './session'
import {ActivitySession} from './activity-session'
import {cacheActivityAssets,type SetCacheProgress} from './set-cache'
import {validateIndex,type CrossIndex} from './crossgenre/contract'
import {readStemIndex,type StemIndex} from './stem-mix/preparation'
import {sourcePublication} from './catalog-readiness'
import type {LiveOutcome} from './longmix/live-contract'
import type {MultiMode} from './longmix/multi-catalog'
import {PAIR_INDEX,PAIR_LAB,SET_TECHNIQUES,readPairIndex,upcomingPairTargets,type PairReference} from './dj-reference/pair'
import {LYRIC_PAIR_INDEX,readLyricPairIndex,type LyricPair} from './dj-reference/lyric-pair'
import {OrderedDjSet,readToucanSet,TOUCAN_SET_PATH,toucanCueList} from './dj-reference/set'
const TAIL_PREPARATION_SECONDS=18
const TAIL_CANDIDATE_TIMEOUT_MS=4500
export const LISTEN_RELEASE={id:'listen-mobile-20261026-competition',executionPolicy:'listen-live-v1',sourceCommit:'913268a14c4a03b85438da345e01c792d887ee55',competitionPolicy:'musical-transition-competition-v1',crossGenrePolicy:'crossgenre-structural-v1',stemPolicy:'jetson-calibrated-stem-timeline-v1'}
export async function readListenJson(path:string,base:URL){const r=await fetch(new URL(path,base),{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('曲库读取失败 '+r.status);return r.json()}
type SourceIndex=LibraryIndex&{deviceSourceIds?:string[];crossGenreIndex?:CrossIndex|null;stemIndex?:StemIndex|null;pairReferences?:PairReference[];learnedPairReferences?:PairReference[];lyricPairs?:LyricPair[]}
export const PHONE_SOURCE_LIBRARY='/analysis-lab-static/mobile-library-v1/library.json'
export const APPROVED_SOURCE_LIBRARY='/listen/catalog/bassment-fm-v1/library.json'
export async function loadListenIndex(base:URL,read=readListenJson):Promise<SourceIndex>{
 const primary=read('/listen/library.json',base),extra=read(PHONE_SOURCE_LIBRARY,base).catch(()=>null),cross=read('/listen/crossgenre/index.json',base).then(validateIndex).catch(()=>null),stem=read('/listen/execution/index.json',base).then(readStemIndex).catch(()=>null)
 const approved=read(APPROVED_SOURCE_LIBRARY,base).then(value=>value.executionPolicy==='device-native-windows-v1'?readLibraryIndex(value):null).catch(()=>null)
 const native=base.hostname==='appassets.androidplatform.net'
 const lab=native?read(PAIR_LAB+'/library.json',base).then(readLibraryIndex).catch(()=>null):Promise.resolve(null)
 const readPairs=(path:string)=>read(path,base).then(readPairIndex).catch(()=>[])
 const references=Promise.all([readPairs(PAIR_INDEX),...(native?[readPairs(PAIR_LAB+'/index.json'),readPairs(SET_TECHNIQUES)]:[])])
 const lyricPairs=read(LYRIC_PAIR_INDEX,base).then(readLyricPairIndex).catch(()=>[])
 const local=await lab
 const index=await primary.then(readLibraryIndex).catch(error=>{if(!local)throw error;return {...local,tracks:[]}}),[candidate,official]=await Promise.all([extra,approved])
 const officialRows=official?.tracks??[],knownIds=new Set([...index.tracks,...officialRows].map(t=>t.id))
 const primaryTracks=local?[...index.tracks,...local.tracks.filter(t=>!knownIds.has(t.id))]:index.tracks
 const labIds=local?.tracks.map(t=>t.id).filter(id=>!knownIds.has(id))??[]
 const [remotePairs,...localPairs]=await references
 const learnedPairReferences=[...new Map(localPairs.flat().map(row=>[row.id,row])).values()]
 const learnedIds=new Set(learnedPairReferences.map(row=>row.id))
 const pairReferences=[...learnedPairReferences,...remotePairs.filter(row=>!learnedIds.has(row.id))]
 const crossGenreIndex=await cross,stemIndex=await stem
 const extraRows=candidate?.executionPolicy==='device-native-windows-v1'?readLibraryIndex(candidate).tracks:[]
 const extension=new Map([...extraRows,...officialRows].map(t=>[t.id,t])),known=new Set(primaryTracks.map(t=>t.id)),added=[...extension.values()].filter(t=>!known.has(t.id)),promoted:string[]=[]
 const tracks=primaryTracks.map(t=>{
  const source=extension.get(t.id)
  // A playback-only publication must not hide a fully prepared device source.
  // Detail loading and all source/report/acoustic checks still run normally.
  if(t.mixStatus!=='ready'&&source?.mixStatus==='ready'&&source.playStatus==='ready'&&source.bpm===t.bpm&&Math.abs(source.duration!-t.duration!)<=.05){promoted.push(t.id);return source}
  return t
 })
 return {...index,tracks:[...tracks,...added],deviceSourceIds:[...labIds,...promoted,...added.map(t=>t.id)],crossGenreIndex,stemIndex,pairReferences,learnedPairReferences,lyricPairs:await lyricPairs}
}
function sourceTargets(index:SourceIndex,id:string){
 const sourceIds=new Set(index.deviceSourceIds??[]),all=sourceIds.has(id)
 return index.tracks.filter(t=>(all||sourceIds.has(t.id))&&t.playStatus==='ready'&&t.mixStatus==='ready'&&typeof t.bpm==='number'&&t.bpm>0).map(t=>({id:t.id,bpm:t.bpm!}))
}
/** Native controls around the pinned Listen planner and uninterrupted dual decks. */
export class ListenRun{
 library:TrackLibrary;private sources:TrackLibrary;private initializing:Promise<void>|null=null;player:ListenTransport|null=null;next:NextSelection
 automatic=true;energyLevel=3;targetStyle='';volume=.85;label='';query='';notice='网页曲库已接入，选择音乐开始播放';error='';working=false;private liveEnabled=false
 private alive=true;private revision=0;private selectionRevision=0;private lastCurrent:string|null=null;private recent:string[]=[];private played=new Map<string,number>();private pins:string[]=[];private explicit:string|null=null;private excluded=new Set<string>();private autoAt=0;private autoWorking=false;private manual=false;private manualTask:Promise<void>|null=null;private retryAt=0
 private activity:ActivitySession|null=null;private sessionRevision=0;private cacheController:AbortController|null=null;private setCache:SetCacheProgress|null=null;private cachePackId:string|null=null
 private orderedSet:OrderedDjSet|null=null
 private configurePairs(){this.player?.configurePairReferences?.(this.index.pairReferences??[],this.index.learnedPairReferences??[],this.index.lyricPairs??[],this.base)}
 private tailAttempted=false;private tailController:AbortController|null=null
 get orderedSetStatus(){
  const set=this.orderedSet
  if(!set)return null
  return {...set.snapshot(),handoff:this.player?.pending?.plan.window.role??null}
 }
 private async toucanPackage(){
  if(this.base.hostname!=='appassets.androidplatform.net')throw Error('Toucan Set 仅在手机试听版可用')
  const [manifest,techniques]=await Promise.all([
   this.read(TOUCAN_SET_PATH,this.base),
   this.read(SET_TECHNIQUES,this.base).then(readPairIndex).catch(()=>[]),
  ])
  const references=new Map((this.index.pairReferences??[]).map(row=>[row.id,row]))
  for(const row of techniques)if(row.technique)references.set(row.id,row)
  return {tracks:readToucanSet(manifest),references:[...references.values()]}
 }
 async toucanAuditions(){
  const {tracks,references}=await this.toucanPackage()
  return toucanCueList(tracks,references,this.continuityEnabled)
 }
 async startToucanSet(auditionSlot?:number){
  if(this.working)return
  this.stop()
  const revision=++this.revision
  this.working=true;this.error='';this.notice='正在准备 Toucan 2014';this.changed()
  try{
   const [{tracks,references},p]=await Promise.all([this.toucanPackage(),this.ensure()])
   if(!this.alive||revision!==this.revision)return
   const cue=auditionSlot===undefined?undefined:toucanCueList(tracks,references,this.continuityEnabled).find(row=>row.slot===auditionSlot)
   if(auditionSlot!==undefined&&!cue)throw Error('这个接点尚未通过复核')
   const index=cue?cue.slot-1:0
   this.activity=null;p.setReservation(null);p.tracks=tracks
   p.configurePairReferences(references)
   this.orderedSet=new OrderedDjSet(tracks,p,()=>this.save(),this.changed,index)
   p.log('dj_set_start',{id:'toucan-2014',startSlot:index+1,audition:!!cue,tracks:tracks.map(t=>({id:t.id,title:t.title,source:t.provenance?.originalSha256}))})
   await p.start(tracks[index].id,cue?.position??0)
  }catch(error){
   if(revision===this.revision){this.orderedSet?.close();this.orderedSet=null;this.configurePairs()}
   throw error
  }finally{
   if(revision===this.revision){this.working=false;this.tick();this.changed()}
  }
 }
 private loopEnabled=false;private loopCycles=4;private seenLoopRevision=0;private nextAfterLoop=false
 async setLoopExtension(enabled:boolean,cycles=4){const p=this.player;if(![4,8,16].includes(cycles))throw Error('循环次数无效');if(p)await p.configureLoopExtension(enabled,this.base,cycles);this.loopEnabled=enabled;this.loopCycles=cycles;if(enabled){this.liveEnabled=false;if(p?.current&&!this.pending(p))this.suggest()}this.changed()}
 private continuityEnabled=false
 setContinuousSet(value:boolean){const p=this.player;if(p&&(this.pending(p)||p.gate.locked))throw Error('交接完成后再调整连续演出');this.continuityEnabled=value;p?.setSessionContinuity?.(value);if(p?.current)this.suggest();this.changed()}
 private multiMode:MultiMode='off'
 async setMultiLayering(mode:MultiMode){if(!['off','c','cd','roles-c','roles-cd'].includes(mode))throw Error('多来源模式无效');const p=this.player;if(p&&(this.pending(p)||p.gate.locked||p.busy))throw Error('交接完成后再调整多来源');if(p)await p.configureLiveLayering(this.liveEnabled,this.base,this.liveOutcome,mode);this.multiMode=mode;if(p?.current)this.suggest();this.changed()}
 private seenReturnRevision=0;private liveOutcome:LiveOutcome='takeover-b'
 constructor(readonly index:SourceIndex,readonly base:URL,private changed:()=>void,private host?:Host,private create=(base:URL,changed:()=>void)=>new ListenTransport([],changed,base),private read=readListenJson){
  this.sources=new TrackLibrary(index.tracks,base,read)
  this.library=new TrackLibrary(index.tracks,base,(path,b)=>this.readTrack(path,b))
  this.next=new NextSelection(id=>this.library.load(id),{install:()=>this.install(),prepare:id=>{this.pins=[id];return this.player!.prepareNext(id,{automatic:this.automatic&&!this.manual,...(this.manual?{budget:60}:{})})},prepareCandidates:ids=>{this.pins=[...ids];return this.player!.prepareAutomatic(ids)}},()=>this.changed())
 }
 private selectOne(id:string){this.pins=[id];const revision=this.selectionRevision;return this.next.select(id).finally(()=>{if(revision===this.selectionRevision)this.warmLive()})}
 private warmLive(){const p=this.player;if(this.liveEnabled&&this.automatic&&!this.manual&&p?.current&&!p.pairReferencePlan&&!this.pending(p)&&!p.busy&&['ready','failed'].includes(this.next.state.status))void p.prepareLiveLayering?.([...this.pins]).catch(error=>p.log('longmix_preparation_unavailable',{reason:(error as Error).message}))}
 private pending(p=this.player){return p?.pending??p?.crossGenrePending??p?.liveLayeringPending??p?.loopExtensionPending??null}
 async setLiveLayering(enabled:boolean,outcome:LiveOutcome=this.liveOutcome){if(!['takeover-b','return-a'].includes(outcome))throw Error('长混结局无效');const p=this.player;if(outcome!==this.liveOutcome&&p&&(this.pending(p)||p.gate.locked||p.busy))throw Error('交接完成后再调整长混结局');if(p)await (this.multiMode==='off'?p.configureLiveLayering?.(enabled,this.base,outcome):p.configureLiveLayering?.(enabled,this.base,outcome,this.multiMode));this.liveOutcome=outcome;this.liveEnabled=enabled;if(enabled)this.loopEnabled=false;if(p){if(p.current&&!this.pending(p)&&!p.gate.locked&&!p.busy)this.suggest()}this.changed()}
 private crossGenreIds(){const rows=this.index.crossGenreIndex?.tracks??[];return rows.some(t=>t.trackId===this.player?.current?.id&&t.exitCount>0)?new Set(rows.filter(t=>t.entryCount>0).map(t=>t.trackId)):new Set<string>()}
 private async readTrack(path:string,base:URL){const entry=this.index.tracks.find(t=>t.detailUrl===path);const value=entry?{track:await this.sources.load(entry.id)}:await this.read(path,base);return value?.track&&this.player?.registerTrack?{...value,track:await this.player.registerTrack(value.track,sourceTargets(this.index,value.track.id))}:value}
 private install(){const p=this.player;if(!p)return;this.library.trim(new Set([p.current?.id,this.pending(p)?.plan.to,this.next.state.id,...this.pins].filter(Boolean) as string[]),10);this.sources.trim(new Set(this.library.values().map(t=>t.id)),10);p.tracks=this.library.values();p.retainTracks?.(p.tracks.map(t=>t.id))}
 private async ensure(){
  if(this.host&&!this.host.requestFocus())throw Error('请回到前台后继续播放')
  if(!this.player){const p=this.player=this.create(this.base,()=>this.changed());this.initializing=initializeFromGesture(p).then(async()=>{p.setReservation?.(this.activity);p.configureCrossGenre?.(this.index.crossGenreIndex??null,this.base);p.configureStemMix?.(this.index.stemIndex??null,this.base);this.configurePairs();p.setSessionContinuity?.(this.continuityEnabled);p.setVolume(this.volume);p.setEnergy?.(this.energyLevel);if(this.liveEnabled)await (this.multiMode==='off'?p.configureLiveLayering?.(true,this.base,this.liveOutcome):p.configureLiveLayering?.(true,this.base,this.liveOutcome,this.multiMode));if(this.loopEnabled)await p.configureLoopExtension(true,this.base,this.loopCycles)}).catch(e=>{p.dispose();if(this.player===p)this.player=null;throw e}).finally(()=>{this.initializing=null})}
  if(this.initializing)await this.initializing
  return this.player!
 }
 private entries(){return this.activity?this.index.tracks.filter(t=>this.activity!.ids.has(t.id)):this.index.tracks}
 private checkScope(id:string){if(this.activity&&!this.activity.ids.has(id))throw Error('这首歌不在预约 set 中，请先退出预约')}
 async start(id:string){
  this.checkScope(id);if(this.pending())throw Error('请先完成交接或停止，再更换当前歌曲')
  if(this.orderedSet)this.stop()
  this.cancelTail()
  const revision=++this.revision;this.working=true;this.manual=false;this.explicit=null;this.pins=[];this.next.clear();this.player?.cancelPreparation();this.notice='正在准备原曲';this.error='';this.changed()
  try{const p=await this.ensure();await this.library.load(id);if(!this.alive||revision!==this.revision)return;if(this.pending(p))throw Error('交接完成后可更换当前歌曲');this.install();await p.start(id);if(!this.alive||revision!==this.revision)return;this.lastCurrent=null;this.tick()}
  finally{if(revision===this.revision){this.working=false;this.changed()}}
 }
 choose(id:string){
  if(this.orderedSet)throw Error('Set 按固定曲序播放，请先停止再手动选歌')
  this.checkScope(id);const p=this.player;if(!p?.current)throw Error('请先播放当前歌曲');if(p.gate.locked)throw Error('交接完成后可选择下一首')
  if(!this.index.tracks.some(t=>t.id===id&&t.playStatus==='ready'&&t.mixStatus==='ready'))throw Error('这首歌尚未具备混音条件')
  if(id===p.current.id)throw Error('请选择不同的下一首')
  this.syncCurrent();this.cancelTail()
  p.log('selection_batch',{policy:SESSION_SELECTION_POLICY,mode:'explicit',reason:'manual_target',ids:[id],from:p.current.id,sourcePosition:p.position,playedTrackCount:this.played.size,targetPlayCount:this.played.get(id)??0})
  this.manual=false;this.explicit=id;this.pins=[id];this.selectionRevision++;this.excluded.clear();this.autoAt=0;this.retryAt=0;this.error='';this.notice='正在准备下一首，当前歌曲继续播放'
  if(this.pending(p)||p.busy)p.cancel();p.cancelLivePreparation?.();p.cancelPreparation();void this.selectOne(id);this.changed()
 }
 private suggest(){
  if(this.orderedSet||this.tailController)return
  const p=this.player,entry=this.index.tracks.find(t=>t.id===p?.current?.id);if(!p?.current||!entry||p.gate.locked)return
  const canPrefer=this.automatic&&!this.manual&&!this.activity&&!this.loopEnabled
  const pairTargets=canPrefer?upcomingPairTargets(this.index.pairReferences??[],p.current,p.position):[]
  const lyricTargets=canPrefer?upcomingPairTargets(this.index.lyricPairs??[],p.current,p.position):[]
  const liveTargets=this.liveEnabled&&this.automatic&&!this.manual?p.livePreferredTargets?.(this.entries() as any)??[]:[]
  const batch=selectSessionBatch(this.entries(),entry,this.played,this.recent,this.excluded,{targetId:this.explicit??undefined,style:this.targetStyle||undefined},new Set([...this.crossGenreIds(),...lyricTargets]),new Set([...pairTargets,...liveTargets,...lyricTargets]))
  if(!batch.ids.length){this.next.clear();this.autoAt=entry.duration??Infinity;this.notice='当前范围没有可衔接歌曲，可以换歌或调整风格';this.changed();return}
  this.pins=this.automatic&&!this.manual?batch.ids:batch.ids.slice(0,1)
  p.log('selection_batch',{...batch,ids:[...this.pins],from:entry.id,sourcePosition:p.position,style:this.targetStyle,excludedIds:[...this.excluded]})
  this.selectionRevision++;p.cancelLivePreparation?.();p.cancelPreparation();if(this.pending(p)||p.busy)p.cancel()
  if(this.automatic&&!this.manual){const revision=this.selectionRevision;void this.next.selectCandidates(this.pins).finally(()=>{if(revision===this.selectionRevision)this.warmLive()})}else void this.selectOne(this.pins[0])
 }
 direction(value:{automatic?:boolean;style?:string;energy?:number}){
  const enabling=value.automatic===true&&!this.automatic
  const changed=value.style!==undefined&&value.style!==this.targetStyle||value.energy!==undefined&&value.energy!==this.energyLevel
  if(value.energy!==undefined&&(!Number.isInteger(value.energy)||value.energy<1||value.energy>5))throw Error('能量档位无效')
  if(value.style!==undefined&&value.style!==''&&!this.index.tracks.some(t=>t.styleLabels.includes(value.style!)))throw Error('当前曲库没有这个风格')
  if(value.style!==undefined)this.targetStyle=value.style;if(value.energy!==undefined){this.energyLevel=value.energy;this.player?.setEnergy?.(value.energy)}
  if(value.automatic!==undefined)this.automatic=value.automatic
  if(changed||value.automatic===false||enabling)this.cancelTail()
  if(changed){this.explicit=null;this.manual=false;this.excluded.clear();this.autoAt=0}
  const p=this.player
  if(!this.automatic){p?.cancelAutomatic();p?.cancelPreparation();this.next.cancelPending()}
  if(changed&&p?.loopExtensionPending){p.releaseLoopExtension();this.notice='将在最近获准点释放器乐循环，再应用音乐方向';this.changed();return}
  if(changed&&p?.liveLayeringPending&&p.gate.locked){p.exitLiveLayering();this.notice='将在最近合适出口结束长混，再应用新的音乐方向';this.changed();return}
  if(p?.current&&!p.gate.locked&&changed){if(this.pending(p)||p.busy)p.cancel();this.suggest()}
  else if(enabling&&p?.current&&!p.gate.locked&&!this.pending(p)&&!p.busy){
   this.autoAt=0
   if(this.next.state.id&&['ready','idle','queued'].includes(this.next.state.status))void this.selectOne(this.next.state.id)
   else if(!this.next.state.id)this.suggest()
  }
  this.notice=this.automatic?'按合适接点自动衔接':'自动接歌已关闭，当前歌曲继续播放';this.changed()
 }
 private mix(automatic=false){
  if(this.manualTask)return this.manualTask
  const revision=this.selectionRevision,p=this.player,id=this.next.state.id
  if(!p?.playing||!id||p.gate.locked)return Promise.resolve()
  const task=(async()=>{this.error='';this.notice='正在寻找合适接点，当前歌曲继续播放';this.changed()
   await p.request({kind:'next',targetId:id},18,{origin:automatic?'continuous_end_auto':'mobile_user',automatic})
   if(!automatic&&!this.pending(p)&&revision===this.selectionRevision&&p.current&&p.playing)await p.request({kind:'next',targetId:id},60,{origin:'mobile_user_extended'})
   if(revision===this.selectionRevision){this.manual=!automatic&&!this.pending(p);this.retryAt=Date.now()+3000;this.notice=this.pending(p)?'已安排音乐交接':p.status;this.save()}
  })().catch(e=>{if(revision===this.selectionRevision){this.error=(e as Error).message;this.manual=!automatic;this.retryAt=Date.now()+3000}}).finally(()=>{if(this.manualTask===task)this.manualTask=null;this.changed()})
  this.manualTask=task;return task
 }
 requestNext(){
  if(this.orderedSet)throw Error('Set 会在已批准接点或原曲结尾接到指定下一首')
  if(this.player?.loopExtensionPending){if(this.player.gate.locked||!this.player.cancel()){this.nextAfterLoop=true;this.player.releaseLoopExtension();this.notice='先释放器乐循环，再接下一首';this.changed();return}}
  if(this.player?.liveLayeringPending){if(this.player.gate.locked||!this.player.cancel()){this.player.exitLiveLayering();this.notice='将在合适退出点结束长混';this.changed();return}}
  this.player?.cancelLivePreparation?.()
  const p=this.player;if(p?.gate.locked)throw Error('正在交接，完成后可继续换歌')
  this.syncCurrent();this.cancelTail();this.manual=true;this.retryAt=0
  if(this.next.state.id&&(this.autoWorking||this.next.state.status!=='ready')){const id=this.next.state.id;this.selectionRevision++;if(this.autoWorking)p?.cancel();p?.cancelPreparation();this.next.cancelPending();void this.selectOne(id)}
  else if(!this.next.state.id){this.excluded.clear();this.suggest()}
  this.notice='正在准备最近合适的接点，当前歌曲继续播放';this.changed();this.tick()
 }
 mixSoon(){this.requestNext();return this.manualTask??Promise.resolve()}
 async prepare(){if(this.next.state.id){await this.selectOne(this.next.state.id);this.changed()}}
 async apply(audition=false){if(audition)throw Error('请通过实际播放试听本次渐进交接');await this.mixSoon()}
 selectMethod(method:string){if(method!=='original')throw Error('当前自动选择适合这两首歌的交接方案')}
 setExperimentalTransitions(value:boolean){const p=this.player;if(p?.gate.locked||this.pending(p))throw Error('交接完成后再调整手法');p?.setExperimentalTransitions(value);this.selectionRevision++;this.next.clear();if(p?.current){if(this.explicit)void this.selectOne(this.explicit);else this.suggest()}this.changed()}
 private cancelTail(){
  this.tailController?.abort()
  this.tailController=null
  this.tailAttempted=false
 }
 private async prepareTail(p:ListenTransport,from:string){
  const cached=new Set(this.library.values().map(t=>t.id))
  const plays=(id:string)=>this.played.get(id)??0
  const candidates=this.entries().filter(t=>t.id!==from&&t.playStatus==='ready'&&
   (this.explicit?t.id===this.explicit:!this.targetStyle||t.styleLabels.includes(this.targetStyle)))
   .sort((a,b)=>plays(a.id)-plays(b.id)||Number(cached.has(b.id))-Number(cached.has(a.id))||a.id.localeCompare(b.id)).slice(0,3)
  this.tailAttempted=true
  if(!candidates.length)return
  const controller=this.tailController=new AbortController()
  this.selectionRevision++
  this.next.clear()
  p.cancelLivePreparation?.()
  p.cancelPreparation()
  this.notice='正在准备曲尾续播'
  this.changed()
  try{
   for(const {id} of candidates){
    if(controller.signal.aborted||p.current?.id!==from||p.current.duration-p.position<=.15)break
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(TAIL_CANDIDATE_TIMEOUT_MS)])
    const load=async()=>{
     const track=await this.library.load(id)
     signal.throwIfAborted()
     this.pins=[id]
     this.install()
     await p.queueSetContinuation(track,signal,'automatic')
    }
    try{
     await new Promise<void>((resolve,reject)=>{
      const abort=()=>reject(signal.reason)
      signal.addEventListener('abort',abort,{once:true})
      void load().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
     })
     if(controller.signal.aborted)return
     this.notice='将在曲尾续播下一首'
     this.save()
     return
    }catch(error){
     if(!controller.signal.aborted)p.log('auto_native_unavailable',{from,to:id,reason:(error as Error).message})
    }
   }
  }finally{
   if(this.tailController===controller){this.tailController=null;this.changed()}
  }
 }
 private syncCurrent(){
  const p=this.player;if(!p)return;const id=p.current?.id??null
  if(id===this.lastCurrent||p.busy&&!id)return
  const previous=this.lastCurrent;this.cancelTail();this.lastCurrent=id;this.manual=false;this.autoAt=0;this.excluded.clear()
  if(id){this.played.set(id,(this.played.get(id)??0)+1);this.recent.push(id);this.recent=this.recent.slice(-8);if(this.explicit===id)this.explicit=null;if(this.next.state.id===id)this.next.clear();this.notice='正在播放，下一首将在合适接点混入';this.suggest();this.install()}
  else{this.next.clear();p.cancelPreparation();if(p.status==='本段试听已播完')this.notice='歌曲已播完，未能准备下一首'}
  if(previous)this.save()
 }
 tick(){
  const p=this.player;if(!this.alive||!p||this.working)return
  if(this.orderedSet){this.orderedSet.tick();return}
  this.syncCurrent()
  const loopRevision=p.loopExtensionStatus?.revision??0;if(loopRevision>this.seenLoopRevision&&p.current&&!this.pending(p)){this.selectionRevision++;this.next.clear();this.pins=[];this.autoAt=0;p.cancelPreparation();if(this.nextAfterLoop){this.nextAfterLoop=false;this.manual=true;this.retryAt=0}this.suggest()}this.seenLoopRevision=loopRevision
  const returned=p.liveLayeringReturnRevision??0;if(returned>this.seenReturnRevision&&p.current&&!this.pending(p)){this.selectionRevision++;this.next.clear();this.pins=[];this.explicit=null;this.autoAt=0;p.cancelPreparation();this.suggest()}this.seenReturnRevision=returned
  if(!p.current||!p.playing||this.pending(p)||p.busy||this.manualTask||this.tailController)return
  if(this.manual){if(Date.now()>=this.retryAt){if(this.next.state.status==='ready')void this.mix();else if(this.next.state.id&&['failed','idle'].includes(this.next.state.status)){this.retryAt=Date.now()+3000;void this.selectOne(this.next.state.id)}}return}
  if(!this.automatic||this.autoWorking)return
  if(this.loopEnabled){const loop=p.loopExtensionUpcoming;if(loop){const start=loop.approval.startFrame/44100;if(p.position>=start-8&&p.armLoopExtension()){this.selectionRevision++;this.next.clear();this.pins=[];this.notice='已安排器乐循环延长';this.changed();return}else if(start>p.position+.4)return}else if(['ready','failed'].includes(this.next.state.status))void p.prepareLoopExtension()}
  const live=p.liveLayeringUpcoming
  if(live){const start=live.approval.entry.sourcePosition;if(start<=p.position+.4)p.cancelLivePreparation?.();else if(p.position>=start-8){if(p.armLiveLayering?.()){this.selectionRevision++;this.next.clear();this.next.state={id:live.approval.scene.sources.b.trackId,status:'ready',error:''};this.pins=[live.approval.scene.sources.b.trackId];this.install();this.notice='已安排自动长混';this.changed();return}}else return}
  const s=this.next.state,start=p.automaticStart
  const left=p.current.duration-p.position
  if(!this.tailAttempted&&left>1&&left<=TAIL_PREPARATION_SECONDS&&
   !(s.status==='ready'&&start!=null&&start>=p.position+.25)){
   void this.prepareTail(p,p.current.id)
   return
  }
  const action=automaticAction({position:p.position,duration:p.current.duration,playing:p.playing,busy:p.busy,pending:!!this.pending(p),status:s.status,hasSelection:!!s.id,plannedStart:p.automaticStart,futurePreparation:true},this.autoAt)
  if(!action)return;this.autoAt=p.position+(action==='prepare'?12:3)
  if(action==='prepare'){if(this.explicit)void this.selectOne(this.explicit);else this.suggest();return}
  const alternative=()=>{if(this.explicit){this.autoAt=p.current!.duration;this.notice='指定歌曲没有后续可靠接点，请换歌或稍后重试';return}p.log('selection_candidates_exhausted',{ids:[...this.pins],sourcePosition:p.position,reason:s.status==='failed'?'preparation_failed':'no_remaining_prepared_plan',error:s.error});for(const id of s.status==='failed'?this.pins:s.id?[s.id]:[])this.excluded.add(id);this.suggest()}
  if(action==='alternative'){alternative();return}
  this.autoWorking=true;const revision=this.selectionRevision,from=p.current.id
  void this.mix(true).then(()=>{if(this.alive&&revision===this.selectionRevision&&p.current?.id===from&&!this.pending(p))alternative()}).finally(()=>{this.autoWorking=false;this.changed()})
 }
 async seek(position:number){if(this.player?.gate.locked)throw Error('交接完成后可调整播放进度');this.cancelTail();this.manual=false;this.revision++;this.selectionRevision++;this.next.clear();this.orderedSet?.resetPreparation();this.player?.cancelPreparation();await this.player?.seek(position);this.autoAt=0;this.excluded.clear();this.suggest()}
 async pause(){if(this.tailController)this.cancelTail();this.manual=false;this.revision++;this.working=false;const p=this.player;if(p?.busy&&!p.current){p.stop();await p.ctx.suspend()}else if(p&&!p.paused)await p.togglePause();this.save();this.changed()}
 async resume(){const p=await this.ensure();if(p.paused)await p.togglePause();if(this.next.state.id&&this.next.state.status==='idle')void this.selectOne(this.next.state.id);this.autoAt=0;this.changed()}
 async pauseForHost(reason='host-inactive'){this.cacheController?.abort();if(this.tailController)this.cancelTail();this.manual=false;this.revision++;this.working=false;this.selectionRevision++;this.next.cancelPending();this.orderedSet?.resetPreparation();const p=this.player;p?.cancelPreparation();if(p){if(p.busy){if(p.current)p.cancel();else p.stop()}p.paused=!!p.current;await p.ctx.suspend();p.log('mobile_suspend',{reason});this.save()}this.changed()}
 cancel(){if(this.player?.gate.locked)throw Error('交接已开始，暂停可暂停整个时间轴');this.cancelTail();this.manual=false;this.selectionRevision++;this.player?.cancel();this.player?.cancelLivePreparation?.();this.player?.cancelPreparation();this.next.clear();this.autoAt=(this.player?.position??0)+15;this.changed()}
 stop(){this.cancelTail();const set=this.orderedSet;set?.close();this.orderedSet=null;this.revision++;this.sessionRevision++;this.selectionRevision++;this.manual=false;this.working=false;this.next.clear();this.player?.stop();if(set)this.configurePairs();this.lastCurrent=null;this.nextAfterLoop=false;this.played.clear();this.recent=[];this.excluded.clear();this.save();this.changed()}
 setVolume(value:number){if(!Number.isFinite(value))throw Error('音量无效');this.volume=Math.max(0,Math.min(1,value));this.player?.setVolume(this.volume);this.changed()}
 filters(value:{label?:string;query?:string}){this.label=value.label??this.label;this.query=value.query??this.query;this.changed()}
 async refreshLibrary(){
  if(this.orderedSet)return
  const index=await loadListenIndex(this.base,this.read),sources=new TrackLibrary(index.tracks,this.base,this.read)
  const library=new TrackLibrary(index.tracks,this.base,async(path,base)=>{const entry=index.tracks.find(t=>t.detailUrl===path),value=entry?{track:await sources.load(entry.id)}:await this.read(path,base);return value?.track&&this.player?.registerTrack?{...value,track:await this.player.registerTrack(value.track,sourceTargets(index,value.track.id))}:value})
  await refreshLibraryTracks(library,()=>[this.player?.current?.id,this.pending()?.plan.to,this.next.state.id,...this.pins].filter(Boolean) as string[])
  if(!this.alive)return;this.index.tracks=index.tracks;this.index.deviceSourceIds=index.deviceSourceIds;this.index.crossGenreIndex=index.crossGenreIndex;this.index.stemIndex=index.stemIndex;this.index.pairReferences=index.pairReferences;this.index.learnedPairReferences=index.learnedPairReferences;this.index.lyricPairs=index.lyricPairs;this.sources=sources;this.library=library;this.install();const p=this.player
  if(p&&!this.pending(p))p.configureCrossGenre?.(index.crossGenreIndex??null,this.base)
  if(p&&!this.pending(p))p.configureStemMix?.(index.stemIndex??null,this.base)
  if(p&&!this.pending(p)&&!this.orderedSet)this.configurePairs()
  if(this.automatic&&!this.explicit&&p?.current&&!this.pending(p)&&!p.busy&&!p.gate.locked){this.autoAt=0;this.excluded.clear();this.suggest()}
  this.changed()
 }
 async setSession(manifest:unknown,name:string){const revision=++this.sessionRevision,activity=await ActivitySession.open(manifest,name,id=>this.sources.load(id));if(!this.alive||revision!==this.sessionRevision)throw new DOMException('预约载入已取消','AbortError');if(this.player?.gate.locked)throw Error('交接完成后可进入预约');await activity.cacheStrategies?.(this.base);if(!this.alive||revision!==this.sessionRevision)throw new DOMException('预约载入已取消','AbortError');if(this.player?.gate.locked)throw Error('交接完成后可进入预约');this.stop();this.activity=activity;this.player?.setReservation?.(activity);this.notice='预约已载入，使用网页同款渐进交接';this.changed()}
 clearSet(){if(this.player?.gate.locked)throw Error('交接完成后可退出预约');this.sessionRevision++;this.activity=null;this.player?.setReservation?.(null);this.cancel();this.notice='已回到完整网页曲库';this.changed()}
 async cacheSet(manifest:unknown){this.cacheController?.abort();const c=this.cacheController=new AbortController(),session=await ActivitySession.open(manifest,'',id=>this.sources.load(id));if(c.signal.aborted||!this.alive)throw new DOMException('下载已取消','AbortError');this.cachePackId=session.packId;try{return await cacheActivityAssets(session.assets(),this.base,c.signal,p=>{if(this.cacheController===c){this.setCache=p;this.changed()}})}finally{if(this.cacheController===c)this.cacheController=null}}
 get autoPreparationStatus(){return null}
 setAutoPreparationPending(_value:boolean){}
 async prepareAutoSet(_manifest:unknown,_name:string){}
 export(){return {...exportListenAudit(this.player?.export()??{},this.index.tracks),release:LISTEN_RELEASE,selectionPolicy:SESSION_SELECTION_POLICY,playHistory:[...this.played].map(([id,count])=>({id,count})),direction:{automatic:this.automatic,style:this.targetStyle,energy:this.energyLevel,energyApplied:true},activity:this.activity?{packId:this.activity.packId,name:this.activity.name,executionPolicy:LISTEN_RELEASE.executionPolicy}:null,orderedSet:this.orderedSetStatus}}
 save(){if(this.player)this.host?.saveSession(JSON.stringify(this.export()))}
 catalogEntries(){return this.index.tracks.map(t=>({...t,mixReadiness:sourcePublication(t.id,this.index.stemIndex)}))}
 dispose(){this.alive=false;this.stop();this.cacheController?.abort();this.player?.dispose()}
 snapshot(){
  const p=this.player,s=this.next.state,live=p?.liveLayeringPending?.prepared??p?.liveLayeringUpcoming,liveStatus=p?.liveLayeringStatus??{enabled:this.liveEnabled,state:this.liveEnabled?'idle':'disabled',reason:'',outcome:this.liveOutcome,duration:undefined},selectedId=live?.approval.scene.sources.b.trackId??this.pending(p)?.plan.to??s.id,matched=(q:Plan|null|undefined)=>q?.from===p?.current?.id&&q?.to===selectedId?q:null
  const nextDisplayId=this.pending(p)?.plan.to??live?.approval.scene.sources.b.trackId??(s.status==='ready'?s.id:null)
  const plan=matched(p?.pending?.plan)??matched(p?.upcomingPlan)??matched(p?.lastSearch?.best),rawCross=p?.crossGenrePending?.plan??p?.upcomingCrossPlan,cross=rawCross?.from===p?.current?.id&&rawCross?.to===s.id?rawCross:null
  const comparison=p?.stemComparison?.(selectedId),strategyComparison=live?{...comparison,state:liveStatus.state,reason:liveStatus.reason,recommended:'longmix',methods:{...comparison?.methods,longmix:{name:liveStatus.outcome==='return-a'?'临时叠加后回原曲':'两来源自动长混',eligible:true,score:null,reason:liveStatus.reason}} as Record<string,any>,experimental:true}:comparison,method=p?.pairReferencePlan?.id===plan?.id&&plan?'dj-pair-reference':p?.loopExtensionPending?'loop-extension':live?'longmix':cross?.family??strategyComparison?.recommended??'original',cue=live?{start:live.approval.entry.sourcePosition,end:p?.liveLayeringPending?.plan.end??live.approval.entry.sourcePosition+(liveStatus.duration??live.approval.scene.duration),bStart:live.approval.scene.clips.bStart,bEnd:live.approval.scene.clips.bStart+(p?.liveLayeringPending?p.liveLayeringPending.end-p.liveLayeringPending.start:liveStatus.duration??live.approval.scene.duration)*live.approval.scene.rate}:cross?{start:cross.start,end:cross.end,bStart:cross.entry,bEnd:cross.entry}:plan?{start:plan.start,end:plan.end,bStart:plan.window.start,bEnd:plan.window.end}:null
  const currentReadiness=p?.current?sourcePublication(p.current.id,this.index.stemIndex):null,selectedReadiness=selectedId?sourcePublication(selectedId,this.index.stemIndex):null
  const evaluating=s.status==='loading'||['preparing','selecting'].includes(strategyComparison?.state??''),methodStatus=method!=='original'?'selected':evaluating?'evaluating':strategyComparison?.fallback?'fallback':'idle'
  const missing=[['当前歌曲',currentReadiness],['下一首',selectedReadiness]] as const
  const publicationGap=missing.find(([,r])=>r&&r.state!=='published')
  const reason=method==='dj-pair-reference'?'DJ 曲对参考 · Jetson 已复核，手机按两首原曲实时交接':method!=='original'?`${strategyComparison?.methods?.[method]?.name??method} · ${strategyComparison?.reason??'按当前音乐证据选择'}`:evaluating?(['preparing','selecting'].includes(strategyComparison?.state??'')?strategyComparison?.reason:'')||'正在评估接点与混音手法，当前音乐继续播放':publicationGap?`${publicationGap[0]}：${publicationGap[1]!.label}。${publicationGap[1]!.reason}；仍可提前准备通过拍点、人声及 EQ 检查的原渐混。`:strategyComparison?.reason||'分轨已发布，等待当前曲对、接点及本机素材核验'
  const profiles=new Map(this.index.stemIndex?.tracks.map(t=>[t.trackId,t]))
  return {release:LISTEN_RELEASE,loopExtension:p?.loopExtensionStatus??{enabled:this.loopEnabled,cycles:this.loopCycles},sessionContinuity:p?.sessionContinuity??{enabled:this.continuityEnabled},liveLayering:liveStatus,catalog:{total:this.index.tracks.length,playable:this.index.tracks.filter(t=>t.playStatus==='ready').length,mixable:this.index.tracks.filter(t=>t.mixStatus==='ready').length,stemProfiles:this.index.stemIndex?this.index.tracks.filter(t=>profiles.has(t.id)).length:null,stemPublished:this.index.stemIndex?this.index.tracks.filter(t=>t.playStatus==='ready'&&profiles.get(t.id)?.assetsReady).length:null,crossGenrePrepared:this.index.crossGenreIndex?.tracks.length??0},currentReadiness,selectedReadiness,activitySet:this.activity?{packId:this.activity.packId,name:this.activity.name,trackCount:this.activity.ids.size,executionPolicy:LISTEN_RELEASE.executionPolicy}:null,cache:this.setCache?{packId:this.cachePackId,...this.setCache}:null,selected:selectedId,nextDisplayId,label:this.label,query:this.query,volume:this.volume,working:this.working||s.status==='loading',notice:this.error||(s.status==='failed'?s.error:this.notice),automatic:this.automatic,energyLevel:this.energyLevel,targetStyle:this.targetStyle,energyApplied:true,phase:this.pending(p)?'armed':this.tailController?'tail-loading':p?.status==='本段试听已播完'?'ended':s.status,nearbyWorking:!!this.manualTask,canArm:false,result:null,method,methodStatus,
   strategyComparison,
   recommendation:selectedId?{title:this.index.tracks.find(t=>t.id===selectedId)?.title,cue,reason}:null,
   warm:{state:s.status==='loading'?'preparing':s.status==='ready'?'ready':'idle',ready:s.status==='ready'?[{from:p?.current?.id,to:selectedId,start:cue?.start??p?.automaticStart,end:cue?.end,method}]:[],sourcePosition:p?.position??0}}
 }
}
