import type {AudioCache} from '../../listen-upstream/realtime/cache'
import type {Track} from '../../listen-upstream/realtime/planner'
import {canonicalJson} from '../jetson-contract'
import type {LiveCatalog,LivePrepared} from './live-catalog'
import type {Entry} from './live-contract'
import {validateMulti,multiIdentity} from './multi-contract'
import {prepareExtra,readMetadataBytes} from './multi-prepare'
import {extraDeadline} from './extra-deadline'
import {validateRole,verifyRoleHashes} from './role-contract'
import {prepareRoles} from './role-prepare'
import type {RolePCM} from './role-graph'
import type {ExtraPCM} from './multi-graph'
export type MultiMode='off'|'c'|'cd'|'roles-c'|'roles-cd'
type Row={baseId:string;sha256:string;url:string;sources:1|2}
type Dependencies={playing?:()=>boolean;read?:typeof readMetadataBytes;digest?:(bytes:ArrayBuffer)=>Promise<string>;prepareExtra?:typeof prepareExtra;prepareRoles?:typeof prepareRoles;log?:(kind:string,data:Record<string,unknown>)=>void}
const hash=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const digest=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(v=>v.toString(16).padStart(2,'0')).join('')
/** C/D is optional: failure never replaces an already approved AB fallback. */
export class MultiCatalog{
 private rows:Row[]=[];private lifetime=new AbortController();private prepared:LivePrepared|null=null
 constructor(private original:Pick<LiveCatalog,'load'|'prepare'|'candidates'|'dispose'>,private ctx:AudioContext,private shared:AudioCache,private base:URL,readonly mode:MultiMode,private deps:Dependencies={}){}
 async load(signal:AbortSignal){const s=AbortSignal.any([signal,this.lifetime.signal]),rows=await this.original.load(s);this.rows=[]
  const roles=this.mode==='roles-c'||this.mode==='roles-cd',route=roles?'/listen/role-replacement/v1/':'/listen/multi-layering/v1/'
  if(this.mode!=='off')try{const b=await(this.deps.read??readMetadataBytes)(route+'index.json',this.base,s);s.throwIfAborted();if(b.byteLength>2*1024*1024)throw Error('多来源目录超过预算');const v=JSON.parse(new TextDecoder().decode(b));if(v.schema!==(roles?'harbeat.role-replacement-index.v1':'harbeat.multi-layering-index.v1')||!Array.isArray(v.scenes)||v.scenes.length>256||v.scenes.some((r:Row)=>!r||!hash(r.baseId)||!hash(r.sha256)||![1,2].includes(r.sources)||r.url!==route+r.sha256+'.json'))throw Error('多来源目录指纹无效');this.rows=v.scenes}catch(error){s.throwIfAborted();this.deps.log?.('multi_layering_unavailable',{reason:(error as Error).message})}return rows
 }
 candidates(a:Track,targets:Track[],position:number){return this.original.candidates(a,targets,position)}
 async prepare(entry:Entry,a:Track,b:Track,position:()=>number,signal:AbortSignal):Promise<LivePrepared>{
  const s=AbortSignal.any([signal,this.lifetime.signal]);s.throwIfAborted();let extra:ExtraPCM|RolePCM|undefined
  const roles=this.mode==='roles-c'||this.mode==='roles-cd',row=this.rows.find(r=>r.baseId===entry.id&&r.sources===(this.mode==='cd'||this.mode==='roles-cd'?2:1))
  const canTry=entry.sourcePosition-position()>12
  if(row&&canTry){const deadline=extraDeadline(entry.sourcePosition,position,this.deps.playing??(()=>true),s);try{
   const extraSignal=deadline.signal,bytes=await(this.deps.read??readMetadataBytes)(row.url,this.base,extraSignal);extraSignal.throwIfAborted();if(bytes.byteLength>2*1024*1024||await(this.deps.digest??digest)(bytes)!==row.sha256)throw Error('多来源批准哈希不一致')
   if(roles){const approval=validateRole(JSON.parse(new TextDecoder().decode(bytes)));await verifyRoleHashes(approval,this.deps.digest??digest);extraSignal.throwIfAborted();if(approval.mode!==this.mode||approval.base.id!==entry.id||Object.keys(approval.sources).length!==row.sources)throw Error('角色替换参照或模式不一致');extra=await(this.deps.prepareRoles??prepareRoles)(approval,this.ctx,this.shared,this.base,extraSignal);if((this.deps.playing?.()??true)&&entry.sourcePosition-position()<=12)throw Error('角色替换准备已进入 A/B 预留时间')}
   else{const approval=validateMulti(JSON.parse(new TextDecoder().decode(bytes)));if(await(this.deps.digest??digest)(new TextEncoder().encode(canonicalJson(multiIdentity(approval))).buffer)!==approval.evidence.arrangementSha256)throw Error('多来源测量与具体时间线指纹不符');if(approval.base.id!==entry.id||Object.keys(approval.sources).length!==row.sources)throw Error('多来源参照身份不一致');extra=await(this.deps.prepareExtra??prepareExtra)(approval,this.ctx,this.shared,this.base,extraSignal)}
   extraSignal.throwIfAborted()
  }catch(error){extra?.release();extra=undefined;s.throwIfAborted();this.deps.log?.('multi_layering_fallback_ab',{baseId:entry.id,reason:(error as Error).message})}finally{deadline.dispose()}}
  let ready:LivePrepared|undefined
  try{try{ready=await this.original.prepare(entry,a,b,position,s)}catch(error){if(!extra)throw error;extra.release();extra=undefined;s.throwIfAborted();if(entry.sourcePosition<=position()+.75)throw error;this.deps.log?.('multi_layering_fallback_ab',{baseId:entry.id,reason:'释放额外工作区，重新准备 A/B'});ready=await this.original.prepare(entry,a,b,position,s)}s.throwIfAborted();if(!extra)return ready
   if(canonicalJson(ready.approval)!==canonicalJson(extra.approval.base)){extra.release();extra=undefined;this.deps.log?.('multi_layering_fallback_ab',{baseId:entry.id,reason:'额外批准参照已变化，保留当前 A/B'});return ready}
   const original=ready,layer=extra;let released=false;const combined:LivePrepared={...original,release:()=>{if(released)return;released=true;layer.release();original.release();if(this.prepared===combined)this.prepared=null}};if(isRolePCM(layer))combined.roles=layer;else combined.multi=layer;this.prepared=combined;return combined
  }catch(error){extra?.release();ready?.release();throw error}
 }
 dispose(){this.lifetime.abort();this.prepared?.release();this.original.dispose();this.rows=[]}
}
function isRolePCM(v:ExtraPCM|RolePCM):v is RolePCM{return v.approval.schema==='harbeat.role-replacement.v1'}
