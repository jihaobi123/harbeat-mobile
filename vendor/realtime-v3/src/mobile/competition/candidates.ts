import type {Track,Plan} from '../../listen-upstream/realtime/planner'
import type {DevicePrepared} from '../device-execution'
import type {Method} from '../../metric-upstream/metric-mix/types'
import type {CrossPlan} from '../crossgenre/planner'
import {scoreTransition,methodNames,type CreativeMethod,type MusicalFeatures} from './score'
import {boundarySupport,voiceFraction,levelDb,grooveConflict} from './music'
import type {DrumAuditionGroup} from '../drum-prelude-audition'
export type Candidate={id:string;kind:'stem'|'native';method:CreativeMethod;name:string;plan:Plan|CrossPlan;score:number;components:Record<string,number>;features:MusicalFeatures;eligible:boolean;reason:string;availability?:string;experimental:boolean;prelude?:DrumAuditionGroup}
export const candidateStart=(c:Candidate)=>c.prelude?.approval.sourceWindow.aStart??c.plan.start
export function preludeCandidate(a:Track,b:Track,g:DrumAuditionGroup,ready:boolean,position:number,budget:number,energy:number):Candidate{
 const row=stemCandidates(a,b,g.result.execution.plan,g.result,position,budget,energy).find(r=>r.method===g.singleMethod)!,e=(g.approval as any).evidence?.auditionAudio
 const features={...row.features,drumConflict:Math.min(row.features.drumConflict,1-Math.max(0,Math.min(1,e?.onsetAgreement??0))),tailFit:e?.onsetAgreement??0,uncertainty:row.features.uncertainty+.15},scored=scoreTransition('drum-first',features)
 return{...row,...scored,id:'drum-first|'+g.id,name:methodNames['drum-first'],prelude:g,eligible:row.eligible&&ready,experimental:true,reason:ready?'固定来源与 Jetson 鼓层批准通过；试听评分尚未记录':'等待固定案例的延展分轨 PCM'}
}
export function nativeCandidate(a:Track,b:Track,p:CrossPlan,position:number,budget:number,energy=3):Candidate{
 const groove=grooveConflict(a,b,p.exit,p.entry),mapping=p.mapping
 const f:MusicalFeatures={boundary:Math.min(boundarySupport(a,p.exit),boundarySupport(b,p.entry)),vocalConflict:voiceFraction(b,p.entry,p.entry+.5)??.4,drumConflict:groove.value,levelJumpDb:p.evidence.levelDeltaDb,tempoChange:Math.abs(Math.log2(b.bpm/a.bpm))/.5,waitFraction:(p.end-position)/Math.max(1,budget),benefit:0,tailFit:p.echo||p.fx?Math.max(0,1-(voiceFraction(b,p.entry,p.entry+1)??.5)):mapping?.onsetOverlap??0,uncertainty:(groove.unknown?.3:0)+(p.bridge||p.fx||mapping?.humanReview==='unscored'?.15:0),tempoGap:Math.abs(Math.log2(b.bpm/a.bpm)),incomingVoice:voiceFraction(b,p.entry,p.entry+1)??.5,outgoingVoice:voiceFraction(a,p.exit-1,p.exit)??.5}
 if(mapping)f.tempoChange=Math.abs(mapping.residualRate-1)/.05
 f.energyTargetDb=(energy-3)*1.25
 const scored=scoreTransition(p.family,f)
 return{id:p.id,kind:'native',name:methodNames[p.family],plan:p,...scored,eligible:true,reason:`段落依据 ${Math.round(f.boundary*100)}%；人声重叠 ${Math.round(f.vocalConflict*100)}%；节奏差异代理 ${Math.round(f.drumConflict*100)}%；音量差 ${f.levelJumpDb.toFixed(1)} dB；速度跨度 ${Math.round(Math.abs(b.bpm/a.bpm-1)*100)}%；场景适配 ${scored.components.sceneFit.toFixed(1)}${groove.unknown?'；节奏依据不足已扣分':''}`,experimental:!!p.bridge||!!mapping||!!p.fx}
}
export function stemCandidates(a:Track,b:Track,p:Plan,result:DevicePrepared|null,position:number,budget:number,energy=3):Candidate[]{
 const groove=grooveConflict(a,b,p.end,p.window.start),aDb=levelDb(a,Math.max(0,p.start-4),p.start),bDb=levelDb(b,p.window.end,p.window.end+4)
 const rows:Candidate[]=(['bass','filter','yield','vocal','bass_filter'] as Method[]).map(method=>{
  const approved=result?.decision.methods[method],original=result?.decision.methods.original,benefit=approved?.score!=null&&original?.score!=null?Math.max(0,Math.min(1,(approved.score-original.score)/25)):0
  const collision=(p.aVocal??0)*(p.bVocal??0),f:MusicalFeatures={boundary:Math.min(boundarySupport(a,p.end),boundarySupport(b,p.window.start)),vocalConflict:method==='vocal'&&result?.metrics.vocalSafe?collision*.25:collision,drumConflict:groove.value,levelJumpDb:aDb!==null&&bDb!==null?bDb-aDb:0,tempoChange:Math.abs(p.rate-1)/.05,waitFraction:(p.end-position)/Math.max(1,budget),benefit,tailFit:0,uncertainty:(groove.unknown?.3:0)+(aDb===null||bDb===null?.2:0)}
  f.energyTargetDb=(energy-3)*1.25
  const scored=scoreTransition(method as CreativeMethod,f),eligible=!!result&&approved?.eligible===true
  return{id:method+'|'+p.id,kind:'stem' as const,name:methodNames[method],plan:p,...scored,eligible,reason:!result?'等待当前接点的 Jetson 批准与本机 PCM':!eligible?approved?.reason??'未通过 Jetson 检查':`${approved.reason}；共同评分已考虑节奏重叠、人声、能量与变速`,experimental:false}
 })
 const arrangement=result?.execution?.arrangement,features={...rows[0].features,vocalConflict:arrangement?.evidence?.processed.vocals??1,drumConflict:arrangement?.evidence?.processed.drums??1}
 rows.push({id:'stem-handover|'+p.id,kind:'stem',method:'stem-handover',name:methodNames['stem-handover'],plan:p,score:arrangement?.score??0,components:{jetsonProcessedScore:arrangement?.score??0},features,eligible:arrangement?.eligible===true&&arrangement.recommended===true,reason:arrangement?.reason??'等待 Jetson 独立声部编排与本机 PCM',experimental:false})
 return rows
}
