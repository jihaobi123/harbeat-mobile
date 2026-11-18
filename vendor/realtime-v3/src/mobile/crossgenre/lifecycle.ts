import type {Track} from '../../listen-upstream/realtime/planner'
import type {LiveTransport} from '../../listen-upstream/realtime/transport'
import type {AudioCache} from '../../listen-upstream/realtime/cache'
import {nativeSegments} from '../../listen-upstream/continuous/segments'
import {sourceMatches,type CrossProfile} from './contract'
import type {CrossGenreClient} from './client'
import {planCrossGenre,enumerateCrossGenre,nativeTakeover,type CrossPlan} from './planner'
import {canonicalJson} from '../jetson-contract'
import type {CrossGraph} from './graph'

export type CrossDeck=NonNullable<LiveTransport['active']>
export type CrossPort={ctx:AudioContext;cache:Pick<AudioCache,'load'|'protected'|'dispose'>;energy?:()=>number;active:()=>CrossDeck|null;position:()=>number;playing:()=>boolean;tracks:()=>Track[];setBusy:(v:boolean)=>void;setLocked:(v:boolean)=>void;status:(s:string)=>void;notify:()=>void;log:(kind:string,data:Record<string,unknown>)=>void;createDeck:(track:Track,at:number,offset:number,buffer:AudioBuffer)=>CrossDeck;retire:(deck:CrossDeck)=>void;commit:(deck:CrossDeck,plan:CrossPlan,at:number)=>void;schedule:(source:CrossDeck,deck:CrossDeck,plan:CrossPlan,at:number)=>CrossGraph}
type Ready={automatic:boolean;source:CrossDeck;track:Track;ap:CrossProfile;bp:CrossProfile;plan:CrossPlan}
export type CrossPending={plan:CrossPlan;deck:CrossDeck;source:CrossDeck;start:number;end:number;graph:CrossGraph;automatic:boolean}
const aborted=()=>new DOMException('跨风格准备已取消','AbortError')

