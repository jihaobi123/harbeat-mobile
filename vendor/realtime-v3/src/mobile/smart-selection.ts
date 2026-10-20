import type {Track,Plan} from '../metric-upstream/realtime/planner'
import type {LibraryEntry} from '../metric-upstream/continuous/catalog'
import {planAutomaticQuality} from '../metric-upstream/continuous/qualityPlan'
import {sourceBound} from '../metric-upstream/v30/planner'
import {buildV30Eq} from '../metric-upstream/v30/eq'
import {nearbyPlan} from './nearby'

export const SMART_POLICY='mobile-direction-quality-v1'
export const styleKey=(value:string)=>value.toLocaleLowerCase().replace(/[\s_-]/g,'')
export function shortlist(entries:LibraryEntry[],current:LibraryEntry,style:string,recent:string[],excluded:Set<string>,explicit?:string|null,preferred?:string|null){
 const options=entries.filter(t=>t.id!==current.id&&t.playStatus==='ready'&&t.mixStatus==='ready'&&!excluded.has(t.id)&&
  (!explicit||t.id===explicit)&&(!style||explicit||t.styleLabels.some(s=>styleKey(s)===styleKey(style)))&&
  !!t.bpm&&!!current.bpm&&current.bpm/t.bpm>=.94&&current.bpm/t.bpm<=1.06)
 const fresh=options.filter(t=>!recent.includes(t.id)),pool=fresh.length&&!explicit?fresh:options
 const sorted=pool.sort((a,b)=>{
  const cost=(t:LibraryEntry)=>Math.abs(Math.log(t.bpm!/current.bpm!))+(t.styleLabels.some(s=>current.styleLabels.includes(s))?0:.02)
  return cost(a)-cost(b)||a.id.localeCompare(b.id)
 }).slice(0,8)
 const displayed=preferred?options.find(t=>t.id===preferred):undefined
 return displayed?[displayed,...sorted.filter(t=>t.id!==displayed.id)].slice(0,8):sorted
}

/** A common digital source-power proxy. Never use per-song normalized energy
 * curves, missing values, model genre or playback volume as this measurement. */
export function measuredLevel(track:Track,start:number,end:number):number|null {
 if(!sourceBound(track)||track.alignment!.source.reportId!==track.reportId||end<=start||start<0||end>track.duration+.002)return null
 let cursor=start,power=0,covered=0
 for(const f of track.alignment!.bandFrames){
  const s=Math.max(start,f.start),e=Math.min(end,f.end);if(e<=s)continue
  if(!Number.isFinite(s)||!Number.isFinite(e)||Math.abs(s-cursor)>.005||f.rmsDbfs===undefined||f.rmsDbfs!==null&&!Number.isFinite(f.rmsDbfs))return null
  power+=(f.rmsDbfs===null?0:10**(f.rmsDbfs/10))*(e-s);covered+=e-s;cursor=e
 }
 return covered>=end-start-.005&&power>0?10*Math.log10(power/covered):null
}
export type SmartChoice={plan:Plan;track:Track;score:number;energy:{beforeDb:number;afterDb:number[];deltasDb:number[];targetDeltaDb:number};reason:string}
export function choiceForPlan(a:Track,b:Track,p:Plan,energy:number):SmartChoice|null{
 const level=Math.round(Math.max(1,Math.min(5,energy))),target=(level-3)*1.25
 if(p.window.end+16>b.duration)return null
 const before=measuredLevel(a,p.start-4,p.start),after=Array.from({length:4},(_,i)=>measuredLevel(b,p.window.end+i*4,p.window.end+(i+1)*4))
 if(before===null||after.some(x=>x===null))return null
 const afterDb=after as number[],deltas=afterDb.map(x=>x-before)
 if(deltas.some(x=>Math.abs(x)>6)||(level>3&&deltas.some(x=>x<1))||(level<3&&deltas.some(x=>x> -1)))return null
 const distance=deltas.reduce((s,x)=>s+Math.abs(x-target),0)/4
 return {plan:p,track:b,score:p.score-.12*distance,energy:{beforeDb:before,afterDb,deltasDb:deltas,targetDeltaDb:target},reason:`完整 ${p.window.bars} 小节 · 接管后 16 秒能量${level>3?'持续提升':level<3?'持续降低':'接近当前方向'} · ${p.section}附近`}
}
export function rankChoices(a:Track,tracks:Track[],position:number,energy:number,ready=new Set<string>()){
 const choices:SmartChoice[]=[],rejected:string[]=[]
 for(const source of tracks){
  // Keep the original evidence and source identities, but exclude windows the
  // current metric worker cannot render before asking the upstream cue planner.
  const b={...source,windows:source.windows.filter(w=>{const v=w.variants[a.id];return !!v&&v.rate>=.95&&v.rate<=1.05&&v.duration>=1&&v.duration<=32&&[2,4,8].includes(w.bars)})}
  const planned=planAutomaticQuality(a,[b],position,{kind:'next',targetId:b.id},ready,false)
  for(const p of planned.candidates){
   const choice=choiceForPlan(a,source,p,energy);if(choice)choices.push(choice)
  }
  if(!choices.some(c=>c.track.id===b.id))rejected.push(b.id)
 }
 choices.sort((a,b)=>b.score-a.score||b.plan.end-a.plan.end||a.plan.id.localeCompare(b.plan.id))
 // A failing final EQ check must not hide another valid candidate.
 while(choices.length){try{choices[0].plan={...choices[0].plan,v30Eq:buildV30Eq(a,choices[0].track,choices[0].plan)};break}catch{choices.shift()}}
 return {best:choices[0]??null,choices,rejected,policy:SMART_POLICY}
}

export const NEARBY_DIRECTION_POLICY='mobile-direction-nearby-v1'
export function rankNearbyChoices(a:Track,tracks:Track[],position:number,energy:number){
 const choices:SmartChoice[]=[],rejected:string[]=[]
 for(const b of tracks){
  const plan=nearbyPlan(a,b,position,new Set(),p=>!!choiceForPlan(a,b,p,energy))
  const choice=plan?choiceForPlan(a,b,plan,energy):null
  if(choice)choices.push(choice);else rejected.push(b.id)
 }
 choices.sort((a,b)=>a.plan.start-b.plan.start||b.score-a.score||a.plan.id.localeCompare(b.plan.id))
 return {best:choices[0]??null,choices,rejected,policy:NEARBY_DIRECTION_POLICY}
}
