import type {Track} from '../../listen-upstream/realtime/planner'
const bound=(t:Track)=>!!t.provenance?.masterSha256&&t.alignment?.source.masterSha256===t.provenance.masterSha256&&t.alignment?.source.reportSha256===t.provenance.reportSha256
export function voiceFraction(t:Track,start:number,end:number){if(!t.vocals||end<=start)return null;return Math.min(1,t.vocals.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(b,end)-Math.max(a,start)),0)/(end-start))}
export function levelDb(t:Track,start:number,end:number){if(!bound(t)||end<=start)return null;let covered=0,power=0;for(const f of t.alignment!.bandFrames??[]){const span=Math.max(0,Math.min(end,f.end)-Math.max(start,f.start));if(span&&Number.isFinite(f.rmsDbfs)){covered+=span;power+=span*10**(f.rmsDbfs!/10)}}return covered>=(end-start)*.95?10*Math.log10(Math.max(1e-12,power/covered)):null}
export function boundarySupport(t:Track,at:number){return Math.max(0,1-Math.min(...(t.sections??[]).flatMap(s=>[Math.abs(s.start-at),Math.abs(s.end-at)]),8)/8)}
/** Source-bound band-power onset proxy, not a pure drum or genre classifier. */
export function onsetSignature(t:Track,start:number,end:number,slots=64){
 if(!bound(t)||start<0||end<=start||!Number.isInteger(slots)||slots<8)return null
 const frames=(t.alignment!.bandFrames??[]).filter(f=>f.end>start&&f.start<end).sort((a,b)=>a.start-b.start),hist=new Array(slots).fill(0);let coverage=0,previous=0,onsets=0
 for(const f of frames){const span=Math.max(0,Math.min(end,f.end)-Math.max(start,f.start));if(!span)continue;coverage+=span;const v=10**((Number.isFinite(f.low)?f.low!:-90)/10),rise=Math.max(0,v-previous);previous=v;if(rise>1e-6){const i=Math.max(0,Math.min(slots-1,Math.floor((f.start-start)/(end-start)*slots)));hist[i]+=rise;onsets++}}
 const total=hist.reduce((s,v)=>s+v,0);return coverage>=(end-start)*.95&&total>1e-6&&onsets>=4?hist.map(v=>v/total):null
}
export function grooveConflict(a:Track,b:Track,exit:number,entry:number){const as=8*60/a.bpm,bs=8*60/b.bpm,x=onsetSignature(a,exit-as,exit),y=onsetSignature(b,entry,entry+bs);return x&&y?{value:Math.min(1,x.reduce((s,v,i)=>s+Math.abs(v-y[i]),0)/2),basis:'source-bound low-band onset phase distribution',unknown:false}:{value:.35,basis:'onset evidence incomplete; conservative uncertainty',unknown:true}}
export function measuredHalfDouble(a:Track,b:Track,exit:number,entry:number){
 const factor=([.5,2] as const).find(f=>Math.abs(a.bpm/(b.bpm*f)-1)<=.05);if(!factor)return null
 const seconds=8*60/a.bpm,x=onsetSignature(a,exit-seconds,exit),y=onsetSignature(b,entry,entry+seconds);if(!x||!y)return null
 // One-slot tolerance accounts for the published 50 ms band-frame resolution.
 let best=0;for(const shift of [-1,0,1]){let overlap=0;for(let i=0;i<x.length;i++)overlap+=Math.min(x[i],y[(i+shift+y.length)%y.length]);best=Math.max(best,overlap)}
 if(best<.62)return null
 return{factor,residualRate:a.bpm/(b.bpm*factor),onsetOverlap:best,source:{a:a.provenance,b:b.provenance},aExit:exit,bEntry:entry,verification:'measured-low-band-onset-correspondence',humanReview:'unscored' as const,basis:'native playback with bar-aligned cut; no 2x resampling or continuous beatmatch claim'}
}
