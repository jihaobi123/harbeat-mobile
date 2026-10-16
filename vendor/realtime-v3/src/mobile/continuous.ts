import {TrackLibrary,readLibraryIndex,filterLibrary,suggestNext,type LibraryEntry,type LibraryIndex} from '../continuous/catalog'
import {NextSelection} from '../continuous/selection'
import {automaticAction} from '../continuous/automatic'
import {loadJson} from '../phrase/load'
import {LiveTransport} from '../realtime/transport'
import {planVocalOverlap} from '../vocal-overlap/planner'
import type {Track} from '../realtime/planner'
import {MobileSession,type Host} from './session'

export const CONTINUOUS_RELEASE={version:'2026.09.24',id:'continuous-live-20260924',acceptedArm:'vocal-overlap',acceptedSourceCommit:'c81525d90b20e9b48d0bfc1dc8e3a8c12668c6bf'}
const fullIndex='/analysis-lab-static/continuous-live-20260924/library.json'
export async function loadContinuousIndex(base:URL):Promise<LibraryIndex>{
 try{
  const response=await fetch(new URL(fullIndex,base),{signal:AbortSignal.timeout(12000)})
  if(!response.ok)throw Error('完整曲库尚未上线')
  const index=readLibraryIndex(await response.json())
  if(!index.tracks.some(t=>t.playStatus==='ready'))throw Error('完整曲库尚未准备好')
  return index
 }catch{
  return readLibraryIndex(await loadJson('continuous/library.json',base))
 }
}

