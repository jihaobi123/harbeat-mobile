import type {Track} from '../../listen-upstream/realtime/planner'
import type {LiveTransport} from '../../listen-upstream/realtime/transport'
import {nativeSegment} from '../../listen-upstream/continuous/segments'
import type {LiveCatalog,LivePrepared} from './live-catalog'
import {verifyLiveTracks,approvedExits,continuationPosition,outcomeOf,type LiveOutcome} from './live-contract'
import type {Exit} from './contract'
import type {LivePlaybackGraph} from './multi-graph'
type Deck=NonNullable<LiveTransport['active']>
export type LivePending={plan:{id:string;from:string;to:string;start:number;end:number;entry:number;family:'longmix'};attachedTrackId:string;source:Deck;deck:Deck;start:number;end:number;automatic:true;graph:LivePlaybackGraph;prepared:LivePrepared;restore:()=>void;sourceStopped:boolean}
export type LivePort={ctx:AudioContext;active:()=>Deck|null;position:()=>number;playing:()=>boolean;available:()=>boolean;tracks:()=>Track[];notify:()=>void;log:(kind:string,data:Record<string,unknown>)=>void;status:(value:string)=>void;locked:(value:boolean)=>void;protect:(urls:Set<string>)=>void;createBody:(ready:LivePrepared,e:Exit,at:number)=>Deck;retire:(deck:Deck)=>void;commit:(deck:Deck,pending:LivePending)=>void;schedule:(ready:LivePrepared,source:Deck,at:number)=>LivePlaybackGraph;detach:(source:Deck,at:number)=>()=>void;silence?:(source:Deck)=>void}
export class LiveSession{
 enabled=false;pending:LivePending|null=null
 returnRevision=0;private attachments:{sceneId:string;attached:string;aPosition:number}[]=[];private used=new Set<string>()
 private prepared:{ready:LivePrepared;source:Deck}|null=null;private controller:AbortController|null=null;private revision=0;private state='disabled';private reason='自动长混已关闭';private exiting=false;private tails:{pending:LivePending;until:number}[]=[];private loaded=false;private loading:Promise<void>|null=null
 constructor(private port:LivePort,private catalog:Pick<LiveCatalog,'load'|'candidates'|'prepare'|'dispose'>,readonly outcome:LiveOutcome='takeover-b'){}
 get upcoming(){return this.prepared?.source===this.port.active()?this.prepared.ready:null}
 initialize(){
  if(this.loaded)return Promise.resolve()
  return this.loading??=this.catalog.load(new AbortController().signal)
   .then(()=>{this.loaded=true}).finally(()=>{this.loading=null})
 }
 candidateIds(targets:Track[]){const a=this.port.active();return a?this.catalog.candidates(a.track,targets,this.port.position()).filter(r=>!this.used.has(r.id)).map(r=>r.to):[]}
 setEnabled(value:boolean){this.enabled=value;if(!value){this.cancelPreparation();if(this.pending){if(!this.cancel())this.requestExit()}else{this.state='disabled';this.reason='自动长混已关闭，沿用普通混音'}}else if(!this.pending){this.state='idle';this.reason='正常播放时寻找适合共同播放的音乐'}this.port.notify()}
 cancelPreparation(){this.revision++;this.controller?.abort();this.controller=null;this.prepared?.ready.release();this.prepared=null;if(!this.pending){this.state=this.enabled?'idle':'disabled';this.reason=this.enabled?'等待当前曲目的长混准备':'自动长混已关闭'}}
 async warm(ids:string[]){
  if(!this.enabled||this.pending||!this.port.active())return
  this.cancelPreparation();const source=this.port.active()!,revision=this.revision,c=this.controller=new AbortController();this.state='preparing';this.reason='正在预热适合共同播放的声部';this.port.notify()
  const check=()=>{c.signal.throwIfAborted();if(revision!==this.revision||source!==this.port.active()||!this.enabled)throw new DOMException('长混准备已取消','AbortError')}
  let ready:LivePrepared|null=null
  try{await this.initialize();check();const targets=this.port.tracks().filter(t=>ids.includes(t.id)),rows=this.catalog.candidates(source.track,targets,this.port.position()).filter(r=>!this.used.has(r.id));if(!rows.length){this.state='unavailable';this.reason='当前候选没有未来可用的获准长混场景，沿用普通混音';return}
   let failure:unknown
   for(const row of rows.slice(0,2)){try{const b=targets.find(t=>t.id===row.to)!;ready=await this.catalog.prepare(row,source.track,b,this.port.position,c.signal);check();this.prepared={ready,source};ready=null;this.state='ready';this.reason='长混声部已准备，将在合适位置自动加入';this.port.log('longmix_ready',{sceneId:this.upcoming!.approval.id,from:source.track.id,to:b.id,start:this.upcoming!.approval.entry.sourcePosition});return}catch(error){ready?.release();ready=null;check();failure=error}}
   throw failure??Error('长混素材未就绪')
  }catch(error){if(revision===this.revision){this.state='unavailable';this.reason=(error as Error).name==='AbortError'?'当前歌曲已变化，撤销旧长混准备':'长混准备未完成：'+(error as Error).message+'；沿用普通混音';this.port.log('longmix_preparation_unavailable',{reason:this.reason})}}
  finally{if(this.controller===c)this.controller=null;this.port.notify()}
 }
 arm(){
  const r=this.prepared,ready=this.upcoming,source=this.port.active();if(!r||!ready||!source||!this.enabled||!this.port.playing()||!this.port.available()||this.pending)return false
  const position=this.port.position(),s=ready.approval.scene,anchor=ready.approval.entry.sourcePosition
  if(anchor<position+.4){this.cancelPreparation();this.reason='长混入口已过，沿用普通混音';return false}
  let deck:Deck|undefined,graph:LivePlaybackGraph|undefined,restore=()=>{}
  try{const b=this.port.tracks().find(t=>t.id===s.sources.b.trackId);if(!b)throw Error('长混目标已变化');verifyLiveTracks(ready.approval,source.track,b);if(outcomeOf(ready.approval)!==this.outcome)throw Error('已批准结局与当前模式不匹配')
   const at=this.port.ctx.currentTime+(anchor-position),exit=(ready.exits??approvedExits(ready.approval)).at(-1)!;deck=this.port.createBody(ready,exit,at+exit.at);graph=this.port.schedule(ready,source,at);restore=this.port.detach(source,at)
   this.pending={plan:{id:ready.approval.id,from:source.track.id,to:ready.target.id,start:anchor,end:anchor+exit.at,entry:continuationPosition(ready.approval,exit),family:'longmix'},attachedTrackId:b.id,source,deck,start:at,end:at+exit.at,automatic:true,graph,prepared:ready,restore,sourceStopped:false};this.prepared=null;this.state='armed';this.reason=this.outcome==='return-a'?'已安排临时叠加，完成后回到原曲':'已安排自动长混，随后由下一首完整接管';this.exiting=false;this.pins()
   this.port.log('longmix_scene_scheduled',{sceneId:ready.approval.id,sourcePosition:position,sourceAnchor:anchor,contextStart:at,contextHandoff:at+exit.at,scene:s,multiApproval:ready.multi?.approval,roleApproval:ready.roles?.approval,sourceCount:2+Object.keys(ready.roles?.approval.sources??ready.multi?.approval.sources??{}).length,liveEvidence:ready.approval.evidence,nativeGain:ready.approval.nativeGain,renderRequested:false});this.port.status(this.reason);this.port.notify();return true
  }catch(error){restore();graph?.cancel();if(deck)this.port.retire(deck);this.cancelPreparation();this.state='unavailable';this.reason='长混未启动：'+(error as Error).message+'；普通混音继续';this.port.log('longmix_arm_failed',{reason:this.reason});this.port.notify();return false}
 }
 requestExit(){const p=this.pending;if(!p)return false;if(this.exiting)return true;const e=p.graph.nextExit();if(!e){this.reason='保持已安排的最终安全出口';this.port.notify();return false}let deck:Deck|undefined
  try{deck=this.port.createBody(p.prepared,e,p.start+e.at);p.graph.setExit(e);this.port.retire(p.deck);p.deck=deck;p.end=p.start+e.at;p.plan={...p.plan,end:p.plan.start+e.at,entry:continuationPosition(p.prepared.approval,e)};this.exiting=true;this.reason='将在下一个批准点结束长混，保留完整唱句';this.pins();this.port.notify();return true}catch(error){if(deck)this.port.retire(deck);this.port.log('longmix_exit_unavailable',{reason:(error as Error).message});return false}}
 private pins(){this.port.protect(new Set(this.pending?[...this.pending.prepared.bodyBuffers.keys(),...this.pending.deck.stream?.pins??[]]:[]))}
 tick(){
  const now=this.port.ctx.currentTime;for(const t of this.tails)if(now>=t.until){t.pending.graph.stop();t.pending.prepared.release()}this.tails=this.tails.filter(t=>now<t.until)
  const p=this.pending;if(!p)return;if(this.port.active()!==p.source){this.stop();return}
  p.deck.stream?.pump();this.pins();if(now>=p.start-.15)this.port.locked(true)
  if(now>=p.start+.008&&!p.sourceStopped){p.sourceStopped=true;this.port.silence?.(p.source)}
  if(now>=p.end+.008){try{this.port.commit(p.deck,p)}catch(error){this.port.log('longmix_commit_failed',{sceneId:p.plan.id,reason:(error as Error).message});this.stop();this.state='unavailable';this.reason='长混接管状态变化，请重新选择播放';this.port.status(this.reason);this.port.notify();return}this.pending=null;p.restore();this.port.locked(false);this.tails.push({pending:p,until:p.end+.02});this.state=this.enabled?'idle':'disabled';this.reason=this.outcome==='return-a'?'临时叠加完成，原曲继续播放':'长混交接完成，下一首继续完整播放';this.pins();const data={sceneId:p.prepared.approval.id,from:p.plan.from,to:p.plan.to,contextHandoff:p.end,continuation:'native-stream',roleId:p.prepared.roles?.approval.id,replacementMode:p.prepared.roles?.approval.mode,sourceCount:2+Object.keys(p.prepared.roles?.approval.sources??p.prepared.multi?.approval.sources??{}).length};if(this.outcome==='return-a'){this.returnRevision++;this.used.add(p.plan.id);this.attachments.push({sceneId:p.plan.id,attached:p.attachedTrackId,aPosition:p.plan.entry});this.attachments=this.attachments.slice(-32);this.port.log('longmix_return_complete',{...data,attached:p.attachedTrackId,aPosition:p.plan.entry})}else this.port.log('longmix_handoff_complete',{...data,bPosition:p.plan.entry});this.port.status(this.reason);this.port.notify()}
 }
 cancel(){const p=this.pending;if(!p)return true;if(this.port.ctx.currentTime>=p.start-.15)return false;p.restore();p.graph.cancel();this.port.retire(p.deck);p.prepared.release();this.pending=null;this.port.locked(false);this.pins();return true}
 stop(){this.cancelPreparation();if(this.pending){const p=this.pending;this.pending=null;p.restore();p.graph.stop();this.port.retire(p.deck);p.prepared.release()}for(const t of this.tails){t.pending.graph.stop();t.pending.prepared.release()}this.tails=[];this.used.clear();this.attachments=[];this.port.locked(false);this.pins();this.state=this.enabled?'idle':'disabled'}
 snapshot(){const p=this.pending,r=p?.prepared??this.upcoming,duration=r?(r.exits??approvedExits(r.approval)).at(-1)!.at:undefined;return{enabled:this.enabled,outcome:this.outcome,returnRevision:this.returnRevision,attachments:[...this.attachments],state:p?(this.exiting?'exiting':this.port.ctx.currentTime>=p.start?'playing':'armed'):this.state,reason:this.reason,prepared:!!r,sceneId:r?.approval.id,multiId:r?.multi?.approval.id,roleId:r?.roles?.approval.id,replacementMode:r?.roles?.approval.mode,sourceCount:r?2+Object.keys(r.roles?.approval.sources??r.multi?.approval.sources??{}).length:2,fromTitle:r?.approval.scene.fromTitle,toTitle:r?.approval.scene.toTitle,continuationTitle:r?.target.title,start:p?.plan.start??r?.approval.entry.sourcePosition,end:p?.plan.end??(r?r.approval.entry.sourcePosition+duration!:undefined),duration}}
 dispose(){this.stop();this.catalog.dispose()}
}
