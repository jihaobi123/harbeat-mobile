import type {Track,Plan} from '../../listen-upstream/realtime/planner'
import type {DevicePrepared} from '../device-execution'
import {validateExecutionTrack} from '../device-execution'
import {canonicalJson} from '../jetson-contract'
import {prepareDevice,hasDevicePCM,pinDevicePCM,releaseDevicePCM,rememberExecutionTrack,type DevicePreparationPort} from '../device-prepare'

type Row={trackId:string;sourceSha256:string;reportSha256:string;runId:string;manifestSha256:string;profile:{sha256:string;url:string;bytes:number};stemSha256:Record<string,string>;assetsReady:boolean}
export type StemIndex={schema:'harbeat.execution-library.v1';tracks:Row[]}
const hash=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_-]{1,160}$/
export function readStemIndex(v:any):StemIndex{
 if(v?.schema!=='harbeat.execution-library.v1'||!Array.isArray(v.tracks)||v.tracks.length>5000)throw Error('分轨发布索引无效')
 const seen=new Set<string>()
 for(const r of v.tracks){const p=r.profile;if(!id.test(r.trackId)||seen.has(r.trackId)||!id.test(r.runId)||![r.sourceSha256,r.reportSha256,r.manifestSha256,p?.sha256,...['bass','other','vocals','drums'].map(k=>r.stemSha256?.[k])].every(x=>hash.test(x))||p.url!=='/listen/execution/profiles/'+p.sha256+'.json'||!Number.isInteger(p.bytes)||p.bytes<1||p.bytes>8*1024*1024||typeof r.assetsReady!=='boolean')throw Error('分轨发布身份不完整');seen.add(r.trackId)}
 return v
}
const published=(r:Row|undefined,t:Track)=>!!r&&r.assetsReady&&r.sourceSha256===t.provenance?.masterSha256&&r.reportSha256===t.provenance?.reportSha256&&r.runId===t.provenance?.runId&&r.stemSha256.vocals===t.provenance?.vocalSha256
export function stemPlanKey(a:Track,b:Track,p:Plan){return canonicalJson({a:{id:a.id,reportId:a.reportId,source:a.provenance},b:{id:b.id,reportId:b.reportId,source:b.provenance},window:{id:p.window.id,start:p.window.start,end:p.window.end,bars:p.window.bars},start:p.start,end:p.end,duration:p.duration,rate:p.rate,restore:p.restore,eq:p.v30Eq})}
export type PreparationPort=DevicePreparationPort&{cachedApprovalOnly?:()=>boolean;active:()=>{track:Track}|null;tracks:()=>Track[];log:(kind:string,data:Record<string,unknown>)=>void;changed:()=>void}
type Ready={key:string;source:NonNullable<ReturnType<PreparationPort['active']>>;plan:Plan;result:DevicePrepared;release:()=>void}
export class StemPreparation{
 private generation=0;private jobs=new Map<string,{controller:AbortController;promise:Promise<void>}>();private records=new Map<string,Ready>();private queue:Promise<unknown>=Promise.resolve();private states=new Map<string,{state:string;code:string;reason:string;plan:Plan}>();private disposed=false
 constructor(private port:PreparationPort,private index:StemIndex,private base:URL,private prepare:typeof prepareDevice=prepareDevice,private valid=hasDevicePCM,private pin=pinDevicePCM,private release=releaseDevicePCM){}
 private pair(p:Plan){const a=this.port.active()?.track,b=this.port.tracks().find(t=>t.id===p.to);return a?.id===p.from&&b?{a,b}:null}
 ready(p:Plan):DevicePrepared|null{const pair=this.pair(p);if(!pair)return null;const r=this.records.get(stemPlanKey(pair.a,pair.b,p));return r&&r.source===this.port.active()&&this.valid(r.result)?r.result:null}
 assess(plan:Plan):{canPrepare:boolean;code:string;reason:string}{
  const pair=this.pair(plan);if(!pair)return{canPrepare:false,code:'source-changed',reason:'当前歌曲或目标歌曲已变化'}
  for(const [label,t] of [['当前歌曲',pair.a],['下一首',pair.b]] as const){
   const row=this.index.tracks.find(r=>r.trackId===t.id)
   if(!row||!row.assetsReady)return{canPrepare:false,code:'source-unpublished',reason:label+'的分轨资料尚未完整发布；尚未进行当前接点的音乐适用性判断'}
   if(!published(row,t))return{canPrepare:false,code:'source-mismatch',reason:label+'的分轨与当前音源版本不一致，请刷新曲库'}
  }
  if(plan.rate<.95||plan.rate>1.05||plan.duration>32||plan.duration<1)return{canPrepare:false,code:'unsupported-window',reason:'本接点超出已验证分轨执行范围（1–32 秒、变速 ±5%）'}
  return{canPrepare:true,code:'pending',reason:'来源发布校验通过，等待当前接点的 Jetson 批准与本机 PCM'}
 }
 snapshot(targetId?:string|null){
  const rows=[...this.records.values()].filter(r=>r.source===this.port.active()&&(!targetId||r.plan.to===targetId)&&r.plan.start>=this.port.position+.2&&this.valid(r.result)),r=rows.at(-1)
  if(r)return{state:'ready',reason:r.result.decision.explanation,plan:r.plan,decision:r.result.decision,metrics:r.result.metrics,result:r.result}
  const s=targetId?this.states.get(targetId):[...this.states.values()].at(-1);return s??{state:'idle',reason:'',plan:null}
 }
 warm(plan:Plan):Promise<void>{
  const pair=this.pair(plan),source=this.port.active();if(this.disposed||!pair||!source)return Promise.resolve()
  const {a,b}=pair,key=stemPlanKey(a,b,plan),hit=this.records.get(key);if(hit&&this.valid(hit.result))return Promise.resolve()
  const job=this.jobs.get(key);if(job)return job.promise
  const fail=(reason:string,code='preparation-failed')=>{this.states.set(b.id,{state:'unavailable',code,reason,plan});this.port.log('stem_comparison_unavailable',{from:a.id,to:b.id,code,reason,start:plan.start});this.port.changed()}
  const assessment=this.assess(plan);if(!assessment.canPrepare){fail(assessment.reason,assessment.code);return Promise.resolve()}
  const token=this.generation,controller=new AbortController(),signal=controller.signal
  const check=()=>{signal.throwIfAborted();if(this.disposed||token!==this.generation||this.port.active()!==source)throw new DOMException('分轨比较已取消','AbortError')}
  this.states.set(b.id,{state:'preparing',code:'preparing',reason:'正在核验分轨交接方案；当前音乐继续播放',plan});this.port.changed()
  const promise=this.queue.catch(()=>{}).then(async()=>{
   let result:DevicePrepared|undefined;const timeout=setTimeout(()=>controller.abort(new DOMException('分轨比较超时','TimeoutError')),90000)
   try{
    check();if(this.records.size>=2){const [old,r]=this.records.entries().next().value!;r.release();this.release(r.result);this.records.delete(old)}
    // Refresh source metadata before prepareDevice's shared cache may be reused.
    if(this.prepare===prepareDevice)for(const t of [a,b]){
     const row=this.index.tracks.find(r=>r.trackId===t.id)!,response=await fetch(new URL('/listen/execution/tracks/'+t.id+'.json',this.base),{signal,cache:'no-store'});check()
     if(!response.ok)throw Error('分轨目录读取失败 '+response.status)
     const raw=await boundedManifest(response);check()
     const m=validateExecutionTrack(JSON.parse(new TextDecoder().decode(raw)),t)
     if(m.manifestSha256!==row.manifestSha256||m.profile.sha256!==row.profile.sha256||Object.entries(m.stems).some(([k,s])=>s&&s.sourceSha256!==row.stemSha256[k]))throw Error('分轨发布版本已变化，请刷新曲库')
     rememberExecutionTrack(m,t)
    }
    result=await this.prepare(this.port,a,b,plan,this.base,signal,{cachedApprovalOnly:this.port.cachedApprovalOnly?.()===true});check()
    if(!this.valid(result))throw Error('分轨缓冲已失效')
    const r:Ready={key,source,plan,result,release:this.pin(result)};this.records.set(key,r)
    this.states.set(b.id,{state:'ready',code:'ready',reason:result.decision.explanation,plan});this.port.log('stem_comparison_ready',{from:a.id,to:b.id,planId:result.id,method:result.decision.recommended,decision:result.decision,metrics:result.metrics,start:plan.start});this.port.changed()
   }catch(error){if(result)this.release(result);if(token===this.generation&&!this.disposed&&!signal.aborted)fail((error as Error).message)}
   finally{clearTimeout(timeout);if(this.jobs.get(key)?.controller===controller)this.jobs.delete(key)}
  })
  this.queue=promise;this.jobs.set(key,{controller,promise});return promise
 }
 retain(plan:Plan|null,committed=false){
  const pair=plan?this.pair(plan):null,key=pair&&plan?stemPlanKey(pair.a,pair.b,plan):null
  for(const [id,job] of this.jobs)if(id!==key){job.controller.abort();this.jobs.delete(id)}
  for(const [id,r] of this.records)if(committed&&id!==key){r.release();this.release(r.result);this.records.delete(id)}
  for(const id of this.states.keys())if(committed&&id!==plan?.to)this.states.delete(id)
 }
 cancel(){this.generation++;for(const j of this.jobs.values())j.controller.abort();this.jobs.clear();for(const r of this.records.values()){r.release();this.release(r.result)}this.records.clear();this.states.clear()}
 setIndex(index:StemIndex){this.cancel();this.index=index}
 dispose(){this.disposed=true;this.cancel()}
}

async function boundedManifest(response:Response){const limit=4*1024*1024,reader=response.body?.getReader();if(!reader)throw Error('分轨目录为空');const parts:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('分轨目录超出预算');parts.push(value)}const out=new Uint8Array(size);let at=0;for(const part of parts){out.set(part,at);at+=part.length}return out.buffer}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}}
