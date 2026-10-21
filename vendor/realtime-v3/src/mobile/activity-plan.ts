import type {Track} from '../metric-upstream/realtime/planner'
import {buildV30Eq} from '../metric-upstream/v30/eq'
import {rankChoices,rankNearbyChoices,styleMatches,type SmartChoice} from './smart-selection'

export const ACTIVITY_CANDIDATE_VERSION='activity-candidate-v2'
export const ACTIVITY_MAX_EDGES=288
export const ACTIVITY_MAX_EDGES_PER_TRACK=24
export const ACTIVITY_REGIONS=8
export const ACTIVITY_TARGETS_PER_REGION=3
export type ActivitySourceIdentity={reportId:string;runId:string;masterSha256:string;reportSha256:string;vocalSha256:string}
export type ActivityEdge={id:string;version:typeof ACTIVITY_CANDIDATE_VERSION;from:string;to:string;windowId:string;start:number;end:number;duration:number;rate:number;bStart:number;bEnd:number;score:number;kind:'automatic'|'nearby';region:number;source:{a:ActivitySourceIdentity;b:ActivitySourceIdentity}}
export type ActivityCoverage={schema:'harbeat.activity-coverage.v1';maxEdgesPerTrack:number;maxTargetsPerRegion:number;regionsPerTrack:number;tracks:{trackId:string;regions:{index:number;start:number;end:number;candidates:number}[];complete:boolean}[]}
export const activitySourceIdentity=(t:Track):ActivitySourceIdentity=>({reportId:t.reportId??'',runId:String(t.provenance?.runId??''),masterSha256:String(t.provenance?.masterSha256??''),reportSha256:String(t.provenance?.reportSha256??''),vocalSha256:String(t.provenance?.vocalSha256??'')})

/** Bounded prepared alternatives, never permission to bypass a live musical gate.
 * Each saved choice comes from the exact existing automatic/nearby planners.
 * Coverage describes sampled cue regions, not a guarantee for every click time. */