/** Mobile control adapter for the upstream continuous player; planner and DSP stay byte-identical. */
export class ContinuousRun {
 readonly library:TrackLibrary;readonly session:MobileSession;readonly next:NextSelection
 automatic=true;volume=.85;notice='';collection='';label='';query=''
 starting=false
 private alive=true;private revision=0;private currentId:string|null=null;private recent:string[]=[]
 private excluded=new Set<string>();private autoAt=0;private autoWorking=false;private selectionRevision=0
 private runtimeTracks:Track[]=[]
 constructor(readonly index:LibraryIndex,base:URL,private changed:()=>void,host?:Host,read=loadJson){
  this.library=new TrackLibrary(index.tracks,base,read)
  this.session=new MobileSession(this.runtimeTracks,changed,base,host,(t,u,b)=>new LiveTransport(t,u,b,{
   planner:planVocalOverlap,autoNext:false,prewarm:false,policyVersion:'vocal-overlap-v1',release:CONTINUOUS_RELEASE,
   noPlanMessage:'附近没有合适的交接点，当前歌曲会继续播放。稍后重试或选择另一首。',
  }))
  this.next=new NextSelection(id=>this.library.load(id),{install:()=>this.install(),prepare:id=>{
   if(!this.session.player)throw Error('请先开始播放')
   return this.session.player.prepareNext(id)
  }},()=>changed())
 }
 private install(){
  const p=this.session.player
  this.library.trim(new Set([p?.current?.id,p?.pending?.plan.to,this.next.state.id].filter(Boolean) as string[]))
  this.runtimeTracks.splice(0,this.runtimeTracks.length,...this.library.values())
  if(p)p.tracks=[...this.runtimeTracks]
 }
 async start(id:string){
  const revision=++this.revision;this.starting=true;this.next.clear();this.session.player?.cancelPreparation();this.notice='正在准备歌曲…';this.changed()
  try{
   await this.library.load(id)
   if(!this.alive||revision!==this.revision)return
   this.install();await this.session.start(id)
   if(!this.alive||revision!==this.revision)return
   this.session.player?.setVolume(this.volume);this.notice='';this.tick()
  }finally{if(revision===this.revision){this.starting=false;this.changed()}}
 }
 choose(id:string,automatic=false){
  const p=this.session.player;if(!p?.current||id===p.current.id)return
  this.selectionRevision++;this.notice=''
  if(!automatic){this.excluded.clear();this.autoAt=p.position+Math.min(12,Math.max(0,p.current.duration-p.position-22))}
  if((p.pending||p.busy)&&!p.gate.locked)p.cancel()
  p.cancelPreparation();void this.next.select(id,{defer:!!p.pending&&p.gate.locked})
 }
 private suggest():LibraryEntry|null {
  const p=this.session.player,entry=this.index.tracks.find(t=>t.id===p?.current?.id)
  if(!entry)return null
  return suggestNext(filterLibrary(this.index.tracks,{collection:this.collection,label:this.label}).filter(t=>!this.excluded.has(t.id)),entry,this.recent.slice(-8))
 }
 filters(value:{collection?:string;label?:string;query?:string}){
  this.collection=value.collection??this.collection;this.label=value.label??this.label;this.query=value.query??this.query
  this.autoAt=0;this.excluded.clear();this.changed()
 }
 async mix(origin='continuous_user'){
  const p=this.session.player,id=this.next.state.id;if(!p?.playing||!id)return
  if(this.next.state.status!=='ready')throw Error('下一首尚未准备好，当前歌曲继续播放')
  this.notice='';await p.request({kind:'next',targetId:id},18,{origin})
  if(!p.pending)this.notice=p.status
  this.changed()
 }
 tick(){
  const p=this.session.player;if(!this.alive||!p)return
  const id=p.current?.id??null
  if(id!==this.currentId&&!(!id&&p.busy)){
   const previous=this.currentId;this.currentId=id;this.autoAt=0;this.excluded.clear()
   if(id){this.recent.push(id);this.notice=''
    if(this.next.state.id&&this.next.state.id!==id)this.choose(this.next.state.id)
    else {const pick=this.suggest();if(pick)this.choose(pick.id,true);else this.next.clear()}
    this.install()
   }else {this.next.clear();p.cancelPreparation()}
   if(previous)this.session.save()
  }
  if(!this.automatic||!p.current||this.autoWorking)return
  const action=automaticAction({position:p.position,duration:p.current.duration,playing:p.playing,busy:p.busy,pending:!!p.pending,status:this.next.state.status,hasSelection:!!this.next.state.id},this.autoAt)
  if(!action)return
  this.autoAt=p.position+(action==='prepare'?12:3)
  if(action==='prepare'&&this.next.state.id){this.choose(this.next.state.id,true);return}
  const alternative=()=>{
   if(this.next.state.id)this.excluded.add(this.next.state.id)
   const pick=this.suggest()
   if(pick){this.choose(pick.id,true);this.notice='正在准备另一首可衔接的歌曲。'}
   else{this.autoAt=p.current?.duration??Infinity;this.notice='曲尾没有找到合适的下一首，可以扩大筛选范围。'}
  }
  if(action==='alternative'){alternative();return}
  this.autoWorking=true;const from=id,revision=this.selectionRevision
  void this.mix('continuous_end_auto').then(()=>{if(this.alive&&revision===this.selectionRevision&&p.current?.id===from&&!p.pending)alternative()}).catch(e=>{if(this.alive)this.notice=(e as Error).message}).finally(()=>{this.autoWorking=false;this.changed()})
 }
 async seek(position:number){const p=this.session.player;if(!p)return;const selected=this.next.state.id;this.autoAt=0;this.excluded.clear();await p.seek(position);if(selected)this.choose(selected)}
 cancel(){const p=this.session.player;if(p?.gate.locked){this.notice='当前交接已经开始，不能中途取消';this.changed();return}this.selectionRevision++;this.next.clear();p?.cancel();p?.cancelPreparation();this.autoAt=(p?.position??0)+15;this.changed()}
 setVolume(value:number){if(!Number.isFinite(value))throw Error('音量无效');this.volume=Math.min(1,Math.max(0,value));this.session.player?.setVolume(this.volume);this.changed()}
 setAutomatic(value:boolean){this.automatic=value;this.autoAt=0;this.changed()}
 pauseForHost(){this.revision++;this.starting=false;this.session.player?.cancelPreparation()}
 stop(){this.revision++;this.starting=false;this.selectionRevision++;this.next.clear();this.session.stop();this.currentId=null;this.notice='';this.changed()}
 dispose(){this.alive=false;this.revision++;this.next.clear();this.session.dispose()}
 snapshot(){return {release:CONTINUOUS_RELEASE,coverage:this.index.coverage??{},count:this.index.tracks.length,
  preview:this.index.coverage?.source==='published-preview',automatic:this.automatic,volume:this.volume,
  collection:this.collection,label:this.label,query:this.query,selection:{...this.next.state},notice:this.notice}}
}