/** Separate lifecycle; the pinned beatmatched Plan and scheduler stay intact. */
export class CrossGenreSession{
 pending:CrossPending|null=null
 private prepared:Ready|null=null
 private preparation:AbortController|null=null
 private requestLoad:AbortController|null=null
 private busyOwner:symbol|null=null
 private revision=0
 private tails:{graph:CrossGraph;end:number}[]=[]
 constructor(private port:CrossPort,private client:Pick<CrossGenreClient,'load'>,private extensions:{validate?:(plan:CrossPlan,a:Track,b:Track,ap:CrossProfile,bp:CrossProfile)=>void;prepare?:(plan:CrossPlan,signal:AbortSignal)=>Promise<void>;pins?:(plan:CrossPlan)=>string[]}={}){}
 get automaticStart(){return this.prepared?.automatic&&this.prepared?.source===this.port.active()?this.prepared?.plan.start??null:null}
 get upcoming(){return this.prepared?.source===this.port.active()?this.prepared?.plan??null:null}
 private pins(){
  const urls=new Set<string>()
  if(this.prepared)for(const s of this.assets(this.prepared.track,this.prepared.plan.entry))urls.add(s.asset.url)
  if(this.pending)for(const url of this.pending.deck.stream?.pins??[])urls.add(url)
  for(const p of [this.prepared?.plan,this.pending?.plan])if(p)for(const url of this.extensions.pins?.(p)??[])urls.add(url)
  this.port.cache.protected=urls
 }
 private assets(track:Track,entry:number){return nativeSegments(track).filter(s=>s.end>entry&&s.start<Math.min(track.duration,entry+16))}
 cancelPreparation(preserveReady=false){const keep=preserveReady&&!this.preparation&&!this.requestLoad&&this.prepared?.source===this.port.active();this.revision++;this.preparation?.abort();this.requestLoad?.abort();this.preparation=null;this.requestLoad=null;if(!keep)this.prepared=null;this.pins()}
 async prepare(ids:string[],automatic=false,budget=60):Promise<string>{
  this.cancelPreparation();const source=this.port.active()
  if(!source)throw Error('请先播放当前歌曲')
  const token=this.revision,controller=this.preparation=new AbortController(),signal=controller.signal
  const check=()=>{signal.throwIfAborted();if(this.revision!==token||this.port.active()!==source)throw aborted()}
  try{
   const ap=await this.client.load(source.track,signal);check()
   const choices:Ready[]=[]
   for(const track of this.port.tracks().filter(t=>ids.includes(t.id)&&t.id!==source.track.id)){
    try{
     const bp=await this.client.load(track,signal);check();const position=this.port.position()
     const energy=this.port.energy?.()??3
     const plan=planCrossGenre(source.track,track,ap,bp,position,automatic?source.track.duration-position-.5:budget,energy,{automatic})
     if(plan)choices.push({automatic,source,track,ap,bp,plan})
    }catch(error){check();this.port.log('crossgenre_candidate_unavailable',{trackId:track.id,reason:(error as Error).message})}
   }
   choices.sort((a,b)=>b.plan.score-a.plan.score||a.plan.exit-b.plan.exit||a.track.id.localeCompare(b.track.id))
   for(const ready of choices){
    check()
    try{
     this.prepared=ready;this.pins()
     for(const s of this.assets(ready.track,ready.plan.entry)){await this.port.cache.load(s.asset,signal);check()}
     if(ready.plan.start<this.port.position()+.5){this.prepared=null;continue}
     this.port.log('crossgenre_preparation_ready',{plan:ready.plan,automatic,renderRequested:false})
     this.port.status('跨风格素材已准备，将在段落接点衔接');this.port.notify();return ready.track.id
    }catch(error){check();this.prepared=null;this.pins();this.port.log('crossgenre_audio_unavailable',{trackId:ready.track.id,reason:(error as Error).message})}
   }
   throw Error('目前没有通过人声、段落和音量检查的跨风格接点，当前歌曲继续播放')
  }finally{if(this.revision===token){this.preparation=null;this.pins()}}
 }
 async preparePlan(plan:CrossPlan,automatic=false){
  this.cancelPreparation();const source=this.port.active(),track=this.port.tracks().find(t=>t.id===plan.to)
  if(!source||!track||source.track.id!==plan.from)throw Error('获胜方案的歌曲已变化')
  const token=this.revision,controller=this.preparation=new AbortController(),signal=controller.signal
  const check=()=>{signal.throwIfAborted();if(token!==this.revision||this.port.active()!==source)throw aborted()}
  try{
   const [ap,bp]=await Promise.all([this.client.load(source.track,signal),this.client.load(track,signal)]);check()
   if(this.extensions.validate)this.extensions.validate(plan,source.track,track,ap,bp)
   else{const original=enumerateCrossGenre(source.track,track,ap,bp,0,source.track.duration).find(p=>p.id===plan.id)
    if(!original||['source','outgoing','incoming','echo','exit','entry','start','end','peakBound','rate'].some(k=>canonicalJson((original as any)[k])!==canonicalJson((plan as any)[k])))throw Error('获胜方案与当前接点资料不一致')}
   if(automatic&&(plan.exit<source.track.duration*.5||plan.start<this.port.position()+.5))throw Error('获胜方案不满足自动保留范围')
   this.prepared={automatic,source,track,ap,bp,plan};this.pins()
   for(const s of this.assets(track,plan.entry)){await this.port.cache.load(s.asset,signal);check()}
   await this.extensions.prepare?.(plan,signal);check()
   if(plan.start<this.port.position()+.5)throw Error('获胜接点在准备期间已过')
   this.port.log('competition_native_prepared',{plan,automatic});return track.id
  }catch(error){if(token===this.revision){this.prepared=null;this.pins()}throw error}
  finally{if(token===this.revision)this.preparation=null}
 }
 requestPlan(plan:CrossPlan,budget=18,automatic=false){return this.request(plan.to,budget,automatic,plan)}
 async request(id:string,budget=18,automatic=false,fixed?:CrossPlan){
  if(this.pending){if(!this.cancel())throw Error('正在跨风格交接，请等待接管完成')}
  const source=this.port.active()
  if(!source||!this.port.playing())throw Error('请先继续播放当前歌曲')
  const owner=this.busyOwner=Symbol('crossgenre-request');this.port.setBusy(true);this.port.notify()
  const started=this.port.ctx.currentTime
  try{
   const reusable=(fixed?this.prepared?.plan===fixed:automatic&&this.prepared?.automatic)&&this.prepared?.source===source&&this.prepared.track.id===id&&this.prepared.plan.start>=this.port.position()+.5
   if(!reusable){if(fixed)await this.preparePlan(fixed,automatic);else await this.prepare([id],automatic,budget)}
   const ready=this.prepared
   if(!ready||ready.source!==source||this.port.active()!==source||!this.port.playing())throw aborted()
   const remaining=budget-(this.port.ctx.currentTime-started)
   let plan=ready.plan
   if(!automatic&&!fixed){const nearest=planCrossGenre(source.track,ready.track,ready.ap,ready.bp,this.port.position(),remaining,this.port.energy?.()??3);if(!nearest)throw Error('准备期间接点已过，当前歌曲继续播放');plan=nearest}
   if(plan.start<this.port.position()+.5||nativeTakeover(plan)-this.port.position()>remaining+.001)throw Error('跨风格接点超出本次等待范围')
   if(!sourceMatches(source.track,plan.source.a)||!sourceMatches(ready.track,plan.source.b))throw Error('跨风格来源已变化')
   const assets=this.assets(ready.track,plan.entry),controller=this.requestLoad=new AbortController(),signal=controller.signal
   // Selection may use a different incoming cue after preparation. Re-load under
   // the same revision; stop/seek/new selection must invalidate every await.
   const token=this.revision;this.prepared={...ready,plan};this.pins()
   const buffers=[]
   for(const s of assets){buffers.push(await this.port.cache.load(s.asset,signal));signal.throwIfAborted();if(token!==this.revision||this.port.active()!==source||!this.port.playing())throw aborted();if(!sourceMatches(source.track,plan.source.a)||!sourceMatches(ready.track,plan.source.b))throw Error('跨风格来源在准备期间变化')}
   const at=source.at+nativeTakeover(plan)-source.offset
   if(source.at+plan.start-source.offset<this.port.ctx.currentTime+.05)throw Error('跨风格接点已经过去')
   const deck=this.port.createDeck(ready.track,at,plan.entry,buffers[0])
   let graph:CrossGraph
   try{graph=this.port.schedule(source,deck,plan,at)}catch(error){this.port.retire(deck);throw error}
   this.pending={plan,deck,source,start:source.at+plan.start-source.offset,end:at,graph,automatic}
   this.prepared=null;this.pins();this.port.log('crossgenre_plan_scheduled',{plan,contextStart:this.pending.start,contextHandoff:at,renderRequested:false,nativeB:true})
   this.port.status(plan.family==='echo-out'?'已安排回声收尾和原速接歌':'已安排段落接歌，下一首保持原速');this.port.notify()
  }finally{if(this.busyOwner===owner){this.requestLoad?.abort();this.requestLoad=null;this.busyOwner=null;this.port.setBusy(false);this.port.notify()}}
 }
 tick(){
  const now=this.port.ctx.currentTime
  for(const tail of this.tails)if(now>=tail.end)tail.graph.dispose()
  this.tails=this.tails.filter(t=>now<t.end)
  const p=this.pending;if(!p)return
  if(this.port.active()!==p.source){this.stop();return}
  p.deck.stream?.pump();this.pins()
  // The native scheduler remains responsible for B after takeover. Until B is
  // audible, any known failed/late load or uncovered onset cancels the graph
  // even inside the ordinary user lock window, keeping A playing.
  const stream=p.deck.stream
  if(now<p.end-.012&&stream&&(stream.error||stream.late||stream.deadline<=p.end+.5)){
   const reason=stream.error||(stream.late?'incoming segment late':'incoming onset not covered')
   this.cancel(true);this.port.log('crossgenre_incoming_unavailable',{planId:p.plan.id,reason})
   this.port.status('下一首音频尚未准备好，当前歌曲继续播放');this.port.notify();return
  }
  if(now>=p.start-.15)this.port.setLocked(true)
  if(now>=p.end+.008){
   this.port.commit(p.deck,p.plan,p.end);this.pending=null;this.port.setLocked(false)
   this.tails.push({graph:p.graph,end:p.graph.end});this.pins()
   this.port.log('crossgenre_handoff_complete',{planId:p.plan.id,family:p.plan.family,from:p.plan.from,to:p.plan.to,contextHandoff:p.end,sourceOffset:p.plan.entry+(now-p.end),nativeB:true})
   this.port.status('跨风格交接完成，正在原速播放');this.port.notify()
  }
 }
 cancel(force=false){
  const p=this.pending;if(!p)return true
  if(!force&&this.port.ctx.currentTime>=p.start-.15)return false
  p.graph.cancel();this.port.retire(p.deck);this.pending=null;this.port.setLocked(false)
  this.tails.push({graph:p.graph,end:this.port.ctx.currentTime+.01});this.pins()
  this.port.log('crossgenre_plan_cancelled',{planId:p.plan.id});return true
 }
 stop(){
  this.cancelPreparation()
  if(this.busyOwner){this.busyOwner=null;this.port.setBusy(false)}
  if(this.pending){this.pending.graph.dispose();this.port.retire(this.pending.deck);this.pending=null}
  for(const t of this.tails)t.graph.dispose();this.tails=[];this.port.cache.protected.clear();this.port.setLocked(false)
 }
 dispose(){this.stop();this.port.cache.dispose()}
}
