import type {DevicePrepared,Point,DrumPreludeApproval} from './device-execution'
import {stemCurves,validateDrumPreludeApproval,drumPreludeCorrection} from './device-execution'
import type {DevicePCM} from './device-prepare'
import {STEM_ROLES,validateStemTimeline} from './stem-timeline'
import type {ExecutionMethod} from './device-execution'
import type {Method} from '../metric-upstream/metric-mix/types'
import {scheduleV30Eq} from '../metric-upstream/v30/eq'
function schedule(param:AudioParam,points:Point[],at:number,scale=1,sourceAt=at){param.cancelScheduledValues(sourceAt);if(sourceAt<at)param.setValueAtTime(points[0][1]*scale,sourceAt);points.forEach(([time,value],i)=>i?param.linearRampToValueAtTime(value*scale,at+time):param.setValueAtTime(value*scale,at+time))}
export type ExperimentalGraphOptions={prelude:{approval:DrumPreludeApproval;enabled:boolean}}
/** Legacy master/correction graphs or eight isolated Jetson stem buses. Preparation never mixes A/B.
 * Every gain/filter curve uses this AudioContext clock, including pause/resume. */
export function scheduleDeviceGraph(ctx:AudioContext,target:AudioNode,result:DevicePrepared,method:ExecutionMethod,pcm:DevicePCM,at:number,options?:ExperimentalGraphOptions){
 const nodes:AudioNode[]=[],p=result.execution.plan,c=result.execution.controls,d=p.duration,curves=stemCurves(method==='stem-handover'?'original':method,c)
 const prelude=options?.prelude,approved=prelude?validateDrumPreludeApproval(prelude.approval,result,pcm):null,sourceAt=at-(approved?.leadSeconds??0)
 if(!Number.isFinite(sourceAt)||sourceAt<ctx.currentTime-.001)throw Error('试听源窗口已经过期，不能回拨主交接点')
 try{
 const keep=<T extends AudioNode>(node:T)=>{nodes.push(node);return node}
 const entry=keep(ctx.createGain());entry.gain.value=1;entry.connect(target)
 const source=(buffer:AudioBuffer)=>{const src=keep(ctx.createBufferSource());src.buffer=buffer;src.onended=()=>src.disconnect();src.start(sourceAt);return src}
 const eq=(buffer:AudioBuffer,side:'a'|'b')=>{
  const input=source(buffer),low=keep(ctx.createBiquadFilter()),high=keep(ctx.createBiquadFilter()),mid=keep(ctx.createBiquadFilter()),wet=keep(ctx.createGain()),dry=keep(ctx.createGain()),output=keep(ctx.createGain())

  low.type='lowshelf';low.frequency.value=140;high.type='highshelf';high.frequency.value=3600;mid.type='peaking';mid.frequency.value=1200;mid.Q.value=1.05
  input.connect(low);low.connect(high);high.connect(mid);mid.connect(wet);input.connect(dry);wet.connect(output);dry.connect(output);
  const eqPoints=p.v30Eq?.[side];if(eqPoints){if(sourceAt<at&&eqPoints.length)for(const band of ['low','mid','high'] as const)({low,mid,high})[band].gain.setValueAtTime(eqPoints[0][band],sourceAt);scheduleV30Eq({low,mid,high},{low,mid,high},at,{...p.v30Eq!,a:eqPoints,b:eqPoints})}
  const restore=Math.max(0,Math.min(d,p.restore-p.start))
  if(side==='a'){schedule(wet.gain,[[0,0],[.02,1],[d,1]],at,1,sourceAt);schedule(dry.gain,[[0,1],[.02,0],[d,0]],at,1,sourceAt)}
  else{schedule(wet.gain,[[0,1],[restore,1],[d,0]],at,1,sourceAt);schedule(dry.gain,[[0,0],[restore,0],[d,1]],at,1,sourceAt)}
  return output
 }
 const route=(buffer:AudioBuffer|undefined,side:'a'|'b',points:Point[],sourceGain=1)=>{if(!buffer)return;const output=eq(buffer,side),gain=keep(ctx.createGain());output.connect(gain);gain.connect(entry);schedule(gain.gain,points,at,.60*sourceGain,sourceAt)}
 if(method!=='stem-handover'){route(pcm.a.master,'a',[[0,1],[d,0]]);route(pcm.b.master,'b',[[0,0],[d,1],[d+.008,0]])}
 if(method==='stem-handover'){
  const arrangement=result.execution.arrangement;if(!arrangement?.eligible||!arrangement.recommended||!arrangement.timeline)throw Error('缺少 Jetson 批准的声部时间线')
  if(prelude)throw Error('独立声部时间线不能叠加未经本方案批准的鼓前缀');const timeline=validateStemTimeline(arrangement.timeline,d),gains=arrangement.sourceGains??{a:1,b:1};if(![gains.a,gains.b].every(x=>Number.isFinite(x)&&x>=.5&&x<=2))throw Error('分轨共同增益标定不合法')
  for(const side of ['a','b'] as const)for(const role of STEM_ROLES){if(!pcm[side][role])throw Error('声部时间线缺少已批准的 '+side+' '+role+' PCM');route(pcm[side][role],side,side==='a'?timeline.a[role]:[...timeline.b[role],[d+.008,0]],gains[side])}
 }
 if(method==='bass'||method==='bass_filter'){route(pcm.a.bass,'a',curves.aBass);route(pcm.b.bass,'b',curves.bBass)}
 if(method==='yield')route(pcm.a.other,'a',curves.aOther)
 if(method==='vocal'){route(pcm.a.vocals,'a',curves.aVocal);route(pcm.b.vocals,'b',curves.bVocal)}
 if((method==='filter'||method==='bass_filter')&&pcm.a.other){
  const output=eq(pcm.a.other,'a'),hp=keep(ctx.createBiquadFilter()),positive=keep(ctx.createGain()),negative=keep(ctx.createGain());hp.type='highpass';hp.Q.value=Math.SQRT1_2;hp.frequency.setValueAtTime(20,at);hp.frequency.setValueAtTime(20,at+c.lastBarStart);hp.frequency.exponentialRampToValueAtTime(1800,at+d);output.connect(hp);hp.connect(positive);output.connect(negative);positive.connect(entry);negative.connect(entry)
  // Sample the product of deck gain and the 20 ms enable ramp, matching
  // the established signed (highpassed other - original other) correction.
  const times=[0,c.lastBarStart,Math.min(d,c.lastBarStart+.02),d],points=times.map(t=>[t,(1-t/d)*(t<=c.lastBarStart?0:Math.min(1,(t-c.lastBarStart)/.02))] as Point)
  schedule(positive.gain,points,at,.60,sourceAt);schedule(negative.gain,points,at,-.60,sourceAt)
 }
 if(approved&&prelude?.enabled){const output=eq(pcm.b.drums,'b'),gain=keep(ctx.createGain());output.connect(gain);gain.connect(entry);schedule(gain.gain,drumPreludeCorrection(approved,d),sourceAt,.60)}
 return{nodes,entry}
 }catch(error){for(const node of nodes){if('stop' in node)try{(node as AudioBufferSourceNode).stop()}catch{};try{node.disconnect()}catch{}};throw error}
}
