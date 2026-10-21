import type {Asset,Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared} from '../metric-upstream/metric-mix/types'
import {validatePrepared} from './prepared'
const hash=/^[a-f0-9]{64}$/
const identity=(a:Asset)=>[a?.sha256,a?.bytes,a?.duration,a?.rate??null]
const segments=(t:Track)=>(t.audioSegments??[]).map(s=>[s.start,s.end,identity(s.asset)])
function sameSource(a:Track,b:Track){return a.id===b.id&&a.reportId===b.reportId&&['runId','masterSha256','reportSha256','vocalSha256'].every(k=>a.provenance?.[k]===b.provenance?.[k]&&typeof a.provenance?.[k]==='string')&&JSON.stringify(identity(a.native))===JSON.stringify(identity(b.native))&&JSON.stringify(segments(a))===JSON.stringify(segments(b))}
export class ActivitySession{
 readonly ids:Set<string>
 private constructor(readonly packId:string,readonly name:string,readonly tracks:Track[],readonly results:Prepared[],readonly initialTrackId:string,private entries:Asset[]=[]){this.ids=new Set(tracks.map(t=>t.id))}
 static async open(value:any,name:string,load:(id:string)=>Promise<Track>){
  if(value?.schema!=='harbeat.activity-set.v1'||!/[a-f0-9]{32}/.test(value.packId)||value.packId.length!==32||!['ready','partial'].includes(value.state)||!Array.isArray(value.trackIds)||value.trackIds.length<2||value.trackIds.length>12||new Set(value.trackIds).size!==value.trackIds.length||!Array.isArray(value.sourceFingerprints)||!Array.isArray(value.results)||value.results.length>24||!value.trackIds.includes(value.initialTrackId))throw Error('预约素材尚未就绪，请先完成准备')
  const tracks:Track[]=[]
  for(const id of value.trackIds){const source=value.sourceFingerprints.find((s:any)=>s.id===id),t=await load(id);if(!source||!sameSource(source,t))throw Error('预约的歌曲分析版本已更新，请重新准备 set');tracks.push(t)}
  const results:Prepared[]=[]
  for(const r of value.results){const a=tracks.find(t=>t.id===r?.plan?.from),b=tracks.find(t=>t.id===r?.plan?.to);if(!a||!b)throw Error('预约交接曲目不一致');validatePrepared(r,a,b,r.plan.start,r.plan.windowId,value.packId)
   for(const [side,t] of [['a',a],['b',b]] as const){const proof=r.sourceProof?.[side];if(proof?.trackId!==t.id||proof.runId!==t.provenance?.runId||proof.reportSha256!==t.provenance?.reportSha256||!hash.test(String(t.provenance?.masterSha256))||!hash.test(String(t.provenance?.vocalSha256))||proof.assets?.master?.sha256!==t.provenance?.masterSha256||proof.assets?.vocals?.sha256!==t.provenance?.vocalSha256)throw Error('预约交接的音源校验未通过')}
   results.push(r)
  }
  if(!results.length)throw Error('预约还没有可用的交接素材')
  const entries=results.flatMap(r=>{const b=tracks.find(t=>t.id===r.plan.to),asset=b?.windows?.find(w=>w.id===r.plan.windowId)?.variants[r.plan.from];return asset&&Math.abs(asset.rate-r.plan.rate)<.00001?[asset]:[]})
  const retained=tracks.map(t=>({id:t.id,duration:t.duration,native:t.native,audioSegments:t.audioSegments,reportId:t.reportId,provenance:t.provenance} as Track))
  return new ActivitySession(value.packId,String(name).slice(0,80),retained,results,value.initialTrackId,entries)
 }
 find(a:Track,b:Track,plan:Plan){return this.results.find(r=>r.plan.from===a.id&&r.plan.to===b.id&&r.plan.windowId===plan.window.id&&Math.abs(r.plan.start-plan.start)<.002&&Math.abs(r.plan.end-plan.end)<.01&&Math.abs(r.plan.rate-plan.rate)<.00001&&Math.abs(r.plan.bStart-plan.window.start)<.01&&Math.abs(r.plan.bEnd-plan.window.end)<.05)??null}
 assets(){const assets:Asset[]=[];for(const r of this.results)for(const method of new Set(['original',r.decision.recommended])){const asset=r.assets[method as keyof typeof r.assets];if(asset)assets.push(asset)}assets.push(...this.entries);for(const t of this.tracks)assets.push(...(t.audioSegments?.length?t.audioSegments.map(s=>s.asset):[t.native]));return [...new Map(assets.map(a=>[a.sha256+':'+a.url,a])).values()]}
}
