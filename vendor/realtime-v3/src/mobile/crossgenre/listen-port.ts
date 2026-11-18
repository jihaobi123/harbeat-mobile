import {ListenReservationAudioCache as AudioCache} from '../listen-reservation-cache'
import type {LiveTransport} from '../../listen-upstream/realtime/transport'
import type {Track} from '../../listen-upstream/realtime/planner'
import {scheduleNativeGraph} from '../competition/native-graph'
import type {CrossPlan} from './planner'
import type {CrossPort,CrossDeck} from './lifecycle'
import {protectSourceBoundary} from './source-boundary'
import type {PreparedExit} from '../competition/exit-audio'

type Host=Pick<LiveTransport,'ctx'|'cache'|'active'|'tracks'|'position'|'playing'|'busy'|'status'|'gate'|'log'|'cancelPreparation'>
/** Narrow version-pinned seam. No legacy Plan or old scheduler is involved. */
type ListenSeam={monitor:AudioWorkletNode;graph:(track:Track,at:number,offset:number)=>CrossDeck;nativeSource:(deck:CrossDeck,buffer:AudioBuffer,at:number,offset:number,edge:boolean)=>void;retire:(deck:CrossDeck,fade:boolean)=>void;protected:()=>void}
export function createListenCrossPort(host:Host,base:URL,notify:()=>void,energy=()=>3,extra:{buffer?:(p:CrossPlan)=>AudioBuffer|undefined;exit?:(p:CrossPlan)=>PreparedExit|undefined}={}):CrossPort{
 const seam=host as unknown as ListenSeam
 // A separate pool owner retains B even when the pinned transport rebuilds its
 // own protection set. Stop/seek cannot clear A or legacy preparation pins.
 const cache=new AudioCache(host.ctx,base,()=>{},host.cache.pool)
 return{ctx:host.ctx,cache,energy,active:()=>host.active,position:()=>host.position,playing:()=>host.playing,tracks:()=>host.tracks,
  setBusy:value=>host.busy=value,setLocked:value=>host.gate.locked=value,status:value=>host.status=value,notify,
  log:(kind,data)=>host.log(kind,data),
  createDeck:(track,at,offset,buffer)=>{
   if(typeof seam.graph!=='function'||typeof seam.nativeSource!=='function')throw Error('当前播放器不支持独立跨风格执行')
   const deck=seam.graph(track,at,offset);deck.gain.gain.value=0
   try{seam.nativeSource(deck,buffer,at,offset,true);return deck}catch(error){seam.retire(deck,false);throw error}
  },
  retire:deck=>seam.retire(deck,false),
  commit:(deck,plan,at)=>{
   const old=host.active;if(!old||old.track.id!==plan.from||deck.track.id!==plan.to)throw Error('跨风格接管歌曲已经变化')
   host.active=deck;deck.at=at;deck.offset=plan.entry;host.cancelPreparation();seam.retire(old,false);seam.protected()
   host.log('handoff_state_commit',{planId:plan.id,to:deck.track.id,bodySourceOffset:plan.entry,scheduledContextSec:at,transitionFamily:plan.family})
  },
  schedule:(source,deck,plan,at)=>{
   if(!source.nodes[0]||!seam.monitor)throw Error('跨风格音频通道尚未就绪')
   const graph=scheduleNativeGraph(host.ctx,source.nodes[0],source.gain.gain,deck.gain.gain,seam.monitor,plan,at,extra.buffer?.(plan),extra.exit?.(plan))
   const restore=protectSourceBoundary(source,source.at+plan.exit-source.offset),disarm=()=>seam.monitor.port.postMessage({kind:'cancel',planId:plan.id})
   seam.monitor.port.postMessage({kind:'arm',events:[...(plan.fx?[{name:'手机退出效果开始 / '+plan.family,frame:Math.round((source.at+plan.start-source.offset)*host.ctx.sampleRate),planId:plan.id,requestId:plan.family}]:[]),...(plan.bridge?[{name:'旧歌退出 / 鼓桥起播',frame:Math.round((source.at+plan.exit-source.offset)*host.ctx.sampleRate),planId:plan.id,requestId:plan.family}]:[]),{name:plan.bridge?'鼓桥结束 / 新歌原速起播':'旧歌退出 / 新歌原速起播',frame:Math.round(at*host.ctx.sampleRate),planId:plan.id,requestId:plan.family}]})
   return{end:graph.end,cancel:()=>{disarm();restore();graph.cancel()},dispose:()=>{disarm();restore();graph.dispose()}}
  }}
}
