import type {LiveTransport} from '../../listen-upstream/realtime/transport'
import type {Track} from '../../listen-upstream/realtime/planner'
import {nativeSegment} from '../../listen-upstream/continuous/segments'
import {ListenReservationAudioCache} from '../listen-reservation-cache'
import type {LivePrepared} from './live-catalog'
import type {Exit} from './contract'
import {LiveGraph} from './live-graph'
import {MultiGraph,type LivePlaybackGraph} from './multi-graph'
import {RoleGraph} from './role-graph'
import {canonicalJson} from '../jetson-contract'
import type {LivePort,LivePending} from './live-session'
import {continuationPosition,outcomeOf} from './live-contract'
type Deck=NonNullable<LiveTransport['active']>
type Host=Pick<LiveTransport,'ctx'|'cache'|'active'|'position'|'playing'|'tracks'|'busy'|'pending'|'gate'|'status'|'log'|'cancelPreparation'>&{crossGenrePending?:unknown}
type Seam={monitor:AudioWorkletNode;graph:(t:Track,at:number,offset:number)=>Deck;nativeSource:(d:Deck,b:AudioBuffer,at:number,offset:number,edge:boolean)=>void;retire:(d:Deck,fade:boolean)=>void;protected:()=>void}
/** Explicit seam around the pinned native stream; upstream scheduler stays unchanged. */
export function createLivePort(host:Host,base:URL,notify:()=>void):LivePort&{dispose:()=>void}{
 const seam=host as unknown as Seam,cache=new ListenReservationAudioCache(host.ctx,base,()=>{},host.cache.pool),detached=new WeakMap<Deck,{stopped:boolean}>()
 const markers=(ready:LivePrepared,at:number,e:Exit,entry=true)=>{seam.monitor.port.postMessage({kind:'cancel',planId:ready.approval.id});seam.monitor.port.postMessage({kind:'arm',events:[...(entry&&at>host.ctx.currentTime?[{name:'自动长混声部开始',frame:Math.round(at*host.ctx.sampleRate),planId:ready.approval.id,requestId:'automatic-longmix'}]:[]),{name:outcomeOf(ready.approval)==='return-a'?'临时叠加返回 A 原曲':'自动长混 B 原曲接管',frame:Math.round((at+e.at)*host.ctx.sampleRate),planId:ready.approval.id,requestId:'automatic-longmix'}]})}
 return{ctx:host.ctx,active:()=>host.active,position:()=>host.position,playing:()=>host.playing,available:()=>!host.busy&&!host.pending&&!host.crossGenrePending&&!host.gate.locked,tracks:()=>host.tracks,notify,log:(kind,data)=>host.log(kind,data),status:value=>host.status=value,locked:value=>host.gate.locked=value,protect:urls=>cache.protected=urls,
  createBody:(ready,e,at)=>{const position=continuationPosition(ready.approval,e),asset=nativeSegment(ready.target,position).asset,buffer=ready.bodyBuffers.get(asset.url);if(!buffer)throw Error('长混出口的原曲素材未准备');const deck=seam.graph(ready.target,at,position);deck.gain.gain.value=0
   try{seam.nativeSource(deck,buffer,at,position,false);deck.gain.gain.setValueAtTime(0,at);deck.gain.gain.linearRampToValueAtTime(ready.approval.nativeGain,at+ready.approval.entry.fadeSeconds);return deck}catch(error){seam.retire(deck,false);throw error}},
  retire:deck=>seam.retire(deck,false),
  schedule:(ready,source,at)=>{
   if(ready.roles&&(ready.multi||canonicalJson(ready.roles.approval.base)!==canonicalJson(ready.approval)))throw Error('角色替换原 A/B 批准不匹配')
   const log=(kind:string,data:Record<string,unknown>)=>{host.log(kind,data);if(kind==='longmix_exit_selected')markers(ready,at,data.exit as Exit,false)}
   let graph:LivePlaybackGraph=ready.roles?new RoleGraph(host.ctx,seam.monitor,ready.roles,ready.pcm,source.gain.gain,at,log,ready.exits):new LiveGraph(host.ctx,seam.monitor,ready.approval,ready.pcm,source.gain.gain,at,log,ready.exits)
   if(ready.multi)graph=new MultiGraph(host.ctx,seam.monitor,graph,ready.multi,at)
   const stop=graph.stop.bind(graph);graph.stop=()=>{try{seam.monitor.port.postMessage({kind:'cancel',planId:ready.approval.id})}finally{stop()}};try{markers(ready,at,graph.exit);return graph}catch(error){graph.cancel();throw error}
  },
  detach:(source,at)=>{const original=source.stream,state={stopped:false};detached.set(source,state);if(!original)return()=>{detached.delete(source)};const proxy=new Proxy(original,{get(target,key){if(key==='deadline'&&(state.stopped||target.deadline>=at+.008-1/44100))return Infinity;if(key==='pins'&&state.stopped)return new Set<string>();const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v}});source.stream=proxy;return()=>{if(source.stream===proxy)source.stream=original;detached.delete(source)}},
  silence:source=>{const state=detached.get(source);if(state)state.stopped=true;source.stream?.dispose();for(const s of source.sources)try{s.stop()}catch{}},
  commit:(deck,p:LivePending)=>{if(host.active!==p.source||deck.track.id!==p.plan.to)throw Error('长混原曲接管来源已变化');host.active=deck;deck.at=p.end;deck.offset=p.plan.entry;host.cancelPreparation();seam.retire(p.source,false);seam.protected();host.log('handoff_state_commit',{planId:p.plan.id,to:deck.track.id,bodySourceOffset:p.plan.entry,scheduledContextSec:p.end,transitionFamily:'longmix'})},
  dispose:()=>cache.dispose()}
}
