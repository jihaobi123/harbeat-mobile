import type {Asset,Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared} from '../metric-upstream/metric-mix/types'
import {validatePrepared} from './prepared'
import {validateExecutionTrack,type ExecutionTrack} from './device-execution'
import {rememberExecutionTrack,verifyExecutionProfile} from './device-prepare'
import {activityPlanningTrack,openActivityCandidates,futureActivityCandidates,type BoundActivityCandidate} from './activity-candidates'
import type {ActivityCoverage} from './activity-plan'
import {verifyJetsonDecision,type JetsonDecision} from './jetson-contract'
import {rememberJetsonPlan} from './jetson-client'
const hash=/^[a-f0-9]{64}$/
const identity=(a:Asset)=>[a?.sha256,a?.bytes,a?.duration,a?.rate??null]
const segments=(t:Track)=>(t.audioSegments??[]).map(s=>[s.start,s.end,identity(s.asset)])
function sameSource(a:Track,b:Track){return a.id===b.id&&a.reportId===b.reportId&&['runId','masterSha256','reportSha256','vocalSha256'].every(k=>a.provenance?.[k]===b.provenance?.[k]&&typeof a.provenance?.[k]==='string')&&JSON.stringify(identity(a.native))===JSON.stringify(identity(b.native))&&JSON.stringify(segments(a))===JSON.stringify(segments(b))}
export class ActivitySession{
 readonly ids:Set<string>
 private constructor(readonly packId:string,readonly name:string,readonly tracks:Track[],readonly results:Prepared[],readonly initialTrackId:string,private entries:Asset[]=[],private executionTracks:ExecutionTrack[]=[],private candidatePlans:BoundActivityCandidate[]=[],readonly cloudCoverage:ActivityCoverage|null=null,private strategies:{decision:JetsonDecision;a:Track;b:Track;plan:Plan}[]=[],readonly strategyVersion:string|null=null){this.ids=new Set(tracks.map(t=>t.id))}
 get candidateCount(){return this.candidatePlans.length||this.results.length}
 get strategyCount(){return this.strategies.length}
 candidates(a:Track,position:number,energy:number){return futureActivityCandidates(this.candidatePlans,a,position,energy)}
 approvedCandidates(a:Track,position:number,energy:number){const approved=new Set(this.strategies.map(s=>s.plan.id));return this.candidates(a,position,energy).filter(c=>approved.has(c.plan.id))}
 static async open(value:any,name:string,load:(id:string)=>Promise<Track>){
  if(value?.schema!=='harbeat.activity-set.v1'||!/[a-f0-9]{32}/.test(value.packId)||value.packId.length!==32||!['ready','partial'].includes(value.state)||!Array.isArray(value.trackIds)||value.trackIds.length<2||value.trackIds.length>12||new Set(value.trackIds).size!==value.trackIds.length||!Array.isArray(value.sourceFingerprints)||!Array.isArray(value.results)||value.results.length>24||!value.trackIds.includes(value.initialTrackId))throw Error('预约素材尚未就绪，请先完成准备')
  const tracks:Track[]=[]
  for(const id of value.trackIds){const source=value.sourceFingerprints.find((s:any)=>s.id===id),t=await load(id);if(!source||!sameSource(source,t))throw Error('预约的歌曲分析版本已更新，请重新准备 set');tracks.push(t)}
  const results:Prepared[]=[]
  for(const r of value.results){const a=tracks.find(t=>t.id===r?.plan?.from),b=tracks.find(t=>t.id===r?.plan?.to);if(!a||!b)throw Error('预约交接曲目不一致');validatePrepared(r,a,b,r.plan.start,r.plan.windowId,value.packId)
   for(const [side,t] of [['a',a],['b',b]] as const){const proof=r.sourceProof?.[side];if(proof?.trackId!==t.id||proof.runId!==t.provenance?.runId||proof.reportSha256!==t.provenance?.reportSha256||!hash.test(String(t.provenance?.masterSha256))||!hash.test(String(t.provenance?.vocalSha256))||proof.assets?.master?.sha256!==t.provenance?.masterSha256||proof.assets?.vocals?.sha256!==t.provenance?.vocalSha256)throw Error('预约交接的音源校验未通过')}
   results.push(r)
  }
  const execution=value.execution
  let candidatePlans:BoundActivityCandidate[]=[],cloudCoverage:ActivityCoverage|null=null
  const strategies:{decision:JetsonDecision;a:Track;b:Track;plan:Plan}[]=[]
  const deviceAssets:Asset[]=[]
  if(execution!==undefined){
   if(!['harbeat.activity-execution.v1','harbeat.activity-execution.v2'].includes(execution?.schema)||!Array.isArray(execution.tracks)||execution.tracks.length!==tracks.length||!Array.isArray(execution.edges)||!execution.edges.length||execution.edges.length>(execution.schema==='harbeat.activity-execution.v2'?288:24)||new Set(execution.tracks.map((t:any)=>t.trackId)).size!==tracks.length)throw Error('预约设备执行资料不完整')
   for(const manifest of execution.tracks){const track=tracks.find(t=>t.id===manifest?.trackId);if(!track)throw Error('预约分轨曲目不一致');const checked=validateExecutionTrack(manifest,track);rememberExecutionTrack(checked,track);for(const stem of Object.values(checked.stems))if(stem)deviceAssets.push(...stem.segments.map(s=>s.asset))}
   for(const edge of execution.edges){const p=edge.plan??edge,a=tracks.find(t=>t.id===p.from),b=tracks.find(t=>t.id===p.to),window=b?.windows.find(w=>w.id===p.windowId);if(!a||!b||a.id===b.id||!window||![p.start,p.end,p.duration,p.rate,p.bStart,p.bEnd].every(Number.isFinite)||p.start<0||p.end>a.duration||p.duration<1||p.duration>32||Math.abs(p.end-p.start-p.duration)>.01||p.rate<.95||p.rate>1.05||Math.abs(p.bStart-window.start)>.01||Math.abs(p.bEnd-window.end)>.01)throw Error('预约候选策略范围不一致')}
   if(execution.schema==='harbeat.activity-execution.v2'){const opened=openActivityCandidates(execution,tracks);candidatePlans=opened.plans;cloudCoverage=opened.coverage}
   if(execution.strategyVersion!==undefined){
    if(execution.schema!=='harbeat.activity-execution.v2'||execution.strategyVersion!=='jetson-decision-v1'||!Array.isArray(execution.strategies)||!execution.strategies.length||execution.strategies.length>candidatePlans.length||value.state==='ready'&&execution.strategies.length!==candidatePlans.length)throw Error('预约 Jetson 批准编排尚未完整准备')
    const ids=new Set<string>(),cues=new Set<string>()
    for(const raw of execution.strategies){
     const p=raw?.plan,candidate=candidatePlans.find(c=>c.edge.from===p?.from&&c.edge.to===p?.to&&c.edge.windowId===p?.windowId&&Math.abs(c.plan.start-p?.start)<.002),a=tracks.find(t=>t.id===p?.from),b=tracks.find(t=>t.id===p?.to)
     if(!candidate||!a||!b||ids.has(raw.id)||cues.has(candidate.plan.id))throw Error('预约 Jetson 批准接点不一致')
     const approved=await verifyJetsonDecision(raw,a,b,candidate.plan)
     for(const [side,t] of [['a',a],['b',b]] as const){const manifest=execution.tracks.find((m:any)=>m.trackId===t.id),proof=approved.sourceProof[side];if(manifest.manifestSha256!==proof.manifestSha256||manifest.profile.sha256!==proof.profileSha256||Object.entries(manifest.stems).some(([key,stem])=>(stem as any).sourceSha256!==proof.stemSha256[key as keyof typeof proof.stemSha256]))throw Error('预约 Jetson 批准的分轨版本不一致')}
     ids.add(approved.id);cues.add(candidate.plan.id);strategies.push({decision:approved,a,b,plan:candidate.plan})
    }
   }
  }
  if(!results.length&&!deviceAssets.length)throw Error('预约还没有可用的交接素材')
  const entries=results.flatMap(r=>{const b=tracks.find(t=>t.id===r.plan.to),asset=b?.windows?.find(w=>w.id===r.plan.windowId)?.variants[r.plan.from];return asset&&Math.abs(asset.rate-r.plan.rate)<.00001?[asset]:[]})
  const ids=new Set(tracks.map(t=>t.id)),retained=candidatePlans.length?tracks.map(t=>activityPlanningTrack(t,ids)):tracks.map(t=>({id:t.id,duration:t.duration,native:t.native,audioSegments:t.audioSegments,reportId:t.reportId,provenance:t.provenance} as Track))
  const byId=new Map(retained.map(t=>[t.id,t]));candidatePlans=candidatePlans.map(c=>({...c,track:byId.get(c.track.id)!}))
  const retainedStrategies=strategies.map(entry=>({...entry,a:byId.get(entry.a.id)!,b:byId.get(entry.b.id)!}))
  const session=new ActivitySession(value.packId,String(name).slice(0,80),retained,results,value.initialTrackId,[...entries,...deviceAssets],execution?.tracks??[],candidatePlans,cloudCoverage,retainedStrategies,execution?.strategyVersion??null)
  await session.cacheStrategies()
  return session
 }
 async cacheStrategies(base?:URL){for(const entry of this.strategies)await rememberJetsonPlan(entry.decision,entry.a,entry.b,entry.plan,base)}
 async cacheMetadata(base:URL,signal:AbortSignal){for(const t of this.executionTracks){signal.throwIfAborted();await verifyExecutionProfile(t,base,signal)}signal.throwIfAborted();await this.cacheStrategies(base)}
 find(a:Track,b:Track,plan:Plan){return this.results.find(r=>r.plan.from===a.id&&r.plan.to===b.id&&r.plan.windowId===plan.window.id&&Math.abs(r.plan.start-plan.start)<.002&&Math.abs(r.plan.end-plan.end)<.01&&Math.abs(r.plan.rate-plan.rate)<.00001&&Math.abs(r.plan.bStart-plan.window.start)<.01&&Math.abs(r.plan.bEnd-plan.window.end)<.05)??null}
 assets(){const assets:Asset[]=[];for(const r of this.results)for(const method of new Set(['original',r.decision.recommended])){const asset=r.assets[method as keyof typeof r.assets];if(asset)assets.push(asset)}assets.push(...this.entries);for(const t of this.tracks)assets.push(...(t.audioSegments?.length?t.audioSegments.map(s=>s.asset):[t.native]));return [...new Map(assets.map(a=>[a.sha256+':'+a.url,a])).values()]}
}
