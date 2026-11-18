import type {Point} from '../device-execution'
import {valueAt} from '../device-execution'
import {canonicalJson} from '../jetson-contract'
import {sceneBytes,type Proof} from './contract'
import {validateLiveScene,outcomeOf,type LiveScene} from './live-contract'

export type RoleMode='roles-c'|'roles-cd'
/** Final output gain retains the base calibration floor (.5 * outputGain),
 * capped at 1. Acoustic and four-role audibility admission remain separate. */
export type RoleLayer={source:'c'|'d';role:'other'|'vocals';sourceBpm:number;outputStart:number;sourceStartFrame:number;lengthFrames:number;rate:number;loop:boolean;gain:number;points:Point[];vocalBoundary?:{entryClear:true;tailComplete:true;headMaxDb:number;tailMaxDb:number}}
type Pair={pass_:true;pitchedRisk:number;incompatiblePitchedSeconds:number}
export type RoleApproval={schema:'harbeat.role-replacement.v1';scope:'normal-playback-lab';producer:'jetson';approved:true;id:string;implementationSha256:string;mode:RoleMode;base:LiveScene;sources:{c:Proof;d?:Proof};window:[number,number];layers:RoleLayer[];bOther:Point[];bVocals?:Point[];evidence:{sourceVerified:true;pairwisePass:true;aggregatePass:true;measurementsSha256:string;arrangementSha256:string;peak:number;lowEnergyRatio:number;checks:{reconstruction:number;vocalClear:true;vocalMaxDb:number;beatErrorMs:number;loopSeamDb:number;melodyClash:number;onsetGrowth:number;originalVocalPreserved:true;vocalBoundariesClear:true;simultaneousFourRoleSeconds:number};pairwise:Record<string,Pair>;exitPeaks:{at:number;peak:number}[]}}

export const roleFrames=(l:RoleLayer)=>Math.round(l.lengthFrames/l.rate)
export const roleBytes=(v:RoleApproval)=>sceneBytes(v.base.scene,'long')+v.layers.reduce((n,l)=>n+8*roleFrames(l),0)
export const roleIdentity=(v:RoleApproval)=>({mode:v.mode,base:v.base,sources:v.sources,window:v.window,layers:v.layers,bOther:v.bOther,...(v.bVocals?{bVocals:v.bVocals}:{})})
/** Compute the arrangement hash first. Its digest belongs to the measured
 * record; only that record's own hash is excluded to avoid self-reference. */
export function roleMeasurements(v:RoleApproval){const {measurementsSha256,...measurements}=v.evidence;return measurements}

