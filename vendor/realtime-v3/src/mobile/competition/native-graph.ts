import {scheduleCrossGraph,type CrossGraph} from '../crossgenre/graph'
import {scheduleLoopRamp} from '../crossgenre/bridge'
import type {CrossPlan} from '../crossgenre/planner'
import {scheduleExitGraph} from './exit-graph'
import type {PreparedExit} from './exit-audio'
export function scheduleNativeGraph(ctx:BaseAudioContext,tap:AudioNode,a:AudioParam,b:AudioParam,target:AudioNode,p:CrossPlan,handoff:number,bridgeBuffer?:AudioBuffer,exitAudio?:PreparedExit):CrossGraph{
 if(p.fx)return scheduleExitGraph(ctx,a,b,target,p,handoff,exitAudio)
 if(p.family==='structural-cut'||p.family==='echo-out')return scheduleCrossGraph(ctx,tap,a,b,target,p,handoff)
 if(p.family==='half-double'){
  if(!p.mapping||p.mapping.onsetOverlap<.62||p.mapping.verification!=='measured-low-band-onset-correspondence'||p.echo)throw Error('半双拍缺少实测重音对应')
  return scheduleCrossGraph(ctx,tap,a,b,target,{...p,family:'structural-cut'},handoff)
 }
 if(!p.bridge||!bridgeBuffer||!['drum-bridge','loop-ramp'].includes(p.family)||p.echo||p.peakBound>.98)throw Error('鼓桥缺少已核验的素材与时间映射')
 const begin=handoff-p.bridge.ramp.duration;if(begin<ctx.currentTime+.05)throw Error('鼓桥接点已经过去')
 const graph=scheduleLoopRamp(ctx,target,bridgeBuffer,p.bridge.material,p.bridge.ramp,begin)
 try{a.setValueAtTime(.76,begin-.004);a.linearRampToValueAtTime(0,begin);b.setValueAtTime(0,ctx.currentTime);b.setValueAtTime(0,handoff);b.linearRampToValueAtTime(.76,handoff+.004)}catch(error){graph.dispose();for(const [param,value] of [[a,.76],[b,0]] as [AudioParam,number][]){param.cancelScheduledValues(ctx.currentTime);param.setValueAtTime(value,ctx.currentTime)}throw error}
 return{end:handoff+.02,dispose:()=>graph.dispose(),cancel:()=>{const now=ctx.currentTime;for(const [param,value] of [[a,.76],[b,0]] as [AudioParam,number][]){if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);else param.cancelScheduledValues(now);param.linearRampToValueAtTime(value,now+.008)}graph.cancel()}}
}
