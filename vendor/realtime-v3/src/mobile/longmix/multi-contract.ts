import type {Track} from '../../listen-upstream/realtime/planner'
import type {Point} from '../device-execution'
import {sceneBytes,type Proof,type Role} from './contract'
import {validateLiveScene,type LiveScene} from './live-contract'
export type ExtraLayer={source:'c'|'d';role:Role;outputStart:number;sourceStartFrame:number;lengthFrames:number;rate:number;loop:boolean;filter:{kind:'none'}|{kind:'highpass';frequency:180;q:number;warmupCycles:3};points:Point[]}
export type MultiApproval={schema:'harbeat.multi-layering.v1';scope:'normal-playback-lab';producer:'jetson';approved:true;id:string;implementationSha256:string;mode:'additive';base:LiveScene;sources:Partial<Record<'c'|'d',Proof>>;layers:ExtraLayer[];evidence:{sourceVerified:true;pairwisePass:true;aggregatePass:true;peak:number;lowEnergyRatio:number;addedRmsDb:number;measurementsSha256:string;arrangementSha256:string;checks:{reconstruction:number;vocalClear:true;vocalMaxDb:number;beatErrorMs:number;loopSeamDb:number;melodyClash:number;onsetGrowth:number;maximumDrumSources:number};pairwise:Record<string,{beatErrorMs:number;pitchedClash:number}>;exitPeaks:{at:number;peak:number}[]}}
const hash=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),finite=(...v:any[])=>v.every(Number.isFinite),peak=(v:any)=>Number.isFinite(v)&&v>=0&&v<=.95
export const extraFrames=(l:ExtraLayer)=>Math.round(l.lengthFrames/l.rate)
export const multiBytes=(v:MultiApproval)=>sceneBytes(v.base.scene,'long')+v.layers.reduce((n,l)=>n+8*extraFrames(l),0)
export function validateMulti(v:any):MultiApproval{
 const fail=()=>{throw Error('多来源编排未通过来源、声部、预算或整体声音检查')}
 if(!v||v.schema!=='harbeat.multi-layering.v1'||v.scope!=='normal-playback-lab'||v.producer!=='jetson'||v.approved!==true||v.mode!=='additive'||!hash(v.id)||!hash(v.implementationSha256))fail()
 const base=validateLiveScene(v.base),ids=new Set([base.scene.sources.a.trackId,base.scene.sources.b.trackId]),keys=Object.keys(v.sources??{});if(!keys.includes('c')||keys.length>2||keys.some(k=>!['c','d'].includes(k))||!Array.isArray(v.layers)||!v.layers.length||v.layers.length>8)fail()
 for(const k of keys){const p=v.sources[k];if(!p||!/^track-[a-f0-9]{20}$/.test(p.trackId)||ids.has(p.trackId)||typeof p.runId!=='string'||!p.runId.length||p.runId.length>200||!['masterSha256','reportSha256','vocalSha256','manifestSha256','profileSha256'].every(h=>hash(p[h]))||!p.stemSha256||!['drums','bass','other','vocals'].every(r=>hash(p.stemSha256[r]))||p.stemSha256.vocals!==p.vocalSha256)fail();ids.add(p.trackId)}
 const seen=new Set<string>()
 for(const l of v.layers){const key=l.source+':'+l.role;if(!keys.includes(l.source)||!['drums','bass','other','vocals'].includes(l.role)||seen.has(key)||!Number.isFinite(l.outputStart)||l.outputStart<0||l.outputStart>=base.scene.duration||!Number.isSafeInteger(l.sourceStartFrame)||l.sourceStartFrame<0||!Number.isSafeInteger(l.lengthFrames)||l.lengthFrames<1||!finite(l.rate)||l.rate<.95||l.rate>1.05||typeof l.loop!=='boolean'||extraFrames(l)>44100*16||!Array.isArray(l.points)||l.points.length<2||l.points.length>32)fail();seen.add(key)
  if(l.filter?.kind!=='none'&&!(l.role==='drums'&&l.filter?.kind==='highpass'&&l.filter.frequency===180&&l.filter.warmupCycles===3&&Number.isFinite(l.filter.q)&&Math.abs(l.filter.q-Math.SQRT1_2)<1e-12))fail()
  for(let i=0;i<l.points.length;i++){const p=l.points[i],prev=l.points[i-1];if(!Array.isArray(p)||p.length!==2||!finite(...p)||p[0]<0||p[0]>base.scene.duration||p[1]<0||p[1]>.25||prev&&(p[0]<=prev[0]||Math.abs(p[1]-prev[1])/(p[0]-prev[0])>4))fail()}
  if(l.points[0][0]!==0||l.points[0][1]!==0||l.points.at(-1)[0]!==base.scene.duration||l.points.at(-1)[1]!==0)fail()
  for(let i=1;i<l.points.length;i++){const a=l.points[i-1],b=l.points[i];if((a[1]>0||b[1]>0)&&(a[0]<l.outputStart||!l.loop&&b[0]>l.outputStart+extraFrames(l)/44100))fail()}
 }
 if(keys.some(k=>!v.layers.some((l:ExtraLayer)=>l.source===k)))fail()
 const e=v.evidence;if(!e||e.sourceVerified!==true||e.pairwisePass!==true||e.aggregatePass!==true||!peak(e.peak)||!finite(e.lowEnergyRatio,e.addedRmsDb)||e.lowEnergyRatio<0||e.lowEnergyRatio>1.1||e.addedRmsDb> -12||e.addedRmsDb< -50||!hash(e.measurementsSha256)||!hash(e.arrangementSha256)||!Array.isArray(e.exitPeaks)||e.exitPeaks.length!==base.scene.exits.length)fail()
 const checks=e.checks;if(!checks||checks.vocalClear!==true)fail()
 for(const [key,low,high]of [['reconstruction',0,.25],['vocalMaxDb',-240,-45],['beatErrorMs',0,50],['loopSeamDb',-240,-20],['melodyClash',0,.35],['onsetGrowth',0,1.35],['maximumDrumSources',0,3]]as const){const value=checks[key];if(!Number.isFinite(value)||value<low||value>high)fail()}
 const pairs=['A/C','B/C',...(keys.includes('d')?['A/D','B/D','C/D']:[])];if(!e.pairwise||Object.keys(e.pairwise).sort().join()!==pairs.sort().join())fail()
 for(const name of pairs){const p=e.pairwise[name];if(!p||!finite(p.beatErrorMs,p.pitchedClash)||p.beatErrorMs<0||p.beatErrorMs>50||p.pitchedClash<0||p.pitchedClash>.35)fail()}
 for(let i=0;i<e.exitPeaks.length;i++)if(e.exitPeaks[i].at!==base.scene.exits[i].at||!peak(e.exitPeaks[i].peak))fail()
 if(multiBytes(v)>96*1024*1024)fail()
 return v
}
export function verifyMultiTrack(p:Proof,t:Track){if(!t||t.id!==p.trackId||!t.provenance||(['masterSha256','reportSha256','vocalSha256','runId'] as const).some(k=>t.provenance![k]!==p[k]))throw Error('新增声部与当前曲库版本不符')}

export const multiIdentity=(v:MultiApproval)=>({base:v.base,sources:v.sources,layers:v.layers})
