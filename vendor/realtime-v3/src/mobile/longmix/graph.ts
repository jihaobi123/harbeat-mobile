import {valueAt,type Point} from '../device-execution'
import {chooseExit,type Scene,type Exit,type Layer,type Role} from './contract'
export type LayerPCM={a:Partial<Record<Role,AudioBuffer>>;b:Partial<Record<Role|'master',AudioBuffer>>}
export type PCM=LayerPCM&{aMaster:AudioBuffer;bMaster:AudioBuffer}
export class SceneGraph{
 private nodes:AudioNode[]=[];private sources:AudioBufferSourceNode[]=[];private layers:{layer:Layer;gain:GainNode}[]=[];private bus:GainNode;private body:AudioBufferSourceNode|null=null;private bodyGain:GainNode|null=null;private chosen=false;private stopped=false
 readonly sceneAt:number;exit:Exit;end:number
 constructor(private ctx:AudioContext,private target:AudioNode,readonly scene:Scene,private pcm:PCM,readonly variant:'long'|'reference',readonly epoch:number,private log:(kind:string,data:Record<string,unknown>)=>void){
  this.sceneAt=epoch+scene.lead;this.exit=scene.exits.at(-1)!;this.end=this.sceneAt+this.exit.at+scene.tail
  this.bus=this.keep(ctx.createGain());this.bus.connect(target);this.bus.gain.setValueAtTime(0,this.sceneAt);this.bus.gain.linearRampToValueAtTime(scene.outputGain,this.sceneAt+.008)
  try{
  const lead=this.gain(target,[[0,scene.outputGain],[scene.lead,scene.outputGain],[scene.lead+.008,0]],epoch);this.source(pcm.aMaster,lead,epoch,0,scene.lead+.008)
  if(variant==='long')for(const layer of scene.layers){const buffer=pcm[layer.side][layer.role];if(!buffer)throw Error('分轨 PCM 不完整');const gain=this.gain(this.bus,layer.points,this.sceneAt,scene.sourceGains[layer.side]);const src=this.source(buffer,gain,this.sceneAt);src.loop=layer.loop;if(layer.loop){src.loopStart=0;src.loopEnd=scene.clips.aEnd-scene.clips.aStart}this.layers.push({layer,gain})}
  else{
   const d=scene.clips.aEnd-scene.clips.aStart,aGain=this.gain(this.bus,[[0,1],[d,0],[scene.duration,0]],this.sceneAt),bGain=this.gain(this.bus,[[0,0],[d,1],[scene.duration,1]],this.sceneAt)
   this.source(pcm.aMaster,aGain,this.sceneAt,scene.lead,d);if(!pcm.b.master)throw Error('普通交接 PCM 未就绪');this.source(pcm.b.master,bGain,this.sceneAt)
  }
  this.applyExit(this.exit);log('scene_scheduled',{sceneId:scene.id,variant,epoch,sceneAt:this.sceneAt,exit:this.exit,sourceGains:scene.sourceGains,layers:variant==='long'?scene.layers:[],implementationSha256:scene.implementationSha256})
  }catch(error){this.stop();throw error}
 }
 private keep<T extends AudioNode>(n:T){this.nodes.push(n);return n}
 private gain(to:AudioNode,points:Point[],at:number,scale=1){const n=this.keep(this.ctx.createGain());n.connect(to);points.forEach(([t,v],i)=>i?n.gain.linearRampToValueAtTime(v*scale,at+t):n.gain.setValueAtTime(v*scale,at+t));return n}
 private source(buffer:AudioBuffer,to:AudioNode,at:number,offset=0,duration?:number){const n=this.keep(this.ctx.createBufferSource());this.sources.push(n);n.buffer=buffer;n.connect(to);duration===undefined?n.start(at,offset):n.start(at,offset,duration);return n}
 get position(){return Math.max(0,this.ctx.currentTime-this.sceneAt)}
 get finished(){return this.ctx.currentTime>=this.end}
 private applyExit(e:Exit){
  const at=this.sceneAt+e.at
  if(this.body){try{this.body.stop()}catch{};this.body.disconnect();this.bodyGain?.disconnect()}
  // Only the scene bus stops. Same-source B master continues at native tempo.
  this.bus.gain.cancelScheduledValues(at);this.bus.gain.setValueAtTime(this.scene.outputGain,at);this.bus.gain.linearRampToValueAtTime(0,at+.008)
  this.bodyGain=this.gain(this.target,[[0,0],[.008,this.scene.outputGain],[this.scene.tail-.008,this.scene.outputGain],[this.scene.tail,0]],at)
  this.body=this.source(this.pcm.bMaster,this.bodyGain,at,e.bPosition-this.scene.clips.bStart,this.scene.tail)
  this.exit=e;this.end=at+this.scene.tail
 }
 requestExit(){
  if(this.stopped)return null;if(this.chosen)return this.exit
  const e=chooseExit(this.scene,this.position);if(!e)return null
  // An immutable Jetson-approved exit controls all layers on the same clock.
  const fadeAt=this.sceneAt+e.fadeStart,end=this.sceneAt+e.at
  for(const {layer,gain} of this.layers){const p=gain.gain,scale=this.scene.sourceGains[layer.side],from=valueAt(layer.points,e.fadeStart)*scale;p.cancelScheduledValues(fadeAt);p.setValueAtTime(from,fadeAt);p.linearRampToValueAtTime(Number(layer.side==='b')*scale,end)}
  this.bus.gain.cancelScheduledValues(fadeAt);this.bus.gain.setValueAtTime(this.scene.outputGain,fadeAt);this.applyExit(e);this.chosen=true;this.log('scene_exit_requested',{sceneId:this.scene.id,position:this.position,exit:e});return e
 }
 stop(){if(this.stopped)return;this.stopped=true;for(const n of this.sources)try{n.stop()}catch{};for(const n of this.nodes)try{n.disconnect()}catch{};this.log('scene_nodes_stopped',{sceneId:this.scene.id,nodeCount:this.nodes.length})}
}
