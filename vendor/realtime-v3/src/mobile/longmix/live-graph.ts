import {valueAt,type Point} from '../device-execution'
import {type Exit,type Layer} from './contract'
import type {LayerPCM} from './graph'
import {approvedExits,returnLayers,type LiveScene} from './live-contract'
import {validateRole,type RoleApproval} from './role-contract'
import {canonicalJson} from '../jetson-contract'

/** Approved layers only. A is the existing deck; B continuation belongs to its native stream. */
export class LiveGraph{
 private nodes:AudioNode[]=[];private sources:AudioBufferSourceNode[]=[];private layers:{layer:Layer;gain:GainNode}[]=[];private bus:GainNode;private stopped=false
 exit:Exit
 constructor(private ctx:AudioContext,target:AudioNode,readonly approval:LiveScene,pcm:LayerPCM,private original:AudioParam,readonly at:number,private log:(kind:string,data:Record<string,unknown>)=>void,private exits:Exit[]=approvedExits(approval),replacement?:RoleApproval){
  const s=approval.scene;if(replacement){validateRole(replacement);if(canonicalJson(replacement.base)!==canonicalJson(approval))throw Error('角色替换原 A/B 批准已变化')}
  if(!exits.length||exits.some(e=>!approvedExits(approval).includes(e)))throw Error('长混资源出口不是 Jetson 批准的出口');this.exit=exits.at(-1)!;this.bus=this.keep(ctx.createGain());this.bus.connect(target)
  try{
   this.bus.gain.setValueAtTime(0,at);this.bus.gain.linearRampToValueAtTime(s.outputGain,at+approval.entry.fadeSeconds)
   for(const original of s.layers){const points=replacement&&original.side==='b'?(original.role==='other'?replacement.bOther:original.role==='vocals'?replacement.bVocals:undefined):undefined,layer=points?{...original,points}:original,buffer=pcm[layer.side][layer.role];if(!buffer)throw Error('长混声部未就绪');const gain=this.gain(layer.points,at,s.sourceGains[layer.side]),source=this.keep(ctx.createBufferSource());this.sources.push(source);source.buffer=buffer;source.connect(gain);source.loop=layer.loop;if(source.loop){source.loopStart=0;source.loopEnd=s.clips.aEnd-s.clips.aStart}source.start(at);this.layers.push({layer,gain})}
   this.applyExit(this.exit,false)
   // Only mutate the sounding deck once construction of every layer succeeded.
   original.setValueAtTime(approval.nativeGain,at);original.linearRampToValueAtTime(0,at+approval.entry.fadeSeconds)
  }catch(error){this.stop();throw error}
 }
 private keep<T extends AudioNode>(n:T){this.nodes.push(n);return n}
 private gain(points:Point[],at:number,scale:number){const n=this.keep(this.ctx.createGain());n.connect(this.bus);points.forEach(([t,v],i)=>i?n.gain.linearRampToValueAtTime(v*scale,at+t):n.gain.setValueAtTime(v*scale,at+t));return n}
 get position(){return Math.max(0,this.ctx.currentTime-this.at)}
 get end(){return this.at+this.exit.at+this.approval.entry.fadeSeconds}
 nextExit(){return this.exits.find(e=>e.fadeStart>this.position+.2)??null}
 private fadeBus(e:Exit){const t=this.at+e.at,p=this.bus.gain;p.cancelScheduledValues(t);p.setValueAtTime(this.approval.scene.outputGain,t);p.linearRampToValueAtTime(0,t+this.approval.entry.fadeSeconds);for(const n of this.sources)n.stop(t+this.approval.entry.fadeSeconds)}
 setExit(e:Exit){this.applyExit(e,true)}
 private applyExit(e:Exit,emit:boolean){
  if(this.stopped||!this.exits.includes(e)||e.fadeStart<=this.position+.2)throw Error('长混退出点已经错过')
  const s=this.approval.scene,at=this.at+e.fadeStart,end=this.at+e.at
  const returning=returnLayers(this.approval,e)
  for(const {layer,gain} of this.layers){const p=gain.gain,scale=s.sourceGains[layer.side];p.cancelScheduledValues(at);p.linearRampToValueAtTime(valueAt(layer.points,e.fadeStart)*scale,at);if(returning){const points=returning.find(l=>l.side===layer.side&&l.role===layer.role)!.points;for(const [t,v] of points)if(t>e.fadeStart)p.linearRampToValueAtTime(v*scale,this.at+t)}else p.linearRampToValueAtTime(Number(layer.side==='b')*scale,end)}
  this.bus.gain.cancelScheduledValues(at);this.bus.gain.setValueAtTime(s.outputGain,at);this.exit=e;this.fadeBus(e)
  if(emit)this.log('longmix_exit_selected',{sceneId:this.approval.id,position:this.position,exit:e})
 }
 cancel(){this.stop();this.original.cancelScheduledValues(this.ctx.currentTime);this.original.setValueAtTime(this.approval.nativeGain,this.ctx.currentTime)}
 stop(){if(this.stopped)return;this.stopped=true;for(const n of this.sources)try{n.stop()}catch{};for(const n of this.nodes)try{n.disconnect()}catch{}}
}
