import type {Track,Plan} from '../../listen-upstream/realtime/planner'
import {buildV30Eq} from '../../listen-upstream/v30/eq'
import {planContinuous} from '../../listen-upstream/continuous/beatAlignment'
import {stemPlanKey} from '../stem-mix/preparation'
import {canonicalJson} from '../jetson-contract'
/** Revalidate the chosen window rather than the old planner's preferred window. */
export function fixedStemTargets(tracks:Track[],plan:Plan|null){return plan?tracks.filter(t=>t.id===plan.to).map(t=>({...t,windows:t.windows.filter(w=>w.id===plan.window.id)})):tracks}
/** Every exact candidate needs its own EQ identity before Jetson verification. */
export function completeGradualPlans(a:Track,tracks:Track[],rows:Plan[]){
 const ready:Plan[]=[]
 for(const p of rows){const b=tracks.find(t=>t.id===p.to);if(!b||ready.some(q=>q.id===p.id))continue
  try{ready.push({...p,v30Eq:buildV30Eq(a,b,p)})}catch{/* Incomplete source evidence cannot enter the executable pool. */}
 }
 return ready
}
function equivalentEq(a:Plan['v30Eq'],b:Plan['v30Eq']){
 if(!a||!b)return false
 // Source identities and policy constants remain exact. Android/desktop V8's
 // transcendental functions can differ below one ulp in derived EQ evidence.
 for(const k of ['version','template','sources','limits','limitations'])if(canonicalJson((a as any)[k])!==canonicalJson((b as any)[k]))return false
 const near=(x:any,y:any):boolean=>{
  if(typeof x==='number'&&typeof y==='number')return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=1e-10
  if(!x||!y||typeof x!=='object'||typeof y!=='object')return x===y
  if(Array.isArray(x)!==Array.isArray(y))return false
  const keys=Object.keys(x).sort();return canonicalJson(keys)===canonicalJson(Object.keys(y).sort())&&keys.every(k=>near(x[k],y[k]))
 }
 return near(a,b)
}
export function matchFixedStemPlan(a:Track,b:Track,p:Plan,candidates:Plan[]){
 const key=stemPlanKey(a,b,p),rows=completeGradualPlans(a,[b],candidates)
 const exact=rows.find(q=>stemPlanKey(a,b,q)===key);if(exact)return{...exact,v30Eq:p.v30Eq}
 const rounded=rows.find(q=>stemPlanKey(a,b,{...q,v30Eq:p.v30Eq})===key&&equivalentEq(p.v30Eq,q.v30Eq))
 // Execute the historical approved EQ, never its slightly different rebuild.
 return rounded?{...rounded,v30Eq:p.v30Eq}:null
}
export function resolveFixedStemPlan(a:Track,b:Track,p:Plan,position:number){
 const r=planContinuous(a,fixedStemTargets([b],p),position,{kind:'next',targetId:b.id},new Set(),Math.max(0,p.end-position+.5),false)
 const key=stemPlanKey(a,b,p),exact=matchFixedStemPlan(a,b,p,r.candidates),rows=exact?[]:completeGradualPlans(a,[b],r.candidates)
 if(!exact){const close=rows.find(q=>q.id===p.id||Math.abs(q.end-p.end)<.001),requested=JSON.parse(key),rebuilt=close?JSON.parse(stemPlanKey(a,b,close)):null
  const delta=(x:any,y:any):number=>typeof x==='number'&&typeof y==='number'?Math.abs(x-y):x&&y&&typeof x==='object'&&typeof y==='object'?Math.max(0,...Object.keys(x).map(k=>delta(x[k],y[k]))):x===y?0:Infinity
  throw Object.assign(Error('获胜分轨窗口与当前手机来源或接点已不一致'),{evidence:{position,requested:{id:p.id,start:p.start,end:p.end,rate:p.rate,duration:p.duration},closest:close?{id:close.id,start:close.start,end:close.end,rate:close.rate,duration:close.duration}:null,candidateCount:rows.length,changedKeys:rebuilt?Object.keys(requested).filter(k=>JSON.stringify(requested[k])!==JSON.stringify(rebuilt[k])):null,eqMaxNumericDelta:rebuilt?delta(requested.eq,rebuilt.eq):null}})
 }
 return exact
}

/** A saved approval remains useful only if the live Listen gates reconstruct
 * the same source/window/EQ. Missing coverage never authorizes a new window. */
export function reservationGradualPlans(session:{approvedCandidates:(a:Track,position:number,energy:number)=>{track:Track;plan:Plan}[]},a:Track,targets:Track[],position:number,budget:number,automatic:boolean,energy:number){
 const plans:Plan[]=[]
 for(const {plan} of session.approvedCandidates(a,position,energy)){
  const b=targets.find(t=>t.id===plan.to)
  if(!b||plan.end>position+budget+.001||automatic&&plan.start<a.duration*.5)continue
  try{plans.push(resolveFixedStemPlan(a,b,plan,position))}catch{/* Preserve live source, phrase and vocal gates. */}
 }
 return plans
}
