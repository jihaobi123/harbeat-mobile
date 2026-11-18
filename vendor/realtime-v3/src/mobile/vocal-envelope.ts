import type {PCM} from './decision-core'
/** AC envelope: a constant separator bias is not a sung tail. Keep the existing
 * 50ms / P95*.008 / -70dB floor; genuine quiet alternating tails still count. */
export function vocalEnvelope(v:PCM,duration:number){
 const step=Math.round(v.sampleRate*.05),n=Math.round(duration*v.sampleRate),levels:number[]=[];let largestDc=0
 for(let i=0;i<n;i+=step){const end=Math.min(n,i+step),count=end-i;let power=0
  for(let ch=0;ch<2;ch++){const x=v.getChannelData(ch);let sum=0,square=0;for(let j=i;j<end;j++){sum+=x[j];square+=x[j]*x[j]}const mean=sum/count;largestDc=Math.max(largestDc,Math.abs(mean));power+=Math.max(0,square/count-mean*mean)}
  levels.push(Math.sqrt(power/2))
 }
 const sorted=[...levels].sort((a,b)=>a-b),gate=Math.max((sorted[Math.floor(sorted.length*.95)]??0)*.008,10**(-70/20));let tail=0
 levels.forEach((x,i)=>{if(x>=gate)tail=Math.min(duration,(i+1)*.05)})
 return{tail,dcRemoved:true as const,frameSeconds:.05 as const,gateDb:20*Math.log10(gate),maximumAcRmsDb:20*Math.log10(Math.max(...levels)+1e-12),maximumFrameMean:largestDc}
}
