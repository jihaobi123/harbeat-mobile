import type {DevicePrepared,Point} from './device-execution'
import {stemCurves} from './device-execution'
import type {DevicePCM} from './device-prepare'
import type {Method} from '../metric-upstream/metric-mix/types'
import {scheduleV30Eq} from '../metric-upstream/v30/eq'
function schedule(param:AudioParam,points:Point[],at:number,scale=1){param.cancelScheduledValues(at);points.forEach(([time,value],i)=>i?param.linearRampToValueAtTime(value*scale,at+time):param.setValueAtTime(value*scale,at+time))}
/** Live master + signed stem corrections. Source preparation never mixes A/B.
 * Every gain/filter curve uses this AudioContext clock, including pause/resume. */
export function scheduleDeviceGraph(ctx:AudioContext,target:AudioNode,result:DevicePrepared,method:Method,pcm:DevicePCM,at:number){
 const nodes:AudioNode[]=[],p=result.execution.plan,c=result.execution.controls,d=p.duration,curves=stemCurves(method,c)
 const entry=ctx.createGain();entry.gain.value=1;entry.connect(target);nodes.push(entry)
 const source=(buffer:AudioBuffer)=>{const src=ctx.createBufferSource();src.buffer=buffer;nodes.push(src);src.onended=()=>src.disconnect();src.start(at);return src}
 const eq=(buffer:AudioBuffer,side:'a'|'b')=>{
  const input=source(buffer),low=ctx.createBiquadFilter(),high=ctx.createBiquadFilter(),mid=ctx.createBiquadFilter(),wet=ctx.createGain(),dry=ctx.createGain(),output=ctx.createGain()
  low.type='lowshelf';low.frequency.value=140;high.type='highshelf';high.frequency.value=3600;mid.type='peaking';mid.frequency.value=1200;mid.Q.value=1.05
  input.connect(low);low.connect(high);high.connect(mid);mid.connect(wet);input.connect(dry);wet.connect(output);dry.connect(output);nodes.push(low,high,mid,wet,dry,output)
  const eqPoints=p.v30Eq?.[side];if(eqPoints)scheduleV30Eq({low,mid,high},{low,mid,high},at,{...p.v30Eq!,a:eqPoints,b:eqPoints})
  const restore=Math.max(0,Math.min(d,p.restore-p.start))
  if(side==='a'){schedule(wet.gain,[[0,0],[.02,1],[d,1]],at);schedule(dry.gain,[[0,1],[.02,0],[d,0]],at)}
  else{schedule(wet.gain,[[0,1],[restore,1],[d,0]],at);schedule(dry.gain,[[0,0],[restore,0],[d,1]],at)}
  return output
 }
 const route=(buffer:AudioBuffer|undefined,side:'a'|'b',points:Point[])=>{if(!buffer)return;const output=eq(buffer,side),gain=ctx.createGain();output.connect(gain);gain.connect(entry);schedule(gain.gain,points,at,.60);nodes.push(gain)}
 route(pcm.a.master,'a',[[0,1],[d,0]]);route(pcm.b.master,'b',[[0,0],[d,1],[d+.008,0]])
 if(method==='bass'||method==='bass_filter'){route(pcm.a.bass,'a',curves.aBass);route(pcm.b.bass,'b',curves.bBass)}
 if(method==='yield')route(pcm.a.other,'a',curves.aOther)
 if(method==='vocal'){route(pcm.a.vocals,'a',curves.aVocal);route(pcm.b.vocals,'b',curves.bVocal)}
 if((method==='filter'||method==='bass_filter')&&pcm.a.other){
  const output=eq(pcm.a.other,'a'),hp=ctx.createBiquadFilter(),positive=ctx.createGain(),negative=ctx.createGain();hp.type='highpass';hp.Q.value=Math.SQRT1_2;hp.frequency.setValueAtTime(20,at);hp.frequency.setValueAtTime(20,at+c.lastBarStart);hp.frequency.exponentialRampToValueAtTime(1800,at+d);output.connect(hp);hp.connect(positive);output.connect(negative);positive.connect(entry);negative.connect(entry)
  // Sample the product of deck gain and the 20 ms enable ramp, matching
  // the established signed (highpassed other - original other) correction.
  const times=[0,c.lastBarStart,Math.min(d,c.lastBarStart+.02),d],points=times.map(t=>[t,(1-t/d)*(t<=c.lastBarStart?0:Math.min(1,(t-c.lastBarStart)/.02))] as Point)
  schedule(positive.gain,points,at,.60);schedule(negative.gain,points,at,-.60);nodes.push(hp,positive,negative)
 }
 return{nodes,entry}
}
