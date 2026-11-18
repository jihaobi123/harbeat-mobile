import type {WindowPCM,PCM} from './decision-core'
import {STEM_ROLES} from './stem-timeline'
import {measureReconstruction} from './timeline-audio-evidence'
/** Fit one common positive deck gain, never independent instrument rebalancing.
 * Source mismatch, timing errors and boundary loss still fail reconstruction. */
export function calibrateStemSources(input:WindowPCM,duration:number){
 const audio:WindowPCM={a:{...input.a},b:{...input.b}},gains={a:1,b:1},rawReconstruction=measureReconstruction(input,duration),n=Math.round(duration*44100)
 for(const side of ['a','b'] as const){const rows=input[side];let dot=0,power=0
  for(let ch=0;ch<2;ch++){let sx=0,sy=0,sxy=0,syy=0;const x=rows.master.getChannelData(ch),ys=STEM_ROLES.map(r=>rows[r].getChannelData(ch))
   for(let i=0;i<n;i++){const y=ys.reduce((s,v)=>s+v[i],0);sx+=x[i];sy+=y;sxy+=x[i]*y;syy+=y*y}dot+=sxy-sx*sy/n;power+=Math.max(0,syy-sy*sy/n)
  }
  const gain=power>1e-12?dot/power:1
  if(!Number.isFinite(gain)||gain<.5||gain>2)return null
  gains[side]=gain
  for(const role of STEM_ROLES){const p=rows[role],channels=[0,1].map(c=>p.getChannelData(c).map(x=>x*gain));audio[side][role]={length:p.length,sampleRate:p.sampleRate,numberOfChannels:2,getChannelData:c=>channels[c]} as PCM}
 }
 return{audio,gains,evidence:{mode:'common-linear-gain-v1' as const,gains,rawReconstruction}}
}
