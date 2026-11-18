import type {Track} from '../../listen-upstream/realtime/planner'
import {loadDrumAuditionPCM,verifyDrumPreludeProof,validateDrumPreparedAssets,validateDrumTakeoverAsset,type DrumAuditionGroup,type DrumAuditionPCM} from '../drum-prelude-audition'
import {PRELUDE_INDEX_SHA} from './prelude-pin'
export function preludeMatches(g:DrumAuditionGroup,a:Track,b:Track){const p=g.result.execution.plan;return p.from===a.id&&p.to===b.id&&(['a','b'] as const).every((side,i)=>['masterSha256','reportSha256','vocalSha256','runId'].every(key=>(g.result.execution.sourceFingerprints[side] as any)?.[key]===(i?b:a).provenance?.[key as keyof NonNullable<Track['provenance']>]))}
/** Two historical Jetson-approved windows. No claim of general corpus coverage. */
export class PreludeCatalog{
 groups:DrumAuditionGroup[]=[];private loaded:{group:DrumAuditionGroup;pcm:DrumAuditionPCM}|null=null;private pending:Promise<void>|null=null
 constructor(private ctx:AudioContext,private base:URL){}
 async load(signal:AbortSignal){if(this.groups.length)return
  const response=await fetch(new URL('drum-first/index.json',this.base),{signal});if(!response.ok)throw Error('鼓先行固定案例尚未发布')
  const bytes=await response.arrayBuffer();if(bytes.byteLength>256*1024)throw Error('鼓先行目录超出预算')
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==PRELUDE_INDEX_SHA)throw Error('鼓先行目录版本不一致')
  const data=JSON.parse(new TextDecoder().decode(bytes));if(data.schema!=='harbeat.drum-prelude-audition.v1'||data.groups?.length!==2)throw Error('鼓先行目录无效')
  for(const g of data.groups){await verifyDrumPreludeProof(g.approval);validateDrumPreparedAssets(g.approval,g.pcm);validateDrumTakeoverAsset(g.approval,g.body);for(const a of [...Object.values(g.pcm.a),...Object.values(g.pcm.b),g.body] as any[])if(!/^[a-f0-9]{64}\.wav$/.test(a.url))throw Error('鼓先行素材地址无效')}
  signal.throwIfAborted();this.groups=data.groups
 }
 ready(g:DrumAuditionGroup){return this.loaded?.group.id===g.id?this.loaded.pcm:null}
 pcm(id:string){return this.loaded?.group.result.id===id?this.loaded.pcm:null}
 async warm(g:DrumAuditionGroup,signal:AbortSignal){if(this.ready(g))return;if(this.pending)await this.pending.catch(()=>{});signal.throwIfAborted();if(this.ready(g))return
  this.loaded=null;const promise=this.pending=loadDrumAuditionPCM(this.ctx,g,new URL('drum-first/',this.base),signal).then(pcm=>{signal.throwIfAborted();this.loaded={group:g,pcm}})
  try{await promise}finally{if(this.pending===promise)this.pending=null}
 }
 clear(){this.loaded=null}
}
