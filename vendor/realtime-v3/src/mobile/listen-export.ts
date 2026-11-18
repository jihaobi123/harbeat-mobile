import type {LibraryEntry} from '../listen-upstream/continuous/catalog'

type RecordValue=Record<string,any>
export const listenAuditPolicy={version:'listen-portable-audit-v1',catalog:'source-bound-references',searchCandidates:'selected candidate and first 3 ranks; omitted count explicit',searchExclusions:'counts-and-reasons; repeated rejected-cue samples omitted',appliedPlans:'original timing, DSP, identities and selected entry variant',allEventsRetained:true}
const omitted=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):0
const window=(w:RecordValue|undefined,from?:string)=>w&&from?{...w,variants:w.variants?.[from]?{[from]:w.variants[from]}:{}}:w
/** Bound audit copies at capture and export; planner inputs remain untouched. */
export function compactListenEvent(event:RecordValue):RecordValue{
 if(event.kind==='decision_search'&&event.result){
  const candidates=event.result.candidates as RecordValue[]|undefined,selected=candidates?.find(c=>c.id===event.result.selectedId),kept=candidates?.slice(0,3)
  if(selected&&kept&&!kept.includes(selected))kept.push(selected)
  return {...event,result:{...event.result,candidates:kept,omittedCandidateCount:omitted(event.result.omittedCandidateCount)+(candidates?candidates.length-kept!.length:0),
   exclusions:event.result.exclusions?.map(({samples,...row}:RecordValue)=>samples?{...row,omittedSampleCount:omitted(row.omittedSampleCount)+samples.length}:row)}}
 }
 if(event.kind!=='plan_scheduled')return event
 const from=event.plan?.from??event.trace?.a?.id
 return {...event,plan:event.plan?{...event.plan,window:window(event.plan.window,from)}:event.plan,
  trace:event.trace?.material?{...event.trace,material:{...event.trace.material,window:window(event.trace.material.window,from)}}:event.trace}
}
/** Immutable report/detail references replace repeated source vectors in exports. */
export function exportListenAudit<T extends RecordValue>(value:T,entries:readonly Pick<LibraryEntry,'id'|'detailUrl'>[]){
 const details=new Map(entries.map(t=>[t.id,t.detailUrl]))
 const catalog=value.catalog?.map((t:RecordValue)=>({
  ...t,detailUrl:details.get(t.id)??t.detailUrl,
  windows:t.windows?.map(({variants,...w}:RecordValue)=>w),
  alignment:t.alignment?{source:t.alignment.source}:undefined,
  preprocessing:t.preprocessing?Object.fromEntries(['schema','reportId','reportSha256','masterSha256','bindingChecks','reportSnapshotUrl'].filter(k=>t.preprocessing[k]!==undefined).map(k=>[k,t.preprocessing[k]])):undefined,
 }))
 const logs=value.logs?.map(compactListenEvent)
 return {...value,catalog,logs,exportPolicy:listenAuditPolicy}
}