export function planActivitySet(o:{tracks:(Track&{styleLabels:string[];playStatus?:string;mixStatus?:string})[];styles:string[];energy:number;maxTracks:number;retainedTrackIds?:string[]}){
 if(!Array.isArray(o.tracks)||o.tracks.length>64||!Array.isArray(o.styles)||!o.styles.length||o.styles.length>8||!Number.isInteger(o.energy)||o.energy<1||o.energy>5||!Number.isInteger(o.maxTracks)||o.maxTracks<4||o.maxTracks>12)throw Error('Invalid activity preparation bounds')
 if(o.retainedTrackIds!==undefined&&(!Array.isArray(o.retainedTrackIds)||!o.retainedTrackIds.length||o.retainedTrackIds.length>o.maxTracks||new Set(o.retainedTrackIds).size!==o.retainedTrackIds.length||o.retainedTrackIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(id))))throw Error('Invalid retained activity tracks')
 const retained=new Set(o.retainedTrackIds??[])
 const eligible=o.tracks.filter(t=>t.mixStatus!=='unavailable'&&t.playStatus!=='unavailable'&&(retained.has(t.id)||o.styles.some(s=>styleMatches(t.styleLabels,s))))
 const connectivity=(a:Track)=>eligible.filter(b=>a.id!==b.id&&a.bpm/b.bpm>=.95&&a.bpm/b.bpm<=1.05).length
 const ranked=[...eligible].sort((a,b)=>connectivity(b)-connectivity(a)||a.id.localeCompare(b.id))
 const tracks=o.retainedTrackIds?[...o.retainedTrackIds.flatMap(id=>{const t=eligible.find(t=>t.id===id);return t?[t]:[]}),...ranked.filter(t=>!retained.has(t.id))].slice(0,o.retainedTrackIds.length):ranked.slice(0,o.maxTracks)
 const edges:ActivityEdge[]=[],warnings:string[]=[]
 const coverage:ActivityCoverage={schema:'harbeat.activity-coverage.v1',maxEdgesPerTrack:ACTIVITY_MAX_EDGES_PER_TRACK,maxTargetsPerRegion:ACTIVITY_TARGETS_PER_REGION,regionsPerTrack:ACTIVITY_REGIONS,tracks:[]}
 for(const a of tracks){
  const options=tracks.filter(b=>b.id!==a.id),buckets=Array.from({length:ACTIVITY_REGIONS},()=>[] as ActivityEdge[])
  const add=(choice:SmartChoice,kind:ActivityEdge['kind'])=>{
   const p=choice.plan
   // rankChoices only computes final EQ for its first choice. Check every saved
   // alternative too, without weakening the underlying beat/vocal/level rules.
   try{buildV30Eq(a,choice.track,p)}catch{return}
   const region=Math.min(ACTIVITY_REGIONS-1,Math.floor(p.start/a.duration*ACTIVITY_REGIONS))
   const bucket=buckets[region]
   const existing=bucket.find(e=>e.from===p.from&&e.to===p.to&&e.windowId===p.window.id&&Math.abs(e.start-p.start)<.002)
   if(existing){if(kind==='automatic')existing.kind=kind;return}
   bucket.push({id:p.id,version:ACTIVITY_CANDIDATE_VERSION,from:p.from,to:p.to,windowId:p.window.id,start:p.start,end:p.end,duration:p.duration,rate:p.rate,bStart:p.window.start,bEnd:p.window.end,score:choice.score,kind,region,source:{a:activitySourceIdentity(a),b:activitySourceIdentity(choice.track)}})
  }
  const auto=rankChoices(a,options,0,o.energy,new Set())
  // Preserve automatic best and add target diversity at the same eligible late
  // regions; live automatic selection still follows the original ranking.
  const automaticTargets=new Set<string>()
  for(const choice of auto.choices){if(automaticTargets.has(choice.track.id))continue;add(choice,'automatic');automaticTargets.add(choice.track.id);if(automaticTargets.size>=ACTIVITY_TARGETS_PER_REGION)break}
  for(let region=0;region<ACTIVITY_REGIONS;region++){
   const position=region*a.duration/ACTIVITY_REGIONS
   const near=rankNearbyChoices(a,options,position,o.energy)
   for(const choice of near.choices.slice(0,ACTIVITY_TARGETS_PER_REGION))add(choice,'nearby')
  }
  const regions=buckets.map((bucket,index)=>{
   bucket.sort((a,b)=>Number(b.kind==='automatic')-Number(a.kind==='automatic')||b.score-a.score||a.start-b.start||a.id.localeCompare(b.id))
   const selected:ActivityEdge[]=[],targets=new Set<string>()
   for(const e of bucket){if(targets.has(e.to))continue;targets.add(e.to);selected.push(e);if(selected.length===ACTIVITY_TARGETS_PER_REGION)break}
   edges.push(...selected)
   return {index,start:index*a.duration/ACTIVITY_REGIONS,end:(index+1)*a.duration/ACTIVITY_REGIONS,candidates:selected.length}
  })
  const complete=regions.every(r=>r.candidates>0)
  coverage.tracks.push({trackId:a.id,regions,complete})
  if(!auto.best)warnings.push('automatic_exit_unavailable:'+a.id)
  if(!complete)warnings.push('candidate_coverage_gaps:'+a.id)
 }
 const initialTrackId=edges.filter(e=>e.kind==='automatic').sort((a,b)=>b.score-a.score||a.from.localeCompare(b.from))[0]?.from??tracks[0]?.id??''
 if(o.retainedTrackIds){for(const id of o.retainedTrackIds)if(!tracks.some(t=>t.id===id))warnings.push('retained_track_unavailable:'+id);for(const t of tracks)if(!retained.has(t.id))warnings.push('retained_track_replacement:'+t.id)}
 return {schema:'harbeat.activity-candidates.v2',trackIds:tracks.map(t=>t.id),initialTrackId,edges,coverage,tracks:tracks.map(t=>({id:t.id,title:t.title,bpm:t.bpm,duration:t.duration,styleLabels:t.styleLabels})),warnings}
}
