import {valueAt,type Point} from '../device-execution'
import type {Scene,Layer} from './contract'
export type ReturnExit={at:number;aPosition:number;peak:number;scenePeak:number;handoffPeak:number;nativeBodyPeak:number;nativeBodySeconds:16;layers:Layer[];aQuiet:Quiet;bQuiet:Quiet;compatibility:{pitchedRisk:number;incompatiblePitchedSeconds:number;drumOverlapSeconds:number;drumOverlapLimit:number;drumDensityRatio:number|null;drumOnsetAgreement:number|null;drumEvidence:string;pass:true}}
type Quiet={start:number;end:number;intervalsClear:true;coverageVerified:true;maximumFrameDb:number}
export type ReturnEvidence={timeline:'slip';verifierSha256:string;exits:ReturnExit[]}
const near=(a:unknown,b:number)=>typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<1/44100
/** The extra evidence covers actual return curves, not the embedded B takeover. */
export function validateReturnEvidence(s:Scene,v:any):ReturnEvidence{
 const fail=()=>{throw Error('返回原曲缺少匹配的声部曲线、人声空隙或原曲测量')}
 const quiet=(q:any,start:number,end:number)=>q&&near(q.start,start)&&near(q.end,end)&&q.intervalsClear===true&&q.coverageVerified===true&&Number.isFinite(q.maximumFrameDb)&&q.maximumFrameDb<=-45&&q.maximumFrameDb>=-240
 if(!v||v.timeline!=='slip'||typeof v.verifierSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.verifierSha256)||!Array.isArray(v.exits)||!v.exits.length||v.exits.length>s.exits.length)fail()
 for(let i=0;i<v.exits.length;i++){
  const r=v.exits[i],e=s.exits.find(e=>near(r?.at,e.at));if(!e||i&&r.at<=v.exits[i-1].at||!near(r.aPosition,s.clips.aStart+e.at)||r.nativeBodySeconds!==16||![r.peak,r.scenePeak,r.handoffPeak,r.nativeBodyPeak].every(x=>Number.isFinite(x)&&x>=0&&x<=.95)||r.peak+1e-8<Math.max(r.scenePeak,r.handoffPeak,r.nativeBodyPeak))fail()
  if(!quiet(r.aQuiet,r.aPosition-.15,r.aPosition+.3)||!quiet(r.bQuiet,s.clips.bStart+e!.fadeStart-.1,e!.bPosition+.1))fail()
  const c=r.compatibility,limit=30/s.bpm+.02
  if(!c||c.pass!==true||!Number.isFinite(c.pitchedRisk)||c.pitchedRisk<0||c.pitchedRisk>.35||!Number.isFinite(c.incompatiblePitchedSeconds)||c.incompatiblePitchedSeconds<0||c.incompatiblePitchedSeconds>limit||!Number.isFinite(c.drumOverlapSeconds)||c.drumOverlapSeconds<0||!near(c.drumOverlapLimit,limit)||c.drumOverlapSeconds>limit&&!(c.drumEvidence==='observed'&&Number.isFinite(c.drumOnsetAgreement)&&c.drumOnsetAgreement>=.5&&c.drumOnsetAgreement<=1&&Number.isFinite(c.drumDensityRatio)&&c.drumDensityRatio>=0&&c.drumDensityRatio<=2.5))fail()
  if(!Array.isArray(r.layers)||r.layers.length!==s.layers.length)fail()
  const seen=new Set<string>()
  for(const l of r.layers){const original=s.layers.find(o=>o.side===l?.side&&o.role===l?.role),key=l?.side+':'+l?.role;if(!original||l.loop!==original.loop||seen.has(key)||!Array.isArray(l.points)||l.points.length<2||l.points.length>40)fail();seen.add(key)
   for(let j=0;j<l.points.length;j++){const p=l.points[j],q=l.points[j-1];if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[0]>e!.at||p[1]<0||p[1]>1||q&&(p[0]<=q[0]||Math.abs(p[1]-q[1])/(p[0]-q[0])>20.0001))fail()}
   if(l.points[0][0]!==0||!near(l.points.at(-1)[0],e!.at)||l.points.at(-1)[1]!==Number(l.side==='a'))fail()
   // Alternate exits may only change the still-future final fade.
   for(const t of new Set<number>([0,e!.fadeStart,...l.points.map((p:Point)=>p[0]),...original!.points.map(p=>p[0])].filter(t=>t<=e!.fadeStart)))if(Math.abs(valueAt(l.points,t)-valueAt(original!.points,t))>1e-7)fail()
  }
  for(const role of ['bass','drums','other']){const a=r.layers.find((l:Layer)=>l.side==='a'&&l.role===role),b=r.layers.find((l:Layer)=>l.side==='b'&&l.role===role);for(const t of new Set<number>([...a.points,...b.points].map((p:Point)=>p[0])))if(valueAt(a.points,t)+valueAt(b.points,t)>1.00001)fail()}
 }
 return v
}
