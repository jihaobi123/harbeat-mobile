import type {Plan} from '../metric-upstream/realtime/planner'
import type {WindowPCM} from './decision-core'
import {valueAt} from './device-execution'
import {STEM_ROLES,type StemTimeline} from './stem-timeline'
type Coeff=[number,number,number,number,number]
function rbj(kind:'low'|'mid'|'high'|'hp',frequency:number,gain=0):Coeff{
 const w=2*Math.PI*frequency/44100,c=Math.cos(w),s=Math.sin(w),A=10**(gain/40),alpha=s/(2*(kind==='mid'?1.05:Math.SQRT1_2)),beta=2*Math.sqrt(A)*s/Math.SQRT2
 let b0:number,b1:number,b2:number,a0:number,a1:number,a2:number
 if(kind==='low'){b0=A*((A+1)-(A-1)*c+beta);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-beta);a0=(A+1)+(A-1)*c+beta;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-beta}
 else if(kind==='high'){b0=A*((A+1)+(A-1)*c+beta);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-beta);a0=(A+1)-(A-1)*c+beta;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-beta}
 else if(kind==='mid'){b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A}
 else{b0=(1+c)/2;b1=-(1+c);b2=b0;a0=1+alpha;a1=-2*c;a2=1-alpha}
 return[b0/a0,b1/a0,b2/a0,a1/a0,a2/a0]
}
function processor(){const states=Array.from({length:2},()=>[0,0,0,0]);return(x:number,c:Coeff,ch:number)=>{const q=states[ch],y=c[0]*x+c[1]*q[0]+c[2]*q[1]-c[3]*q[2]-c[4]*q[3];q[1]=q[0];q[0]=x;q[3]=q[2];q[2]=y;return y}}

/** Same per-stem low/high/mid and wet/dry topology as the phone graph.
 * 128-frame coefficient updates are an admission proxy, not browser bit identity. */
export function measureTimelineAudio(audio:WindowPCM,t:StemTimeline,p:Plan){
 const frames=Math.round(t.duration*44100),filtered={} as Record<'a'|'b',Record<string,Float32Array>>
 for(const side of ['a','b'] as const){filtered[side]={}
  for(const role of ['master',...STEM_ROLES]){const input=audio[side][role],out=new Float32Array(frames*2),filters=[processor(),processor(),processor()];let coeffs:Coeff[]=[]
   for(let i=0;i<frames;i++){const time=i/44100,restore=Math.max(0,Math.min(t.duration,p.restore-p.start)),wet=side==='a'?Math.min(1,time/.02):time<restore?1:Math.max(0,(t.duration-time)/(t.duration-restore||1))
    if(i%128===0)coeffs=(['low','high','mid'] as const).map((band,k)=>rbj(band,[140,3600,1200][k],p.v30Eq?.[side]?.length?valueAt(p.v30Eq[side].map(v=>[v.t,v[band]]),time):0))
    for(let ch=0;ch<2;ch++){const x=input.getChannelData(ch)[i];let y=x;for(let k=0;k<3;k++)y=filters[k](y,coeffs[k],ch);out[i*2+ch]=wet*y+(1-wet)*x}
   }filtered[side][role]=out
  }
 }
 let peak=0,baselinePeak=0,power=0,reference=0
 for(let i=0;i<frames;i++){const time=i/44100,ga=1-time/t.duration,gb=time/t.duration
  for(let ch=0;ch<2;ch++){const j=i*2+ch,dry=filtered.a.master[j]*ga+filtered.b.master[j]*gb;let x=0
   for(const r of STEM_ROLES)x+=filtered.a[r][j]*valueAt(t.a[r],time)+filtered.b[r][j]*valueAt(t.b[r],time)
   peak=Math.max(peak,Math.abs(x*.76));baselinePeak=Math.max(baselinePeak,Math.abs(dry*.76));power+=x*x;reference+=dry*dry
  }
 }return{peak,baselinePeak,riseDb:10*Math.log10((power+1e-12)/(reference+1e-12)),eqApplied:true as const,outputScale:.76 as const,coefficientBlockFrames:128 as const}
}
export function measureReconstruction(audio:WindowPCM,duration:number){
 const measure=(side:'a'|'b',start:number,end:number)=>{const rows=audio[side];let master=0,stems=0,error=0
  for(let i=Math.round(start*44100);i<Math.round(end*44100);i++)for(let ch=0;ch<2;ch++){const x=rows.master.getChannelData(ch)[i],y=STEM_ROLES.reduce((s,r)=>s+rows[r].getChannelData(ch)[i],0);master+=x*x;stems+=y*y;error+=(x-y)**2}
  return{errorRatio:Math.sqrt(error/(master+1e-12)),levelDeltaDb:10*Math.log10((stems+1e-12)/(master+1e-12))}
 }
 return Object.fromEntries((['a','b'] as const).map(side=>[side,{...measure(side,0,duration),boundary:measure(side,side==='a'?0:Math.max(0,duration-.25),side==='a'?Math.min(.25,duration):duration)}])) as Record<'a'|'b',{errorRatio:number;levelDeltaDb:number;boundary:{errorRatio:number;levelDeltaDb:number}}>
}
