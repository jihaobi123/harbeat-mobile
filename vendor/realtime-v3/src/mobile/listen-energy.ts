import type {Track,Plan} from '../listen-upstream/realtime/planner'
import {sourceBound} from '../listen-upstream/v30/planner'
import {buildV30Eq} from '../listen-upstream/v30/eq'
function level(t:Track,start:number,end:number){
 if(!sourceBound(t)||start<0||end>t.duration)return null
 let cursor=start,power=0,total=0
 for(const f of t.alignment!.bandFrames){const s=Math.max(start,f.start),e=Math.min(end,f.end);if(e<=s)continue;if(Math.abs(s-cursor)>.005||f.rmsDbfs!==null&&!Number.isFinite(f.rmsDbfs))return null;power+=(f.rmsDbfs===null?0:10**(f.rmsDbfs/10))*(e-s);total+=e-s;cursor=e}
 return total>=end-start-.005&&power>0?10*Math.log10(power/total):null
}
/** Neutral is exactly the web ranking. Other explicit levels are a soft source
 * loudness preference; they never shorten or replace an eligible entry window. */
export function preferListenEnergy<T extends {best:Plan|null;candidates:Plan[]}>(result:T,a:Track,tracks:Track[],energy:number):T{
 if(energy===3||!result.best)return result
 const target=(energy-3)*1.25,candidates=result.candidates.map(p=>{
  const b=tracks.find(t=>t.id===p.to)!,before=level(a,Math.max(0,p.start-4),p.start),after=level(b,p.window.end,Math.min(b.duration,p.window.end+16))
  if(before===null||after===null)return p
  const delta=after-before,penalty=.12*Math.abs(delta-target),score=p.score-penalty
  const component={key:'mobileEnergy',label:'手机能量方向的实测 RMS 偏好',value:Math.abs(delta-target),weight:-.12,contribution:-penalty}
  return {...p,score,decision:p.decision?{...p.decision,score:{...p.decision.score,total:score,components:[...p.decision.score.components,component]}}:undefined}
 }).sort((x,y)=>y.score-x.score||y.end-x.end||x.id.localeCompare(y.id))
 while(candidates.length){const p=candidates[0];try{return {...result,candidates,best:{...p,v30Eq:buildV30Eq(a,tracks.find(t=>t.id===p.to)!,p)}}}catch{candidates.shift()}}
 return {...result,candidates,best:null}
}
