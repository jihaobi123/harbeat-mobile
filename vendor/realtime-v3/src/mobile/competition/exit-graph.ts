import type {CrossPlan} from '../crossgenre/planner'
import type {CrossGraph} from '../crossgenre/graph'
import {POLICY} from '../crossgenre/contract'
import {exitAudioKey,type PreparedExit} from './exit-audio'
/** Finite, locally generated A-only audio. B remains on its native source path. */
export function scheduleExitGraph(ctx:BaseAudioContext,a:AudioParam,b:AudioParam,target:AudioNode,p:CrossPlan,handoff:number,ready?:PreparedExit):CrossGraph{
 const now=ctx.currentTime,begin=handoff-3
 if(p.schema!=='harbeat.crossgenre-plan.v1'||p.policy!==POLICY||!p.fx||p.rate!==1||!Number.isFinite(handoff)||begin<now+.05||!ready||ready.key!==exitAudioKey(p)||!Number.isFinite(ready.peakBound)||ready.peakBound<0||ready.peakBound>p.peakBound||p.peakBound!==.98||ready.buffer.sampleRate!==ctx.sampleRate||ready.buffer.length!==Math.round(ctx.sampleRate*3.55)||ready.buffer.numberOfChannels!==2)throw Error('手机退出效果 PCM、来源或接点未准备好')
 const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=ready.buffer;source.connect(gain);gain.connect(target)
 let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;try{source.stop()}catch{};source.disconnect();gain.disconnect()}
 const restore=(param:AudioParam,value:number)=>{if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(ctx.currentTime);else param.cancelScheduledValues(ctx.currentTime);param.linearRampToValueAtTime(value,ctx.currentTime+.008)}
 try{
  a.setValueAtTime(.76,begin);a.linearRampToValueAtTime(0,begin+.004)
  b.setValueAtTime(0,now);b.setValueAtTime(0,handoff);b.linearRampToValueAtTime(.76,handoff+.004)
  gain.gain.setValueAtTime(0,begin);gain.gain.linearRampToValueAtTime(.76,begin+.004);source.start(begin);source.stop(handoff+.55)
 }catch(error){dispose();restore(a,.76);restore(b,0);throw error}
 return{end:handoff+.57,dispose,cancel:()=>{restore(a,.76);restore(b,0);restore(gain.gain,0);try{source.stop(ctx.currentTime+.008)}catch{}}}
}
