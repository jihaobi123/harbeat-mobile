import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import {buildV30Eq} from '../metric-upstream/v30/eq'
import {requireBoundVocals} from '../metric-upstream/vocal-overlap/planner'
import {choiceForPlan,rankChoices} from './smart-selection'
import {ACTIVITY_CANDIDATE_VERSION,ACTIVITY_MAX_EDGES,ACTIVITY_MAX_EDGES_PER_TRACK,ACTIVITY_REGIONS,activitySourceIdentity,type ActivityEdge,type ActivityCoverage} from './activity-plan'

export type ActivityCandidate={track:Track;plan:Plan}
export type BoundActivityCandidate=ActivityCandidate&{edge:ActivityEdge}
const sameIdentity=(a:unknown,b:unknown)=>!!a&&!!b&&['reportId','runId','masterSha256','reportSha256','vocalSha256'].every(k=>typeof (a as any)[k]==='string'&&(a as any)[k].length>0&&(a as any)[k]===(b as any)[k])
const close=(a:number,b:number,tolerance=.002)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<tolerance
const matches=(p:Plan,e:ActivityEdge)=>p.id===e.id&&p.window.id===e.windowId&&close(p.start,e.start)&&close(p.end,e.end)&&close(p.duration,e.duration)&&close(p.rate,e.rate,.000001)&&close(p.window.start,e.bStart)&&close(p.window.end,e.bEnd)

/** Reconstruct one exact stored edge for shared cloud/device verification. */
export function planForActivityEdge(a:Track,b:Track,e:ActivityEdge,energy:number):Plan|null{
 const w=b.windows.find(w=>w.id===e.windowId);if(!w||!['automatic','nearby'].includes(e.kind))return null
 const target={...b,windows:[w]},position=Math.max(0,e.start-.75)
 const rows=e.kind==='automatic'?rankChoices(a,[target],0,energy).choices.map(c=>c.plan):planContinuous(a,[target],position,{kind:'next',targetId:b.id},new Set(),Math.min(60,e.end-position+.01),false).candidates
 const candidate=rows.find(p=>matches(p,e));if(!candidate)return null
 const plan={...candidate,v30Eq:buildV30Eq(a,b,candidate)}
 return choiceForPlan(a,b,plan,energy)?plan:null
}

/** Retain planning evidence, not unrelated report extensions or other sets' variants. */
export function activityPlanningTrack(t:Track,ids:Set<string>):Track{
 const preprocessing=t.preprocessing?Object.fromEntries(['schema','reportId','reportSha256','masterSha256','bindingChecks','vocalActivity'].map(k=>[k,(t.preprocessing as any)[k]])) as Track['preprocessing']:undefined
 return {id:t.id,title:t.title,bpm:t.bpm,style:t.style,styleScore:t.styleScore,duration:t.duration,native:t.native,audioSegments:t.audioSegments,bars:t.bars,sections:t.sections,vocals:t.vocals,energy:t.energy,reportId:t.reportId,provenance:t.provenance,alignment:t.alignment,mixProfile:t.mixProfile,warnings:t.warnings,preprocessing,
  windows:t.windows.map(w=>({...w,variants:Object.fromEntries(Object.entries(w.variants).filter(([id])=>ids.has(id)))}))}
}

export function openActivityCandidates(value:any,tracks:Track[]):{plans:BoundActivityCandidate[];coverage:ActivityCoverage}{
 if(value.schema!=='harbeat.activity-execution.v2'||!Number.isInteger(value.energy)||value.energy<1||value.energy>5||!Array.isArray(value.edges)||!value.edges.length||value.edges.length>ACTIVITY_MAX_EDGES)throw Error('预约多接点策略不完整')
 const byId=new Map(tracks.map(t=>[t.id,t])),counts=new Map<string,number>(),ids=new Set<string>(),plans:BoundActivityCandidate[]=[]
 for(const e of value.edges as ActivityEdge[]){
  const a=byId.get(e.from),b=byId.get(e.to),w=b?.windows.find(w=>w.id===e.windowId)
  if(!a||!b||!w||a.id===b.id||e.version!==ACTIVITY_CANDIDATE_VERSION||typeof e.id!=='string'||ids.has(e.id)||!['automatic','nearby'].includes(e.kind)||![e.start,e.end,e.duration,e.rate,e.bStart,e.bEnd,e.score].every(Number.isFinite)||!Number.isInteger(e.region)||e.region<0||e.region>=ACTIVITY_REGIONS||e.region!==Math.min(7,Math.floor(e.start/a.duration*8))||e.start<0||e.end>a.duration||e.duration<1||e.duration>32||e.rate<.95||e.rate>1.05||!close(e.end-e.start,e.duration)||!close((e.bEnd-e.bStart)/e.rate,e.duration)||!sameIdentity(e.source?.a,activitySourceIdentity(a))||!sameIdentity(e.source?.b,activitySourceIdentity(b)))throw Error('预约接点的来源或范围已变化')
  counts.set(a.id,(counts.get(a.id)??0)+1);if(counts.get(a.id)!>ACTIVITY_MAX_EDGES_PER_TRACK)throw Error('预约接点数量超过设备范围')
  ids.add(e.id)
  const plan=planForActivityEdge(a,b,e,value.energy)
  if(!plan)throw Error('预约候选未通过当前拍点、人声或能量规则')
  plans.push({edge:e,track:b,plan})
 }
 const c=value.coverage
 if(c?.schema!=='harbeat.activity-coverage.v1'||c.maxEdgesPerTrack!==24||c.maxTargetsPerRegion!==3||c.regionsPerTrack!==8||!Array.isArray(c.tracks)||c.tracks.length!==tracks.length||new Set(c.tracks.map((t:any)=>t.trackId)).size!==tracks.length)throw Error('预约接点覆盖资料不一致')
 for(const row of c.tracks){const t=byId.get(row.trackId);if(!t||!Array.isArray(row.regions)||row.regions.length!==8)throw Error('预约接点覆盖资料不一致');for(let i=0;i<8;i++){const r=row.regions[i],edges=plans.filter(p=>p.edge.from===t.id&&p.edge.region===i);if(r.index!==i||!close(r.start,i*t.duration/8)||!close(r.end,(i+1)*t.duration/8)||r.candidates!==edges.length||edges.length>3||new Set(edges.map(p=>p.track.id)).size!==edges.length)throw Error('预约接点覆盖资料不一致')}if(row.complete!==row.regions.every((r:any)=>r.candidates>0))throw Error('预约接点覆盖资料不一致')}
 return {plans,coverage:c}
}

export function futureActivityCandidates(plans:BoundActivityCandidate[],a:Track,position:number,energy:number):ActivityCandidate[]{
 if(!Number.isFinite(position)||!Number.isInteger(energy)||energy<1||energy>5)return[]
 try{requireBoundVocals(a)}catch{return[]}
 return plans.filter(p=>p.edge.from===a.id&&p.plan.start>=position+.5&&sameIdentity(p.edge.source.a,activitySourceIdentity(a)))
  .map(({track,plan}):ActivityCandidate|null=>{try{const current:Plan={...plan,v30Eq:buildV30Eq(a,track,plan)};return choiceForPlan(a,track,current,energy)?{track,plan:current}:null}catch{return null}})
  .filter((x):x is ActivityCandidate=>x!==null).sort((a,b)=>a.plan.start-b.plan.start||b.plan.score-a.plan.score||a.plan.id.localeCompare(b.plan.id))
}
