import {POLICY} from './contract'
import type {CrossPlan} from './planner'

export type CrossGraph={end:number;cancel:()=>void;dispose:()=>void}
function restore(param:AudioParam,value:number,now:number){if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);else param.cancelScheduledValues(now);param.linearRampToValueAtTime(value,now+.008)}

/** A-only send/return. B never enters the delay, even after deck takeover. */
export function scheduleCrossGraph(ctx:BaseAudioContext,tap:AudioNode,a:AudioParam,b:AudioParam,target:AudioNode,plan:CrossPlan,handoff:number):CrossGraph{
 const e=plan.echo,now=ctx.currentTime
 if(plan.schema!=='harbeat.crossgenre-plan.v1'||plan.policy!==POLICY||plan.rate!==1||!['structural-cut','echo-out'].includes(plan.family)||!Number.isFinite(handoff)||handoff<now+.05||!Number.isFinite(plan.peakBound)||plan.peakBound>.98||plan.peakBound<0||plan.family==='echo-out'!==!!e)throw Error('跨风格执行参数不合法或接点已过')
 if(e&&(!Object.values(e).every(Number.isFinite)||e.feedback!==.24||e.sendGain!==.25||e.wetGain!==.12||e.highpassHz!==600||e.lowpassHz!==4000||e.delaySeconds<.1||e.delaySeconds>.5||e.tailSeconds<=0||e.tailSeconds>.35||e.captureStart<0||e.captureEnd<=e.captureStart||e.captureEnd>plan.exit-.15||e.captureEnd-e.captureStart>.801||handoff-plan.exit+e.captureStart<now+.02))throw Error('跨风格回声参数越界')
 const nodes:AudioNode[]=[],returns:GainNode[]=[];let first:AudioNode|null=null,disposed=false
 // No A samples are required beyond its frozen source exit.
 a.setValueAtTime(.76,handoff-.004);a.linearRampToValueAtTime(0,handoff)
 b.setValueAtTime(0,now);b.setValueAtTime(0,handoff);b.linearRampToValueAtTime(.76,handoff+.004)
 if(e){
  const hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter(),capture=ctx.createGain(),delay=ctx.createDelay(1),feedback=ctx.createGain(),wet=ctx.createGain()
  hp.type='highpass';hp.frequency.value=e.highpassHz;hp.Q.value=Math.SQRT1_2;lp.type='lowpass';lp.frequency.value=e.lowpassHz;lp.Q.value=Math.SQRT1_2
  delay.delayTime.value=e.delaySeconds;feedback.gain.value=e.feedback;capture.gain.value=0;wet.gain.value=0
  tap.connect(hp);first=hp;hp.connect(lp);lp.connect(capture);capture.connect(delay);delay.connect(feedback);feedback.connect(delay);delay.connect(wet);wet.connect(target)
  const start=handoff-plan.exit+e.captureStart,end=handoff-plan.exit+e.captureEnd
  capture.gain.setValueAtTime(0,start);capture.gain.linearRampToValueAtTime(e.sendGain,start+.004);capture.gain.setValueAtTime(e.sendGain,end-.004);capture.gain.linearRampToValueAtTime(0,end)
  wet.gain.setValueAtTime(e.wetGain,start);wet.gain.setValueAtTime(e.wetGain,handoff);wet.gain.linearRampToValueAtTime(e.wetGain*.2,handoff+.008);wet.gain.linearRampToValueAtTime(0,handoff+e.tailSeconds)
  feedback.gain.setValueAtTime(e.feedback,handoff);feedback.gain.linearRampToValueAtTime(0,handoff+e.tailSeconds)
  nodes.push(hp,lp,capture,delay,feedback,wet);returns.push(capture,wet,feedback)
 }
 const dispose=()=>{if(disposed)return;disposed=true;if(first)try{tap.disconnect(first)}catch{};for(const n of nodes)n.disconnect()}
 return{end:handoff+(e?e.tailSeconds+.02:.02),dispose,cancel:()=>{restore(a,.76,ctx.currentTime);restore(b,0,ctx.currentTime);for(const n of returns)restore(n.gain,0,ctx.currentTime)}}
}
