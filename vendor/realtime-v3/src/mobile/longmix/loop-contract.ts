import type {Proof} from './contract'
import type {Track} from '../../listen-upstream/realtime/planner'
export type LoopApproval={schema:'harbeat.loop-extension.v1';scope:'normal-playback-lab';producer:'jetson';approved:true;id:string;implementationSha256:string;title:string;sampleRate:44100;bpm:number;nativeGain:.76;fadeSeconds:.008;startFrame:number;lengthFrames:number;maxCycles:16;source:Proof;evidence:{sourceVerified:true;producerHost:string;reconstruction:number;reconstructionLevelDeltaDb:number;loopSeamDb:number;vocalMaxDb:number;vocalClear:true;beatErrorMs:number;peak:number;entryPeak:number;exitPeaks:{phaseFrame:number;peak:number}[]}}
export type LoopEntry={id:string;sha256:string;url:string;trackId:string;startFrame:number}
export type LoopExit={atFrame:number;sourceFrame:number}
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0,peak=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=.95
export function validateLoop(v:any):LoopApproval{
 const fail=()=>{throw Error('器乐循环缺少有效的来源、接缝或释放测量')},e=v?.evidence,p=v?.source
 if(!v||v.schema!=='harbeat.loop-extension.v1'||v.scope!=='normal-playback-lab'||v.producer!=='jetson'||v.approved!==true||!hash(v.id)||!hash(v.implementationSha256)||v.sampleRate!==44100||v.nativeGain!==.76||v.fadeSeconds!==.008||!Number.isFinite(v.bpm)||v.bpm<60||v.bpm>120||!integer(v.startFrame)||!integer(v.lengthFrames)||v.lengthFrames%2||v.maxCycles!==16||Math.abs(v.lengthFrames-960/v.bpm*44100)>1.001||typeof v.title!=='string'||!v.title.length||v.title.length>300)fail()
 if(!p||!/^track-[a-f0-9]{20}$/.test(p.trackId)||typeof p.runId!=='string'||!p.runId.length||p.runId.length>200||!['masterSha256','reportSha256','vocalSha256','manifestSha256','profileSha256'].every(k=>hash(p[k]))||!p.stemSha256||!['drums','bass','other','vocals'].every(k=>hash(p.stemSha256[k]))||p.stemSha256.vocals!==p.vocalSha256)fail()
 if(!e||e.sourceVerified!==true||e.vocalClear!==true||typeof e.producerHost!=='string'||!e.producerHost.length||e.producerHost.length>200||!Number.isFinite(e.reconstruction)||e.reconstruction<0||e.reconstruction>.25||!Number.isFinite(e.reconstructionLevelDeltaDb)||Math.abs(e.reconstructionLevelDeltaDb)>1.5||!Number.isFinite(e.loopSeamDb)||e.loopSeamDb> -20||!Number.isFinite(e.vocalMaxDb)||e.vocalMaxDb> -45||!Number.isFinite(e.beatErrorMs)||e.beatErrorMs<0||e.beatErrorMs>50||!peak(e.peak)||!peak(e.entryPeak)||!Array.isArray(e.exitPeaks)||e.exitPeaks.length!==2)fail()
 for(let i=0;i<2;i++)if(e.exitPeaks[i]?.phaseFrame!==v.lengthFrames*(i+1)/2||!peak(e.exitPeaks[i]?.peak))fail()
 return v
}
export function validateLoopIndex(v:any):LoopEntry[]{
 if(v?.schema!=='harbeat.loop-extension-index.v1'||!Array.isArray(v.loops)||v.loops.length>256)throw Error('器乐循环目录无效')
 const ids=new Set<string>();for(const r of v.loops){if(!r||!hash(r.id)||!hash(r.sha256)||!/^track-[a-f0-9]{20}$/.test(r.trackId)||!integer(r.startFrame)||r.url!=='/listen/loop-extension/v1/'+r.sha256+'.json'||ids.has(r.id))throw Error('器乐循环目录来源无效');ids.add(r.id)}return v.loops
}
export function verifyLoopTrack(p:LoopApproval,t:Track){validateLoop(p);if(t.id!==p.source.trackId||!t.provenance||(['masterSha256','reportSha256','vocalSha256','runId'] as const).some(k=>t.provenance![k]!==p.source[k])||t.duration<(p.startFrame+p.lengthFrames)/44100+16)throw Error('器乐循环与当前来源或后续覆盖不符')}
export function loopExit(p:LoopApproval,cycles:number,after:number):LoopExit{
 if(![4,8,16].includes(cycles)||!Number.isFinite(after)||after<0)throw Error('循环次数或释放时钟无效')
 const step=p.lengthFrames/2,n=Math.floor(after*44100/step)+1,atFrame=n*step
 if(atFrame>cycles*p.lengthFrames)throw Error('循环释放点已过')
 return {atFrame,sourceFrame:p.startFrame+(atFrame%p.lengthFrames||p.lengthFrames)}
}
export const loopPosition=(p:LoopApproval,elapsed:number)=>p.startFrame/44100+Math.max(0,elapsed)%(p.lengthFrames/44100)
// Repetition changes scheduling, never allocation. Native exits share two phases.
export const loopBytes=(p:LoopApproval,_cycles:number)=>8*(p.lengthFrames+Math.ceil(.008*44100))
