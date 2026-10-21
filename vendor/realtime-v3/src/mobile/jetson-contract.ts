import type {Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared} from '../metric-upstream/metric-mix/types'
import type {Controls} from './device-execution'
export type SourceBinding={trackId:string;runId:string;masterSha256:string;reportSha256:string;vocalSha256:string;manifestSha256:string;profileSha256:string;stemSha256:Record<'bass'|'other'|'vocals'|'drums',string>}
export type JetsonDecision={schema:'harbeat.jetson-mix-plan.v1';id:string;status:'ready';producer:'jetson';analysisVersion:'jetson-decision-v1';algorithmSha256:string;plan:Prepared['plan'];sourceProof:{a:SourceBinding;b:SourceBinding};controls:Controls;metrics:Prepared['metrics'];decision:Prepared['decision'];eq:Plan['v30Eq'];restore:number;requiredStems:string[];analysisSha256:string;drumPrelude?:unknown}
const hash=/^[a-f0-9]{64}$/,methods=['original','bass','filter','yield','vocal','bass_filter'],stems=['bass','other','vocals','drums']
const near=(a:unknown,b:unknown,tol=.002)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<tol
export function canonicalJson(value:any):string{
 const clean=(v:any):any=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('Non-finite approval field');if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(clean);return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,clean(v[k])]))}
 return JSON.stringify(clean(value))
}
/** Numeric replay tolerance across V8/JavaScriptCore libm; structure stays exact. */
export function replayDifference(a:any,b:any):number{
 if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)?Math.abs(a-b):Infinity
 if(a===b)return 0
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return Infinity
 const aa=Object.keys(a).filter(k=>a[k]!==undefined).sort(),bb=Object.keys(b).filter(k=>b[k]!==undefined).sort()
 if(JSON.stringify(aa)!==JSON.stringify(bb))return Infinity
 return Math.max(0,...aa.map(k=>replayDifference(a[k],b[k])))
}
export async function jsonFingerprint(value:unknown){const raw=new TextEncoder().encode(canonicalJson(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function sealJetsonDecision(value:JetsonDecision):Promise<JetsonDecision>{const {analysisSha256:_,...body}=value;return{...body,analysisSha256:await jsonFingerprint(body)} as JetsonDecision}
export async function verifyJetsonDecision(value:any,a:Track,b:Track,p:Plan):Promise<JetsonDecision>{
 let stage='identity'
 const fail=()=>{throw Error('Jetson 编排来源、接点或控制范围不一致: '+stage)}
 if(!value||value.schema!=='harbeat.jetson-mix-plan.v1'||value.status!=='ready'||value.producer!=='jetson'||value.analysisVersion!=='jetson-decision-v1'||!hash.test(value.id)||!hash.test(value.algorithmSha256)||!hash.test(value.analysisSha256))fail()
 stage='fingerprint';const {analysisSha256,...body}=value;if(await jsonFingerprint(body)!==analysisSha256)fail()
 stage='geometry';const g=value.plan
 if(!g||g.from!==a.id||g.to!==b.id||g.windowId!==p.window.id||!near(g.start,p.start)||!near(g.end,p.end)||!near(g.duration,p.duration)||!near(g.rate,p.rate,.000001)||!near(g.bStart,p.window.start)||!near(g.bEnd,p.window.end)||g.duration<1||g.duration>32||g.rate<.95||g.rate>1.05||!Number.isFinite(g.beatErrorMs)||g.beatErrorMs<0||g.beatErrorMs>65||!near(value.restore,p.restore))fail()
 stage='eq';if(replayDifference(value.eq,p.v30Eq)>1e-9)fail()
 stage='source';for(const [side,t] of [['a',a],['b',b]] as const){const s=value.sourceProof?.[side];if(!s||s.trackId!==t.id||s.runId!==t.provenance?.runId||!['masterSha256','reportSha256','vocalSha256'].every(k=>hash.test(s[k])&&s[k]===t.provenance?.[k])||!hash.test(s.manifestSha256)||!hash.test(s.profileSha256)||!stems.every(k=>hash.test(s.stemSha256?.[k]))||s.stemSha256.vocals!==s.vocalSha256)fail()}
 stage='controls';const c=value.controls,t=c?.bassTiming
 if(!c||!near(c.duration,g.duration)||!t||![c.lastBarStart,t.duckStart,t.swapStart,t.swapEnd].every(n=>Number.isFinite(n)&&n>=0&&n<=g.duration)||t.duckStart>t.swapStart||t.swapStart>t.swapEnd||t.swapEnd>c.lastBarStart+.002)fail()
 stage='vocal-control';const v=c.vocalExit;if(v&&(![v.fadeStart,v.fadeEnd,v.tailEnd??0].every(n=>Number.isFinite(n)&&n>=0&&n<=g.duration)||v.fadeEnd<=v.fadeStart||(v.tailEnd??0)>v.fadeStart))fail()
 stage='decision';const d=value.decision,m=value.metrics
 if(!m||!['bassOverlap','otherOverlap','bassDifference','otherDifference','vocalBenefit'].every(k=>m[k]===null||Number.isFinite(m[k])&&m[k]>=0&&m[k]<=1)||typeof m.vocalSafe!=='boolean'||!d||!methods.includes(d.recommended)||d.methods?.original?.eligible!==true||!methods.every(k=>typeof d.methods[k]?.eligible==='boolean'&&(!d.methods[k].eligible||Number.isFinite(d.methods[k].score)))||d.methods[d.recommended]?.eligible!==true)fail()
 if(d.methods.vocal.eligible&&(!v||m.vocalSafe!==true||m.vocalBenefit<.2))fail()
 stage='stems';if(!Array.isArray(value.requiredStems)||new Set(value.requiredStems).size!==value.requiredStems.length||!value.requiredStems.every((s:any)=>stems.includes(s)))fail()
 const required=new Set<string>();for(const [method,ss] of [['bass',['bass']],['filter',['other']],['yield',['other']],['vocal',['vocals']],['bass_filter',['bass','other']]] as [string,string[]][]){if(d.methods[method].eligible)ss.forEach(s=>required.add(s))}if([...required].some(s=>!value.requiredStems.includes(s)))fail()
 return value as JetsonDecision
}
