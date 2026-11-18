import {validateRole,roleFrames,type RoleApproval} from './role-contract'
import type {Exit} from './contract'
import type {LayerPCM} from './graph'
import {LiveGraph} from './live-graph'
import type {LivePlaybackGraph} from './multi-graph'
import {approvedExits} from './live-contract'
import {canonicalJson} from '../jetson-contract'
export type RolePCM={approval:RoleApproval;buffers:Map<string,AudioBuffer>;release:()=>void}
/** Only the validated B role envelopes differ; the native handoff stays A/B. */
export class RoleGraph implements LivePlaybackGraph{
 private base:LiveGraph;private exits:Exit[];private nodes:AudioNode[]=[];private sources:AudioBufferSourceNode[]=[];private stopped=false
 constructor(ctx:AudioContext,target:AudioNode,ready:RolePCM,pcm:LayerPCM,original:AudioParam,at:number,log:(kind:string,data:Record<string,unknown>)=>void,exits?:Exit[]){
  const approval=validateRole(ready.approval)
  // The optional arrangement and original AB arrive in independent JSON files.
  // Resolve exact exit records into this execution base without enlarging the
  // resource-approved subset or changing LiveGraph's identity guard.
  const approved=approvedExits(approval.base)
  this.exits=(exits??approved).map(exit=>{const match=approved.find(e=>canonicalJson(e)===canonicalJson(exit));if(!match)throw Error('角色替换资源出口不是原 A/B 批准出口');return match})
  this.base=new LiveGraph(ctx,target,approval.base,pcm,original,at,log,this.exits,approval)
  try{for(const layer of approval.layers){
   const buffer=ready.buffers.get(layer.source+':'+layer.role),frames=roleFrames(layer)
   if(!buffer||buffer.sampleRate!==44100||buffer.numberOfChannels!==2||buffer.length!==frames)throw Error('替换声部 PCM 的来源或样本覆盖不足')
   const gain=ctx.createGain(),source=ctx.createBufferSource();this.nodes.push(gain,source);this.sources.push(source);gain.connect(target);source.connect(gain);source.buffer=buffer;source.loop=false
   layer.points.forEach(([t,v],i)=>i?gain.gain.linearRampToValueAtTime(v*layer.gain,at+t):gain.gain.setValueAtTime(v*layer.gain,at+t))
   source.start(at+layer.outputStart);source.stop(at+(layer.source==='c'?approval.window[1]:layer.outputStart+frames/44100))
  }}catch(error){this.stopExtras();this.base.cancel();throw error}
 }
 get position(){return this.base.position}get end(){return this.base.end}get exit(){return this.base.exit}nextExit(){return this.base.nextExit()}
 setExit(e:Exit){const match=this.exits.find(exit=>canonicalJson(exit)===canonicalJson(e));if(!match)throw Error('角色替换出口不在已准备的批准出口中');this.base.setExit(match)}
 private stopExtras(){if(this.stopped)return;this.stopped=true;for(const source of this.sources)try{source.stop()}catch{};for(const node of this.nodes)try{node.disconnect()}catch{}}
 cancel(){this.stop();this.base.cancel()}stop(){this.stopExtras();this.base.stop()}
}
