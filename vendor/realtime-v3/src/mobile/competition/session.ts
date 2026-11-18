import type {ContinuationAssessment} from '../set-continuity'
import type {Track,Plan} from '../../listen-upstream/realtime/planner'
import type {DevicePrepared} from '../device-execution'
import type {CrossGenreClient} from '../crossgenre/client'
import {enumerateCrossGenre,nativeTakeover,type CrossPlan} from '../crossgenre/planner'
import type {CrossGenreSession} from '../crossgenre/lifecycle'
import type {MaterialCatalog} from './materials'
import {nativeCandidate,stemCandidates,preludeCandidate,candidateStart,type Candidate} from './candidates'
import {preludeMatches,type PreludeCatalog} from './prelude'
import {experimentalPlans} from './experiments'
import {chooseTransition,COMPETITION_POLICY,methodNames,experimentalMethod} from './score'
export type CompetitionPort={continuation?:(track:Track,position:number)=>ContinuationAssessment;active:()=>{track:Track}|null;position:()=>number;now:()=>number;tracks:()=>Track[];energy:()=>number;client:()=>CrossGenreClient|null;native:()=>CrossGenreSession|null;materials:MaterialCatalog;prelude?:PreludeCatalog;reservation?:()=>boolean;gradual:(a:Track,targets:Track[],position:number,budget:number,automatic:boolean)=>Plan[];gradualDiagnostics?:()=>{code:string;reason:string;count:number}[];warmPriority?:(p:Plan)=>number;learnedCue?:(id:string,start:number)=>boolean;warm:(p:Plan)=>Promise<void>;retainStem?:(p:Plan|null,committed?:boolean)=>void;stemStatus?:(p:Plan)=>{canPrepare:boolean;code:string;reason:string};stem:(p:Plan)=>DevicePrepared|null;loadGradual:(p:Plan,signal:AbortSignal)=>Promise<void>;executeStem:(c:Candidate,budget:number,automatic:boolean)=>Promise<void>;executeFallback:(id:string,budget:number,automatic?:boolean,plan?:Plan)=>Promise<void>;log:(kind:string,data:any)=>void;changed:()=>void}
type Prepared={source:NonNullable<ReturnType<CompetitionPort['active']>>;automatic:boolean;choice:Candidate|null;fallback:Plan|null;id:string;deadline:number}
function cancellable<T>(work:Promise<T>,signal:AbortSignal){return new Promise<T>((resolve,reject)=>{const cancel=()=>reject(signal.reason??new DOMException('已取消','AbortError'));signal.addEventListener('abort',cancel,{once:true});work.then(v=>{signal.removeEventListener('abort',cancel);resolve(v)},e=>{signal.removeEventListener('abort',cancel);reject(e)});if(signal.aborted)cancel()})}
export class CompetitionSession{
 experimental=true;rows:Candidate[]=[];reason='';phase='idle';activeChoice:Candidate|null=null
 private continuationFailures=new Map<string,ContinuationAssessment>();private revision=0;private controller:AbortController|null=null;private prepared:Prepared|null=null
 constructor(private port:CompetitionPort){}
 get choice(){return this.activeChoice??(this.prepared?.source===this.port.active()?this.prepared.choice:null)}
 get upcoming(){return this.prepared?.source===this.port.active()?this.prepared.choice:null}
 get upcomingFallback(){return this.prepared?.source===this.port.active()&&!this.prepared.choice?this.prepared.fallback:null}
 get automaticStart(){const p=this.prepared;return p?.automatic&&p.source===this.port.active()?(p.choice?candidateStart(p.choice):p.fallback?.start??null):null}
 cancel(){this.revision++;this.controller?.abort();this.port.native()?.cancelPreparation();this.controller=null;this.prepared=null;this.rows=[];this.reason='';this.phase='idle'}
 clearActive(){this.activeChoice=null}
 setExperimental(value:boolean){if(this.experimental===value)return;this.experimental=value;this.cancel();this.port.changed()}
 private continuation(track:Track|undefined,position:number,automatic:boolean){if(!automatic||!this.port.continuation)return true;if(!track)return false;const result=this.port.continuation(track,position);if(!result.allowed)this.continuationFailures.set(track.id+':'+position,result);return result.allowed}
 private begin(){this.continuationFailures.clear();this.controller?.abort();this.port.native()?.cancelPreparation(true);const source=this.port.active();if(!source)throw Error('请先播放歌曲');const token=++this.revision,controller=this.controller=new AbortController();return{source,signal:controller.signal,check:()=>{controller.signal.throwIfAborted();if(token!==this.revision||source!==this.port.active())throw new DOMException('混音竞争已取消','AbortError')}}}
 private stems(a:Track,b:Track,p:Plan,position:number,budget:number){
  const result=this.port.stem(p),status=this.port.stemStatus?.(p),rows=stemCandidates(a,b,p,result,position,budget,this.port.energy()).map(r=>!result&&status?{...r,reason:status.reason,availability:status.code}:{...r,availability:result?(r.eligible?'ready':'analysis-not-applicable'):'pending'})
  if(!this.port.reservation?.())return rows
  // The saved pool was already revalidated against the live Listen gates.
  // Eligibility and musical method selection remain with the Jetson approval.
  return rows.map(r=>{if(r.method==='stem-handover')return r;const approved=result?.decision.methods[r.method as keyof typeof result.decision.methods],eligible=r.eligible&&r.method===result?.decision.recommended
   return{...r,eligible,score:approved?.score??0,components:{jetsonApprovedScore:approved?.score??0},reason:eligible?'预约 Jetson 批准手法；本机来源、接点及 PCM 校验通过':result?'当前声部手法不是预约批准的执行手法':r.reason}
  })
 }
 private choose(manual:boolean){
  const arranged=this.rows.filter(r=>r.method==='stem-handover'&&r.eligible).sort((a,b)=>b.score-a.score||candidateStart(a)-candidateStart(b));if(arranged.length)return{winner:arranged[0],fallback:false,reason:'采用 Jetson 按处理后声部批准的独立时间线'}
  if(!this.port.reservation?.())return chooseTransition(this.rows,manual,r=>this.port.learnedCue?.(r.plan.to,candidateStart(r))===true)
  const ranked=this.rows.filter(r=>r.kind==='stem'&&r.eligible&&Number.isFinite(r.score)).sort((a,b)=>b.score-a.score||candidateStart(a)-candidateStart(b)||a.id.localeCompare(b.id))
  return{winner:ranked[0]??null,fallback:!ranked.length&&manual,reason:ranked.length?'预约批准的来源与执行条件通过，采用 Jetson 决策':'预约批准的方案暂不可执行，保留当前播放'}
 }
 private async evaluate(ids:string[],automatic:boolean,budget:number,signal:AbortSignal,frozen:Prepared|null,tried=new Set<string>(),prepareBy=Infinity,protectedCue?:string){
  const a=this.port.active()!.track,position=this.port.position(),began=this.port.now(),targets=this.port.tracks().filter(t=>ids.includes(t.id)&&t.id!==a.id),rows:Candidate[]=[],fallbacks:Plan[]=[]
  const gradual=this.port.gradual(a,targets,position,budget,automatic).filter(p=>this.continuation(targets.find(t=>t.id===p.to),p.window.end,automatic))
  for(const p of gradual){const b=targets.find(t=>t.id===p.to);if(!b)continue;fallbacks.push(p);rows.push(...this.stems(a,b,p,position,budget))}
  // Keep at most two window PCMs resident. Automatic preparation may advance
  // through more pairs sequentially; unpublished sources do not consume a slot.
  const untried=gradual.filter(p=>p.start>=this.port.position()+.5&&!tried.has(p.id)&&this.port.stemStatus?.(p).canPrepare!==false).map(p=>({p,priority:this.port.warmPriority?.(p)??0,score:Math.max(...rows.filter(r=>r.plan===p).map(r=>r.score))})).sort((a,b)=>b.priority-a.priority||b.score-a.score||(this.port.reservation?.()?a.p.start-b.p.start:0)||a.p.id.localeCompare(b.p.id))
  const seenTargets=new Set(gradual.filter(p=>tried.has(p.id)).map(p=>p.to));untried.sort((a,b)=>Number(seenTargets.has(a.p.to))-Number(seenTargets.has(b.p.to)))
  // Review the protected gradual window first. Its approved stem version
  // still competes with other candidates and keeps the same deadline.
  const first=untried.find(r=>r.p.id===protectedCue)??untried[0]
  const second=first?(untried.find(r=>r.p.to!==first.p.to)??untried.find(r=>r!==first)):null
  const frozenStem=frozen?.source===this.port.active()&&frozen.automatic===automatic&&frozen.choice?.kind==='stem'&&candidateStart(frozen.choice)>=position+.5&&this.port.stem(frozen.choice.plan as Plan)
  const warmPlans=frozenStem||frozen?.automatic===automatic&&frozen?.fallback&&!frozen.choice?[]:[first,second].filter((r):r is NonNullable<typeof r>=>!!r).map(r=>r.p);for(const p of warmPlans)tried.add(p.id)
  const warming=warmPlans.map(p=>this.port.warm(p).catch(()=>{}))
  if(this.experimental&&!this.port.reservation?.())await this.port.materials.load(signal).catch(()=>{})
  if(this.experimental&&!this.port.reservation?.()&&this.port.prelude){await this.port.prelude.load(signal).catch(()=>{});signal.throwIfAborted()
   for(const b of targets)for(const g of this.port.prelude.groups)if(preludeMatches(g,a,b)&&g.approval.sourceWindow.aStart>=position+.75&&g.result.execution.plan.end<=position+budget&&(!automatic||g.approval.sourceWindow.aStart>=a.duration*.5)){
    rows.push(preludeCandidate(a,b,g,!!this.port.prelude.ready(g),position,budget,this.port.energy()));warming.push(this.port.prelude.warm(g,signal).catch(()=>{}))
   }
  }
  const client=this.port.client()
  if(!this.port.reservation?.()&&client&&client.canExit(a.id)){
   const ap=await client.load(a,signal).catch(()=>null);signal.throwIfAborted()
   if(ap)for(const b of targets){
    try{const bp=await client.load(b,signal),base=enumerateCrossGenre(a,b,ap,bp,position,budget,this.port.energy(),{automatic}),all=[...base,...experimentalPlans(base,a,b,this.port.materials.materials,this.experimental,this.port.materials.sha256)]
     for(const p of all)if(nativeTakeover(p)<=position+budget+.001)rows.push(nativeCandidate(a,b,p,position,budget,this.port.energy()))
    }catch(error){signal.throwIfAborted();this.port.log('competition_profile_unavailable',{from:a.id,to:b.id,reason:(error as Error).message})}
   }
  }
  // Restore the frozen winner before calculating the preparation deadline.
  const old=frozen?.source===this.port.active()&&frozen.automatic===automatic?frozen.choice:null
  if(old&&ids.includes(old.plan.to)&&candidateStart(old)>=position+.5&&old.plan.end<=position+budget+.001&&(!old.experimental||this.experimental)){
   const b=targets.find(t=>t.id===old.plan.to)
   if(b){const previous=rows.findIndex(r=>r.id===old.id);if(previous>=0)rows.splice(previous,1)
    if(old.kind==='native')rows.push(nativeCandidate(a,b,old.plan as CrossPlan,position,budget,this.port.energy()));else if(old.prelude)rows.push(preludeCandidate(a,b,old.prelude,!!this.port.prelude?.ready(old.prelude),position,budget,this.port.energy()));else rows.push(...this.stems(a,b,old.plan as Plan,position,budget))}
  }
  if(warming.length){
   const earliest=Math.min(...rows.filter(r=>r.eligible||r.prelude).map(candidateStart),...warmPlans.map(p=>p.start))
   const seconds=Math.max(0,Math.min(automatic?120:12,budget-(this.port.now()-began)-2,earliest-this.port.position()-2,prepareBy-this.port.position()))
   let timer:ReturnType<typeof setTimeout>|undefined
   try{await cancellable(Promise.race([Promise.allSettled(warming),new Promise<void>(resolve=>timer=setTimeout(resolve,seconds*1000))]),signal)}finally{clearTimeout(timer)}
   signal.throwIfAborted()
   for(let i=rows.length-1;i>=0;i--)if(rows[i].prelude){const row=rows[i],b=targets.find(t=>t.id===row.plan.to)!;rows[i]=preludeCandidate(a,b,row.prelude!,!!this.port.prelude?.ready(row.prelude!),this.port.position(),budget,this.port.energy())}else if(rows[i].kind==='stem'&&rows[i].plan!==old?.plan)rows.splice(i,1)
   for(const p of gradual){const b=targets.find(t=>t.id===p.to);if(!b)continue;const refreshed=this.stems(a,b,p,this.port.position(),budget);for(const r of refreshed)if(!r.eligible&&!this.port.stem(p)&&this.port.stemStatus?.(p).canPrepare!==false){r.reason=warmPlans.includes(p)?'本次有界准备期内批准或 PCM 尚未就绪':'尚未准备此接点，不代表音乐不适合';r.availability=warmPlans.includes(p)?'preparation-pending':'not-evaluated'};rows.push(...refreshed)}
  }
  for(const r of rows){const position=r.kind==='native'?(r.plan as CrossPlan).entry:(r.plan as Plan).window.end;if(!this.continuation(targets.find(t=>t.id===r.plan.to),position,automatic)){r.eligible=false;r.availability='continuation-window-unavailable';r.reason=this.continuationFailures.get(r.plan.to+':'+position)?.reason??'下一跳准备空间不足'}}
  if(this.continuationFailures.size)this.port.log('competition_continuation_rejected',{count:this.continuationFailures.size,reasons:[...new Set([...this.continuationFailures.values()].map(r=>r.reason))]})
  for(const r of rows)if(candidateStart(r)<this.port.position()+.5){r.eligible=false;r.reason='该接点在本次准备期间已过';r.availability='cue-expired'}
  this.rows=rows;this.port.log('competition_evaluated',{automatic,from:a.id,position:this.port.position(),targetCount:targets.length,windowCount:gradual.length,warmedWindowIds:warmPlans.map(p=>p.id),deferredWindowCount:Math.max(0,untried.length-warmPlans.length),plannerExclusions:this.port.gradualDiagnostics?.()??[],states:rows.reduce((n,r)=>{const k=r.eligible?(this.port.reservation?.()||r.score>=65?'eligible':'below-local-threshold'):r.availability??'unavailable';n[k]=(n[k]??0)+1;return n},{} as Record<string,number>)});return{rows,fallback:fallbacks[0]??null,hasDeferred:untried.length>warmPlans.length}
 }
 private async prepareWinner(c:Candidate,automatic:boolean,signal:AbortSignal){
  this.port.retainStem?.(c.kind==='stem'&&!c.prelude?c.plan as Plan:null)
  if(c.kind==='native'){const session=this.port.native();if(!session)throw Error('原速交接执行器尚未就绪');await session.preparePlan(c.plan as CrossPlan,automatic)}
  else{await this.port.loadGradual(c.plan as Plan,signal);if(!c.prelude&&!this.port.stem(c.plan as Plan))throw Error('获胜窗口的分轨 PCM 已失效')}
  signal.throwIfAborted()
 }
 private fallback(ids:string[],automatic:boolean,deadline:number){
  const source=this.port.active();if(!source)return null
  const position=this.port.position(),targets=this.port.tracks().filter(t=>ids.includes(t.id)&&t.id!==source.track.id)
  const plans=this.port.gradual(source.track,targets,position,Math.max(0,deadline-position),automatic).filter(p=>p.start>=position+.5&&p.end<=deadline+.001&&(!automatic||p.end>=source.track.duration*.5)&&this.continuation(targets.find(t=>t.id===p.to),p.window.end,automatic))
  const best=plans[0],reference=automatic&&best&&!this.port.reservation?.()?plans.find(p=>best.score-p.score<=.015&&this.port.learnedCue?.(p.to,p.start)):null
  return reference??best??null
 }
 async prepare(ids:string[],automatic:boolean,budget=30):Promise<string>{
  const {source,signal,check}=this.begin();this.phase='preparing';this.reason='正在评估接点与混音手法，当前音乐继续播放';this.port.changed()
  const limit=automatic?source.track.duration-this.port.position()-.5:budget,deadline=this.port.position()+limit,tried=new Set<string>()
  let baseline:Plan|null=null,preparationError:string|undefined
  // Prepare a valid escape before cold analysis, reserving the same eight-second
  // trigger used by automatic playback. Musical admission remains unchanged.
  if(automatic){
   const p=this.fallback(ids,true,deadline)
   if(p)try{await this.port.loadGradual(p,signal);check();if(p.start>=this.port.position()+8){baseline=p;this.port.log('competition_baseline_protected',{from:p.from,to:p.to,start:p.start,end:p.end,prepareBy:p.start-8})}}catch(error){check();preparationError=(error as Error).message;this.port.log('competition_baseline_unavailable',{id:p.id,automatic,reason:preparationError})}
  }
  for(let batch=0;batch<(automatic?4:1);batch++){
   const data=await this.evaluate(ids,automatic,Math.max(0,deadline-this.port.position()),signal,null,tried,baseline?baseline.start-8:Infinity,this.port.reservation?.()?undefined:baseline?.id);check()
   for(let attempts=0;attempts<=data.rows.length;attempts++){
    const result=this.choose(!automatic),winner=result.winner
    if(!winner)break
    try{await this.prepareWinner(winner,automatic,signal);check();if(candidateStart(winner)<this.port.position()+.5)throw Error('获胜接点在准备期间已过')
     this.port.retainStem?.(winner.kind==='stem'&&!winner.prelude?winner.plan as Plan:null,true);this.prepared={source,automatic,choice:winner,fallback:data.fallback,id:winner.plan.to,deadline};this.phase='ready';this.reason=result.reason;this.port.log('competition_prepared',{policy:COMPETITION_POLICY,winner,automatic,candidateCount:this.rows.length,sourceDeadline:deadline});this.port.changed();return winner.plan.to
    }catch(error){check();winner.eligible=false;winner.reason='素材准备失败：'+(error as Error).message;this.port.log('competition_candidate_unavailable',{id:winner.id,reason:winner.reason})}
   }
   if(!data.hasDeferred||deadline-this.port.position()<=2||baseline&&this.port.position()>=baseline.start-8)break
  }
  // Baseline still passes the original automatic beat/vocal/EQ planner. It is
  // prepared at a future cue, never a hard cut after the source has ended.
  for(let retry=0;retry<3;retry++){
   const fallback=baseline&&baseline.start>=this.port.position()+.5?baseline:this.fallback(ids,automatic,deadline);if(!fallback)break
   try{await this.port.loadGradual(fallback,signal);check()}catch(error){check();preparationError=(error as Error).message;this.port.log('competition_baseline_unavailable',{id:fallback.id,automatic,reason:preparationError});baseline=null;break}
   if(fallback.start<this.port.position()+.5||fallback.end>deadline+.001)continue
   this.port.retainStem?.(null,true);this.prepared={source,automatic,choice:null,fallback,id:fallback.to,deadline};this.phase='fallback-ready';this.reason='高级方案暂不可执行；已准备通过原拍点、人声与 EQ 检查的渐进交接';this.port.log('competition_baseline_prepared',{automatic,from:fallback.from,to:fallback.to,start:fallback.start,end:fallback.end});this.port.changed();return fallback.to
  }
  this.phase='unavailable';this.reason=this.unavailableReason(preparationError);this.port.log('competition_no_plan',{automatic,from:source.track.id,reason:this.reason,plannerExclusions:this.port.gradualDiagnostics?.()??[],candidateCount:this.rows.length});this.port.changed();throw Error(this.reason)
 }
 async request(id:string,budget:number,automatic:boolean){
  const frozen=this.prepared,position=this.port.position(),requestedBudget=budget,c=frozen?.choice
  if(!automatic&&frozen&&!frozen.automatic&&frozen.source===this.port.active()&&c?.plan.to===id&&c.eligible&&(this.port.reservation?.()||c.score>=65)&&(!c.experimental||this.experimental)&&candidateStart(c)>=position+.5&&c.plan.end<=frozen.deadline+.001){budget=Math.max(budget,Math.min(frozen.deadline-position,c.plan.end-position+.5))}
  this.prepared=null;this.activeChoice=null
  const {source,signal,check}=this.begin(),began=this.port.now();this.phase='selecting';this.reason='正在核验接点与素材，当前音乐继续播放';this.port.log('competition_request_budget',{targetId:id,automatic,requestedBudget,effectiveBudget:budget,preparedSourceDeadline:frozen?.deadline??null});this.port.changed()
  try{
   await this.evaluate([id],automatic,budget,signal,frozen);check()
   for(let attempts=0;attempts<=this.rows.length;attempts++){
    const decision=this.choose(!automatic),winner=decision.winner
    if(!winner){const remaining=Math.max(0,budget-(this.port.now()-began)),saved=frozen?.source===this.port.active()&&frozen.automatic===automatic&&!frozen.choice&&frozen.fallback?.to===id?frozen.fallback:null,fallback=automatic?(saved&&this.continuation(this.port.tracks().find(t=>t.id===saved.to),saved.window.end,automatic)&&saved.start>=this.port.position()+.5&&saved.end<=this.port.position()+remaining+.001?saved:this.fallback([id],true,this.port.position()+remaining)):null
     if(!automatic||fallback){if(fallback){await this.port.loadGradual(fallback,signal);check();if(fallback.start<this.port.position()+.5)throw Error('原渐混接点在准备期间已过')}
      this.reason='正在安排通过拍点、人声与 EQ 检查的渐进交接';this.port.log('competition_gradual_fallback',{policy:COMPETITION_POLICY,targetId:id,reason:decision.reason,explicitManual:!automatic,automatic,start:fallback?.start,end:fallback?.end});await this.port.executeFallback(id,Math.max(0,budget-(this.port.now()-began)),automatic,fallback??undefined);check();this.port.retainStem?.(null,true);this.phase='fallback';this.reason='已安排通过拍点、人声与 EQ 检查的渐进交接';return}this.reason=this.unavailableReason();throw Error(this.reason)}
    try{await this.prepareWinner(winner,automatic,signal);check();const remaining=budget-(this.port.now()-began)
     if(candidateStart(winner)<this.port.position()+.5||winner.plan.end>this.port.position()+remaining+.001)throw Error('获胜接点已过或超过原等待上限')
     this.activeChoice=winner;this.port.log('competition_selected',{policy:COMPETITION_POLICY,winner,automatic,rows:this.summary(id),basis:this.port.reservation?.()?'source-validated saved Jetson recommendation':'common bounded rule contributions, not a listening score'})
     if(winner.kind==='native')await this.port.native()!.requestPlan(winner.plan as CrossPlan,remaining,automatic);else await this.port.executeStem(winner,remaining,automatic)
     check();this.port.retainStem?.(winner.kind==='stem'&&!winner.prelude?winner.plan as Plan:null,true);this.phase='armed';this.reason=decision.reason;this.port.changed();return
    }catch(error){check();this.activeChoice=null;winner.eligible=false;winner.reason=(error as Error).message;this.port.log('competition_execution_unavailable',{id:winner.id,reason:winner.reason})}
   }
   throw Error('获胜方案执行条件已变化，当前歌曲继续播放')
  }catch(error){if(!signal.aborted&&source===this.port.active()){this.phase='unavailable';this.reason=(error as Error).message}throw error}finally{if(source===this.port.active())this.port.changed()}
 }
 private unavailableReason(preparationError?:string){
  if(this.continuationFailures.size&&!this.rows.some(r=>r.eligible))return [...new Set([...this.continuationFailures.values()].map(r=>r.reason))].slice(0,2).join('；')+'；其余候选仍须通过原拍点、人声及素材检查，当前歌曲继续播放'
  if(preparationError)return '接歌素材准备失败：'+preparationError+'；当前歌曲继续播放'
  if(!this.rows.length){const reasons=[...new Set((this.port.gradualDiagnostics?.()??[]).filter(r=>!['current_track','target_mismatch'].includes(r.code)).map(r=>r.reason))].slice(0,3);return '附近没有通过来源、拍点与窗口检查的接点'+(reasons.length?'：'+reasons.join('；'):'，请换歌或提前准备')+'；当前歌曲继续播放'}
  const usable=this.rows.filter(r=>r.eligible)
  if(usable.length)return '已核验的候选方案共同评分未达 65 分；当前歌曲继续播放'
  const reasons=[...new Set(this.rows.map(r=>r.reason))].slice(0,3)
  return '本次接点的方案暂不可执行：'+reasons.join('；')+'；当前歌曲继续播放'
 }
 private summary(targetId?:string|null):Record<string,any>{const best=new Map<string,Candidate>();for(const r of this.rows){if(targetId&&r.plan.to!==targetId)continue;const old=best.get(r.method);if(!old||Number(r.eligible)>Number(old.eligible)||r.eligible===old.eligible&&r.score>old.score)best.set(r.method,r)}const methods:Record<string,any>={};for(const [k,name] of Object.entries(methodNames))if(k!=='original'){const experimental=experimentalMethod(k);methods[k]={name,eligible:false,score:null,experimental,reason:experimental&&!this.experimental?'实验手法已关闭':k==='drum-first'?'仅两组固定来源与接点；当前曲对不匹配或接点已过':k==='half-double'?'当前接点没有合格的实测重音对应':['vinyl-brake','backspin-echo','loop-roll','reverb-out'].includes(k)?'段落、人声或本机有限效果的条件未满足':experimental?'速度或素材不满足已核验的有限鼓桥范围':'没有满足来源、窗口和执行约束的接点'}}for(const [k,r] of best)methods[k]={name:r.name,score:r.eligible?r.score:null,eligible:r.eligible,reason:r.reason,components:r.components,features:r.features,status:r.eligible?(this.port.reservation?.()||r.score>=65?'eligible':'below-local-threshold'):r.availability??'unavailable',experimental:r.experimental,id:r.id};return methods}
 snapshot(targetId?:string|null):{state:string;reason:string;recommended:string;methods:Record<string,any>;experimental:boolean;policy:string;candidateCount:number;winnerId:string|null;fallback:boolean}{const c=this.choice;return{state:this.phase,reason:this.reason,recommended:c?.method??'original',methods:{...this.summary(targetId),original:{name:methodNames.original,score:null,eligible:false,reason:'高级方案暂不可用时，仍须通过原拍点、人声、EQ 与素材准备检查；自动交接保持后段接点要求'}},experimental:this.experimental,policy:COMPETITION_POLICY,candidateCount:this.rows.length,winnerId:c?.id??null,fallback:this.phase==='fallback'||this.phase==='fallback-ready'}}
}
