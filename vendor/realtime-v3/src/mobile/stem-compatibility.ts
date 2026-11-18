import type {WindowPCM,PCM} from './decision-core'
import {rms} from './decision-core'
import {sourceChroma,chromaDifference} from './source-features'
import {valueAt} from './device-execution'
import type {StemTimeline} from './stem-timeline'
/** Source-spectrum and onset proxies, not chord recognition or a listening verdict. */
export function measureStemCompatibility(audio:WindowPCM,t:StemTimeline,bpm:number){
 const sr=44100,step=Math.round(sr*.05),n=Math.round(t.duration*sr),pitchRoles=['bass','other','vocals'] as const,gate=10**(-45/20)
 const mono=(p:PCM,start:number,end:number)=>{const x=new Float32Array(end-start);for(let i=0;i<x.length;i++)x[i]=(p.getChannelData(0)[start+i]+p.getChannelData(1)[start+i])*.5;return x}
 let pitchedRisk=0,totalFrames=0,pitchedOverlapSeconds=0,incompatiblePitchedSeconds=0,drumOverlapSeconds=0;const drums:{a:number[];b:number[]}={a:[],b:[]};let chroma:Record<string,number[]|null>={}
 for(let i=0;i<n;i+=step){const end=Math.min(n,i+step),time=(i+end)/2/sr
  if(i%(step*40)===0){chroma={};for(const side of ['a','b'] as const)for(const r of pitchRoles)chroma[side+r]=sourceChroma(mono(audio[side][r],i,Math.min(n,i+step*40)),sr)}
  let frameRisk=0,overlapping=false
  for(const ar of pitchRoles)for(const br of pitchRoles){const a=rms(audio.a[ar],i,end)*valueAt(t.a[ar],time),b=rms(audio.b[br],i,end)*valueAt(t.b[br],time)
   if(a>=gate&&b>=gate){const tonal=(c:number[]|null)=>!!c&&Math.max(...c)/c.reduce((s,x)=>s+x,0)>=.3;if(ar==='vocals'&&!tonal(chroma['a'+ar])||br==='vocals'&&!tonal(chroma['b'+br]))continue;overlapping=true;frameRisk=Math.max(frameRisk,2*Math.min(a,b)/(a+b)*(chromaDifference(chroma['a'+ar],chroma['b'+br])??1))}
  }
  if(overlapping){pitchedRisk+=frameRisk*(end-i);totalFrames+=end-i;pitchedOverlapSeconds+=(end-i)/sr;if(frameRisk>.35)incompatiblePitchedSeconds+=(end-i)/sr}
  const da=rms(audio.a.drums,i,end),db=rms(audio.b.drums,i,end);drums.a.push(da);drums.b.push(db)
  if(da*valueAt(t.a.drums,time)>=gate&&db*valueAt(t.b.drums,time)>=gate)drumOverlapSeconds+=(end-i)/sr
 }
 pitchedRisk/=Math.max(1,totalFrames)
 const onsets=(v:number[])=>{const threshold=Math.max(gate,Math.max(...v)*.25);return v.flatMap((x,i)=>x-(v[i-1]??0)>=threshold?[i]:[])},oa=onsets(drums.a),ob=onsets(drums.b)
 const observed=oa.length>=3&&ob.length>=3,densityRatio=observed?Math.max(oa.length,ob.length)/Math.min(oa.length,ob.length):null,onsetAgreement=observed?ob.filter(i=>oa.some(j=>Math.abs(i-j)<=1)).length/ob.length:null
 // Longer drum layering needs positive evidence; uncertain exchange stays within half a beat.
 const drumOverlapLimit=30/bpm+.02,drumPass=drumOverlapSeconds<=drumOverlapLimit||(observed&&densityRatio!<=2.5&&onsetAgreement!>=.5)
 return{pitchedRisk,pitchedOverlapSeconds,incompatiblePitchedSeconds,drumOverlapSeconds,drumOverlapLimit,drumDensityRatio:densityRatio,drumOnsetAgreement:onsetAgreement,drumEvidence:observed?'observed':drumOverlapSeconds===0?'not-overlapping':'limited',maximumPitchedRisk:.35,pass:incompatiblePitchedSeconds<=drumOverlapLimit&&drumPass}
}
