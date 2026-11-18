import type {Track,Plan} from '../metric-upstream/realtime/planner'
import type {StemArrangement} from './stem-arrangement'
import {STEM_ROLES,validateStemTimeline,validateTimelineVoices} from './stem-timeline'
import {valueAt} from './device-execution'
export function validateStemArrangement(value:any,a:Track,b:Track,p:Plan,calibrated=false):StemArrangement{
 const fail=()=>{throw Error('Jetson 声部编排或处理后证据不完整')}
 if(!value||value.schema!=='harbeat.stem-arrangement.v1'||value.method!=='stem-handover'||typeof value.eligible!=='boolean'||typeof value.recommended!=='boolean'||typeof value.reason!=='string'||value.reason.length>4096||!Array.isArray(value.requiredStems))fail()
 if(!value.eligible){if(value.recommended||value.score!==null||value.timeline!==null||value.evidence!==null||value.requiredStems.length)fail();return value}
 if(!Number.isFinite(value.score)||value.score<65||value.score>100||value.requiredStems.length!==4||[...value.requiredStems].sort().join()!==[...STEM_ROLES].sort().join())fail()
 const t=validateTimelineVoices(validateStemTimeline(value.timeline,p.duration),a,b,p),e=value.evidence
 if(!e||!['baseline','processed'].every(k=>e[k]&&STEM_ROLES.every(r=>Number.isFinite(e[k][r])&&e[k][r]>=0&&e[k][r]<=1))||e.processed.vocals>.01||!Number.isFinite(e.improvement)||e.improvement<.08||e.improvement>4||!e.headroom||!['peak','baselinePeak','riseDb'].every(k=>Number.isFinite(e.headroom[k]))||e.headroom.peak<0||e.headroom.peak>.95||e.headroom.baselinePeak<0||e.headroom.riseDb>3||e.headroom.eqApplied!==true||e.headroom.outputScale!==.76||!e.reconstruction||(['a','b'] as const).some(side=>[e.reconstruction[side],e.reconstruction[side]?.boundary].some(x=>!x||!Number.isFinite(x.errorRatio)||x.errorRatio<0||x.errorRatio>.25||!Number.isFinite(x.levelDeltaDb)||Math.abs(x.levelDeltaDb)>1.5))||!Number.isFinite(e.aTailEnd)||e.aTailEnd<0||e.aTailEnd>p.duration||!Number.isFinite(e.bVoiceEntry)||e.bVoiceEntry<0||e.bVoiceEntry>p.duration||valueAt(t.a.vocals,e.aTailEnd)<.999||valueAt(t.b.vocals,e.bVoiceEntry)<.999)fail()
 if(e.tailAnalysis){const q=e.tailAnalysis;if(q.dcRemoved!==true||q.frameSeconds!==.05||!Number.isFinite(q.tail)||q.tail<0||q.tail>e.aTailEnd+.001||!Number.isFinite(q.gateDb)||q.gateDb< -70.000001||!Number.isFinite(q.maximumAcRmsDb)||!Number.isFinite(q.maximumFrameMean)||q.maximumFrameMean<0)fail()}
 if(calibrated){const g=value.sourceGains,q=e.sourceCalibration;if(!g||Object.keys(g).sort().join()!=='a,b'||!q||q.mode!=='common-linear-gain-v1')fail();for(const side of ['a','b']){if(!Number.isFinite(g[side])||g[side]<.5||g[side]>2||q.gains?.[side]!==g[side]||!q.rawReconstruction?.[side]||!Number.isFinite(q.rawReconstruction[side].errorRatio)||!Number.isFinite(q.rawReconstruction[side].levelDeltaDb))fail()}}
 else if(value.sourceGains!==undefined||e.sourceCalibration!==undefined)fail()
 const c=e.compatibility
 if(!c||c.pass!==true||!Number.isFinite(c.pitchedRisk)||c.pitchedRisk<0||c.pitchedRisk>1||c.maximumPitchedRisk!==.35||!Number.isFinite(c.drumOverlapSeconds)||c.drumOverlapSeconds<0||c.drumOverlapSeconds>p.duration+.001||!Number.isFinite(c.drumOverlapLimit)||Math.abs(c.drumOverlapLimit-(30/a.bpm+.02))>.00001||!['observed','limited','not-overlapping'].includes(c.drumEvidence))fail()
 if(!['pitchedOverlapSeconds','incompatiblePitchedSeconds'].every(k=>Number.isFinite(c[k])&&c[k]>=0&&c[k]<=p.duration+.001)||c.incompatiblePitchedSeconds>c.pitchedOverlapSeconds+.001||c.incompatiblePitchedSeconds>c.drumOverlapLimit)fail()
 if(c.drumEvidence==='observed'){if(!Number.isFinite(c.drumDensityRatio)||c.drumDensityRatio<1||!Number.isFinite(c.drumOnsetAgreement)||c.drumOnsetAgreement<0||c.drumOnsetAgreement>1)fail()}else if(c.drumDensityRatio!==null||c.drumOnsetAgreement!==null)fail()
 if(c.drumOverlapSeconds>c.drumOverlapLimit&&(c.drumEvidence!=='observed'||c.drumDensityRatio>2.5||c.drumOnsetAgreement<.5))fail()
 return value
}
