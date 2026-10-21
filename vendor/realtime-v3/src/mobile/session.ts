import {LiveTransport} from '../realtime/transport'
import type {Track} from '../realtime/planner'
export type Host={requestFocus:()=>boolean;saveSession:(text:string)=>void;exportLog:(text:string,format:string)=>void;close:()=>void;prepareMetric?:(text:string)=>string;requestMetric?:(id:number,text:string)=>void;requestPlan?:(id:number,text:string)=>void}
declare global {interface Window {HarBeatHost?:Host}}
/** Host lifecycle is outside the pinned V3 planner/DSP. Never resume on focus gain. */
export class MobileSession {
 player:LiveTransport|null=null;foreground=true;private generation=0;private initializing:Promise<LiveTransport>|null=null
 constructor(private tracks:Track[],private update:()=>void,private base:URL,private host?:Host,private create=(t:Track[],u:()=>void,b:URL)=>new LiveTransport(t,u,b)){}
 private focus(){if(this.host){const granted=this.host.requestFocus();if(granted)this.foreground=true;return granted}return this.foreground}
 async start(id:string){
  if(!this.focus())throw new Error('当前无法取得音频播放权限，请回到前台后重试。')
  const generation=++this.generation
  if(!this.player){
   if(!this.initializing){const p=this.create(this.tracks,this.update,this.base);this.player=p;this.initializing=p.initialize().then(()=>p).catch(e=>{p.dispose();this.player=null;throw e}).finally(()=>{this.initializing=null})}
  }
  if(this.initializing)await this.initializing
  if(!this.foreground||generation!==this.generation)return
  await this.player!.start(id)
  if(!this.foreground)await this.pauseForHost()
 }
 async togglePause(){if(!this.player)return;if(this.player.paused&&!this.focus())throw new Error('请回到前台后再继续播放。');await this.player.togglePause()}
 async pauseForHost(){
  this.foreground=false;this.generation++
  const p=this.player;if(!p)return
  p.paused=!!p.active
  p.cancelPreparation?.()
  // Cancel a pending download so it cannot create a new deck after suspension.
  if(p.busy){if(p.active)p.cancel();else p.stop()}
  if(p.ctx.state!=='closed')await p.ctx.suspend()
  p.paused=!!p.active;p.log('mobile_suspend',{reason:'App background, audio focus loss or headphones disconnected'});p.status=p.active?'已暂停，回到前台后点继续播放':'已暂停准备，请重新开始';this.update();this.save()
 }
 enterForeground(){this.foreground=true;this.update()}
 save(){if(this.player)this.host?.saveSession(JSON.stringify(this.player.export()))}
 stop(){this.generation++;this.player?.stop();this.save()}
 dispose(){this.foreground=false;this.generation++;this.save();this.player?.dispose();this.player=null}
}
