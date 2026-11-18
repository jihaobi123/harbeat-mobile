import {sourceChroma} from '../vendor/realtime-v3/src/mobile/source-features'
import {rms} from '../vendor/realtime-v3/src/mobile/decision-core'
import {valueAt} from '../vendor/realtime-v3/src/mobile/device-execution'
/** Independent acoustic interval proxy for research. Never overrides the
 * production spectrum-similarity gate or creates phone execution approval. */
export function measureIntervals(a:any,b:any,ac:any,bc:any,duration:number,bpm:number){
 const sr=44100,step=2205,n=Math.round(duration*sr),roles=['bass','other','vocals'],gate=10**(-45/20),profiles:any={};let overlap=0,risk=0,bad=0
 const mono=(p:any,lo:number,hi:number)=>{const x=new Float32Array(hi-lo);for(let i=0;i<x.length;i++)x[i]=(p.getChannelData(0)[lo+i]+p.getChannelData(1)[lo+i])*.5;return x}
 const tonal=(p:number[]|null)=>!!p&&Math.max(...p)/p.reduce((s,x)=>s+x,0)>=.3
 const clash=(a:number[]|null,b:number[]|null)=>{if(!a||!b)return 1;const sa=a.reduce((s,x)=>s+x,0),sb=b.reduce((s,x)=>s+x,0);let x=0;for(let i=0;i<12;i++)for(let j=0;j<12;j++)if([1,2,6,10,11].includes((i-j+12)%12))x+=a[i]*b[j]/(sa*sb);return x}
 for(let lo=0;lo<n;lo+=step){const hi=Math.min(n,lo+step),t=(lo+hi)/2/sr;if(lo%(step*40)===0)for(const [side,audio]of [['a',a],['b',b]]as const)for(const r of roles)profiles[side+r]=sourceChroma(mono(audio[r],lo,Math.min(n,lo+step*40)),sr)
  let frame=0,active=false
  for(const ar of roles)for(const br of roles){const x=rms(a[ar],lo,hi)*valueAt(ac[ar],t),y=rms(b[br],lo,hi)*valueAt(bc[br],t);if(x<gate||y<gate||ar==='vocals'&&!tonal(profiles['a'+ar])||br==='vocals'&&!tonal(profiles['b'+br]))continue;active=true;frame=Math.max(frame,2*Math.min(x,y)/(x+y)*clash(profiles['a'+ar],profiles['b'+br]))}
  if(active){const d=(hi-lo)/sr;overlap+=d;risk+=frame*d;if(frame>.35)bad+=d}
 }
 risk/=Math.max(1e-20,overlap);return{risk,overlapSeconds:overlap,incompatibleSeconds:bad,maximumRisk:.35,pass:risk<=.35&&bad<=30/bpm+.02,basis:'Local chroma dissonant-interval energy; research proxy, not chord truth or phone approval'}
}
