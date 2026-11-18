import {valueAt} from '../device-execution'
import type {Exit} from './contract'
import type {LiveGraph} from './live-graph'
import type {MultiApproval} from './multi-contract'
export type LivePlaybackGraph=Pick<LiveGraph,'position'|'end'|'exit'|'nextExit'|'setExit'|'cancel'|'stop'>
export type ExtraPCM={approval:MultiApproval;buffers:Map<string,AudioBuffer>;release:()=>void}
/** Compose additional roles beside the immutable approved A/B graph. */
export class MultiGraph implements LivePlaybackGraph{
 private nodes:AudioNode[]=[];private sources:AudioBufferSourceNode[]=[];private gains:{layer:MultiApproval['layers'][number];gain:GainNode}[]=[];private stopped=false
 constructor(private ctx:AudioContext,target:AudioNode,private base:LivePlaybackGraph,private ready:ExtraPCM,private at:number){
  try{for(const layer of ready.approval.layers){const b=ready.buffers.get(layer.source+':'+layer.role);if(!b)throw Error('新增声部未准备');const gain=ctx.createGain(),source=ctx.createBufferSource();this.nodes.push(gain,source);this.sources.push(source);gain.connect(target);source.connect(gain);source.buffer=b;source.loop=layer.loop;if(layer.loop){source.loopStart=0;source.loopEnd=b.duration}for(const [i,[t,v]]of layer.points.entries())i?gain.gain.linearRampToValueAtTime(v,at+t):gain.gain.setValueAtTime(v,at+t);source.start(at+layer.outputStart);this.gains.push({layer,gain})}this.applyExit(base.exit)}catch(e){this.stopExtras();base.cancel();throw e}
 }
 get position(){return this.base.position}get end(){return this.base.end}get exit(){return this.base.exit}nextExit(){return this.base.nextExit()}
 private applyExit(e:Exit){for(const {layer,gain}of this.gains){const p=gain.gain,t=this.at+e.fadeStart;p.cancelScheduledValues(t);p.linearRampToValueAtTime(valueAt(layer.points,e.fadeStart),t);p.linearRampToValueAtTime(0,this.at+e.at)}for(const s of this.sources)s.stop(this.at+e.at+.008)}
 setExit(e:Exit){this.base.setExit(e);this.applyExit(e)}
 private stopExtras(){if(this.stopped)return;this.stopped=true;for(const n of this.sources)try{n.stop()}catch{};for(const n of this.nodes)try{n.disconnect()}catch{}}
 cancel(){this.stop();this.base.cancel()}stop(){this.stopExtras();this.base.stop()}
}
