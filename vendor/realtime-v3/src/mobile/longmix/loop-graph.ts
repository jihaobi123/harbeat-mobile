import {loopExit,type LoopExit} from './loop-contract'
import type {LoopPrepared} from './loop-catalog'
/** One short native master slice, finite repeats, phase-approved native return. */
export class LoopGraph{
 private source:AudioBufferSourceNode;private bus:GainNode;private stopped=false;exit:LoopExit
 constructor(private ctx:AudioContext,target:AudioNode,readonly ready:LoopPrepared,private original:AudioParam,readonly at:number,cycles:number){
  const p=ready.approval;this.exit={atFrame:cycles*p.lengthFrames,sourceFrame:p.startFrame+p.lengthFrames};loopExit(p,cycles,0)
  this.bus=ctx.createGain();this.source=ctx.createBufferSource();try{this.bus.connect(target);this.source.buffer=ready.buffer;this.source.loop=true;this.source.loopStart=0;this.source.loopEnd=p.lengthFrames/44100;this.source.connect(this.bus);this.bus.gain.setValueAtTime(0,at);this.bus.gain.linearRampToValueAtTime(p.nativeGain,at+p.fadeSeconds);this.source.start(at);this.scheduleExit(this.exit);original.setValueAtTime(p.nativeGain,at);original.linearRampToValueAtTime(0,at+p.fadeSeconds)}catch(e){this.stop();throw e}
 }
 get elapsed(){return Math.max(0,this.ctx.currentTime-this.at)}
 get end(){return this.at+this.exit.atFrame/44100}
 private scheduleExit(e:LoopExit){const p=this.ready.approval,t=this.at+e.atFrame/44100;this.bus.gain.cancelScheduledValues(t);this.bus.gain.setValueAtTime(p.nativeGain,t);this.bus.gain.linearRampToValueAtTime(0,t+p.fadeSeconds);this.source.stop(t+p.fadeSeconds);this.exit=e}
 nextExit(cycles:number){try{return loopExit(this.ready.approval,cycles,this.elapsed+.4)}catch{return null}}
 setExit(e:LoopExit){if(this.stopped||e.atFrame/44100<=this.elapsed+.2||e.atFrame>this.exit.atFrame||e.atFrame%(this.ready.approval.lengthFrames/2)||e.sourceFrame!==this.ready.approval.startFrame+(e.atFrame%this.ready.approval.lengthFrames||this.ready.approval.lengthFrames))throw Error('循环释放点无效或已过');this.scheduleExit(e)}
 cancel(){this.stop();this.original.cancelScheduledValues(this.ctx.currentTime);this.original.setValueAtTime(this.ready.approval.nativeGain,this.ctx.currentTime)}
 stop(){if(this.stopped)return;this.stopped=true;try{this.source.stop()}catch{};this.source.disconnect();this.bus.disconnect()}
}