const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1/44100
const number=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi
const ownKeys=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))
const sameCurve=(a:Point[],b:Point[])=>[...new Set([...a,...b].map(p=>p[0]))].every(t=>Math.abs(valueAt(a,t)-valueAt(b,t))<1e-7)
function curve(v:any,duration:number):v is Point[]{
 if(!Array.isArray(v)||v.length<2||v.length>64)return false
 for(let i=0;i<v.length;i++){const p=v[i],q=v[i-1];if(!Array.isArray(p)||p.length!==2||!number(p[0],0,duration)||!number(p[1],0,1)||q&&(p[0]<=q[0]||Math.abs(p[1]-q[1])/(p[0]-q[0])>20.0001))return false}
 return v[0][0]===0&&near(v.at(-1)[0],duration)
}
function proof(v:any,ids:Set<string>){
 if(!v||typeof v.trackId!=='string'||!/^track-[a-f0-9]{20}$/.test(v.trackId)||ids.has(v.trackId)||typeof v.runId!=='string'||!v.runId.length||v.runId.length>200||!['masterSha256','reportSha256','vocalSha256','manifestSha256','profileSha256'].every(k=>hash(v[k]))||!v.stemSha256||!['drums','bass','other','vocals'].every(k=>hash(v.stemSha256[k]))||v.vocalSha256!==v.stemSha256.vocals)return false
 ids.add(v.trackId);return true
}
/** Structural admission is separate from the asynchronous immutable-byte checks. */
export function validateRole(v:any):RoleApproval{
 const fail=()=>{throw Error('角色替换未通过原声部、来源、整句或实测质量校验')}
 if(!ownKeys(v,['schema','scope','producer','approved','id','implementationSha256','mode','base','sources','window','layers','bOther','bVocals','evidence'])||v.schema!=='harbeat.role-replacement.v1'||v.scope!=='normal-playback-lab'||v.producer!=='jetson'||v.approved!==true||!hash(v.id)||!hash(v.implementationSha256)||!['roles-c','roles-cd'].includes(v.mode))fail()
 const base=validateLiveScene(v.base),s=base.scene,cd=v.mode==='roles-cd',duration=s.duration,beat=60/s.bpm,firstFade=s.exits[0].fadeStart
 if(outcomeOf(base)!=='takeover-b'||s.exits.length!==3)fail()
 const keys=Object.keys(v.sources??{}).sort();if(keys.join()!==(cd?'c,d':'c'))fail()
 const ids=new Set([s.sources.a.trackId,s.sources.b.trackId]);for(const k of keys)if(!proof(v.sources[k],ids))fail()
 if(!Array.isArray(v.window)||v.window.length!==2||!number(v.window[0],.08,firstFade)||!number(v.window[1],v.window[0]+2*beat,firstFade)||!Array.isArray(v.layers)||v.layers.length!==(cd?2:1))fail()
 const [left,right]=v.window as [number,number],cross:Point[]=[[0,0],[left,0],[left+beat,1],[right-beat,1],[right,0],[duration,0]]
 // The accepted window must have room for distinct attack/hold/release knots.
 if(right-left<=2*beat)fail()
 const seen=new Set<string>()
 for(const l of v.layers){
  if(!ownKeys(l,['source','role','sourceBpm','outputStart','sourceStartFrame','lengthFrames','rate','loop','gain','points','vocalBoundary'])||!keys.includes(l.source)||seen.has(l.source)||l.role!==(l.source==='c'?'other':'vocals')||l.loop!==false||!Number.isSafeInteger(l.sourceStartFrame)||l.sourceStartFrame<0||!Number.isSafeInteger(l.lengthFrames)||l.lengthFrames<1||!number(l.sourceBpm,40,240)||!number(l.rate,.95,1.05)||Math.abs(l.rate-s.bpm/l.sourceBpm)>1e-9||!number(l.gain,s.outputGain*.5,1)||!number(l.outputStart,0,firstFade)||!curve(l.points,duration)||roleFrames(l)>44100*16||l.outputStart+roleFrames(l)/44100>firstFade+1/44100)fail()
  seen.add(l.source)
  if(l.source==='c'){
   if(!near(l.outputStart,left)||l.vocalBoundary!==undefined||roleFrames(l)<Math.round((right-left)*44100)||!sameCurve(l.points,cross))fail()
  }else{
   const end=l.outputStart+roleFrames(l)/44100,delay=(l.outputStart-left)/beat,q=l.vocalBoundary
   if(roleFrames(l)/44100<=.23||Math.abs(delay-Math.round(delay))>1e-7||delay<0||delay>8||end>firstFade-.15+1/44100||!q||q.entryClear!==true||q.tailComplete!==true||!number(q.headMaxDb,-240,-45)||!number(q.tailMaxDb,-240,-45))fail()
   const voice:Point[]=[[0,0],[l.outputStart,0],[l.outputStart+.08,1],[end-.15,1],[end,0],[duration,0]],bed:Point[]=[[0,1],[l.outputStart-.08,1],[l.outputStart,0],[end,0],[end+.08,1],[duration,1]]
   if(!sameCurve(l.points,voice)||!curve(v.bVocals,duration)||!sameCurve(v.bVocals,bed))fail()
  }
 }
 const original=s.layers.find(l=>l.side==='b'&&l.role==='other')!.points,knots=[...new Set([...original,...cross].map(p=>p[0]))].sort((a,b)=>a-b),other:Point[]=knots.map(t=>[t,valueAt(original,t)*(1-valueAt(cross,t))])
 if(!curve(v.bOther,duration)||!sameCurve(v.bOther,other)||!cd&&v.bVocals!==undefined)fail()
 const e=v.evidence,c=e?.checks,limit=30/s.bpm+.02
 if(!e||e.sourceVerified!==true||e.pairwisePass!==true||e.aggregatePass!==true||!hash(e.arrangementSha256)||!hash(e.measurementsSha256)||!number(e.peak,0,.95)||!number(e.lowEnergyRatio,0,1.1)||!c||c.vocalClear!==true||c.originalVocalPreserved!==true||c.vocalBoundariesClear!==true)fail()
 for(const [key,lo,hi]of [['reconstruction',0,.25],['vocalMaxDb',-240,-45],['beatErrorMs',0,50],['loopSeamDb',-240,-20],['melodyClash',0,.35],['onsetGrowth',0,1.35],['simultaneousFourRoleSeconds',cd?1:0,duration]]as const)if(!number(c[key],lo,hi))fail()
 const pairs=['A/B','A/C','B/C',...(cd?['A/D','B/D','C/D']:[])];if(!e.pairwise||Object.keys(e.pairwise).sort().join()!==pairs.sort().join())fail()
 for(const key of pairs){const p=e.pairwise[key];if(!p||p.pass_!==true||!number(p.pitchedRisk,0,.35)||!number(p.incompatiblePitchedSeconds,0,limit))fail()}
 if(!Array.isArray(e.exitPeaks)||e.exitPeaks.length!==3)fail()
 for(let i=0;i<3;i++)if(!e.exitPeaks[i]||!near(e.exitPeaks[i].at,s.exits[i].at)||!number(e.exitPeaks[i].peak,0,.95)||e.peak+1e-8<e.exitPeaks[i].peak)fail()
 if(roleBytes(v)>96*1024*1024)fail()
 return v
}
export async function verifyRoleHashes(value:RoleApproval,digest=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('')):Promise<void>{
 const v=validateRole(value),hashValue=(x:unknown)=>digest(new TextEncoder().encode(canonicalJson(x)).buffer)
 if(await hashValue(v.base.scene)!==v.base.sceneSha256||await hashValue(roleIdentity(v))!==v.evidence.arrangementSha256||await hashValue(roleMeasurements(v))!==v.evidence.measurementsSha256)throw Error('角色替换编排、测量或原 A/B 指纹已变化')
}
