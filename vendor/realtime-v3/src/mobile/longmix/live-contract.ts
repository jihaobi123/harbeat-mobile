import type {Track} from '../../listen-upstream/realtime/planner'
import {validateScene,type Scene} from './contract'
import {validateReturnEvidence,type ReturnEvidence} from './live-return'
import type {Exit,Layer} from './contract'
export type LiveOutcome='takeover-b'|'return-a'

export type LiveScene={schema:'harbeat.live-layering.v1'|'harbeat.live-layering-return.v1';scope:'normal-playback-lab';producer:'jetson';approved:true;id:string;implementationSha256:string;sceneSha256:string;scene:Scene;nativeGain:.76;entry:{sourcePosition:number;fadeSeconds:.008;peak:number};evidence:{runtime:'live-layering-linear-8ms-v1'|'live-layering-return-linear-8ms-v1';sourceVerified:true;producerHost:string;entryPeak:number;exitPeaks:{at:number;bPosition:number;peak:number}[];limitations:string[];returnToA?:ReturnEvidence}}
export const outcomeOf=(v:LiveScene):LiveOutcome=>v.schema==='harbeat.live-layering-return.v1'?'return-a':'takeover-b'
export const approvedExits=(v:LiveScene)=>outcomeOf(v)==='return-a'?v.scene.exits.filter(e=>v.evidence.returnToA!.exits.some(r=>near(r.at,e.at))):v.scene.exits
export const continuationPosition=(v:LiveScene,e:Exit)=>outcomeOf(v)==='return-a'?v.evidence.returnToA!.exits.find(r=>near(r.at,e.at))!.aPosition:e.bPosition
export const returnLayers=(v:LiveScene,e:Exit):Layer[]|null=>outcomeOf(v)==='return-a'?v.evidence.returnToA!.exits.find(r=>near(r.at,e.at))!.layers:null
export type Entry={id:string;sha256:string;url:string;sceneSha256:string;from:string;to:string;sourcePosition:number}
const hash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),track=(x:unknown)=>typeof x==='string'&&/^track-[a-f0-9]{20}$/.test(x),near=(a:unknown,b:number)=>typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<1/44100,peak=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=.95
export function validateLiveScene(v:any):LiveScene{
 const fail=()=>{throw Error('实时长混批准缺少匹配的来源或入口／出口测量')}
 if(!v||!['harbeat.live-layering.v1','harbeat.live-layering-return.v1'].includes(v.schema)||v.scope!=='normal-playback-lab'||v.producer!=='jetson'||v.approved!==true||![v.id,v.implementationSha256,v.sceneSha256].every(hash))fail()
 const scene=validateScene(v.scene,'live'),e=v.evidence
 if(scene.rate!==1||v.nativeGain!==.76||!v.entry||!near(v.entry.sourcePosition,scene.clips.aStart)||v.entry.fadeSeconds!==.008||!peak(v.entry.peak))fail()
 if(!e||e.runtime!==(outcomeOf(v)==='return-a'?'live-layering-return-linear-8ms-v1':'live-layering-linear-8ms-v1')||e.sourceVerified!==true||typeof e.producerHost!=='string'||!e.producerHost.length||e.producerHost.length>200||!near(e.entryPeak,v.entry.peak)||!Array.isArray(e.exitPeaks)||e.exitPeaks.length!==scene.exits.length||!Array.isArray(e.limitations)||e.limitations.length>20||e.limitations.some((s:any)=>typeof s!=='string'||s.length>2000))fail()
 for(let i=0;i<scene.exits.length;i++){const x=e.exitPeaks[i],exit=scene.exits[i];if(!x||!near(x.at,exit.at)||!near(x.bPosition,exit.bPosition)||!peak(x.peak))fail()}
 if(outcomeOf(v)==='return-a')validateReturnEvidence(scene,e.returnToA);else if(e.returnToA!==undefined)fail()
 return v
}
export function verifyLiveTracks(value:LiveScene,a:Track,b:Track){
 const v=validateLiveScene(value)
 for(const [side,t] of [['a',a],['b',b]] as const){const proof=v.scene.sources[side];if(!t||t.id!==proof.trackId||!t.provenance||(['masterSha256','reportSha256','vocalSha256','runId'] as const).some(k=>t.provenance![k]!==proof[k]))throw Error('实时长混与当前音源版本不匹配')}
 if(!Number.isFinite(a.duration)||a.duration<=v.entry.sourcePosition+v.scene.duration+.1||!Number.isFinite(b.duration)||b.duration<v.scene.exits.at(-1)!.bPosition+16)throw Error('实时长混没有完整的当前曲目或后续原曲覆盖')
 if(outcomeOf(v)==='return-a'&&a.duration<continuationPosition(v,approvedExits(v).at(-1)!)+16)throw Error('返回 A 缺少后续原曲覆盖')
}
export function validateLiveIndex(v:any,outcome:LiveOutcome='takeover-b'):Entry[]{
 if(!v||v.schema!==(outcome==='return-a'?'harbeat.live-layering-return-index.v1':'harbeat.live-layering-index.v1')||!Array.isArray(v.scenes)||v.scenes.length>256)throw Error('实时长混目录无效')
 const seen=new Set<string>()
 for(const r of v.scenes){if(!r||![r.id,r.sha256,r.sceneSha256].every(hash)||!track(r.from)||!track(r.to)||r.from===r.to||r.url!==(outcome==='return-a'?'/listen/longmix-return/v1/':'/listen/longmix-live/v1/')+r.sha256+'.json'||!Number.isFinite(r.sourcePosition)||r.sourcePosition<0||seen.has(r.id))throw Error('实时长混目录缺少不可变来源身份');seen.add(r.id)}
 return v.scenes
}
