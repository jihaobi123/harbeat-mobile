export const COMPETITION_POLICY='musical-transition-competition-v1'
import {exitNames,type ExitExperiment} from './exit-experiments'
export type CreativeMethod='stem-handover'|'bass'|'filter'|'yield'|'vocal'|'bass_filter'|'structural-cut'|'echo-out'|'drum-bridge'|'loop-ramp'|'half-double'|'drum-first'|ExitExperiment
export const methodNames:Record<CreativeMethod|'original',string>={'stem-handover':'分轨交错交接',original:'原渐混后备',bass:'独立贝斯交接',filter:'旋律滤波',yield:'旋律让位',vocal:'人声保留后退出',bass_filter:'贝斯交接＋旋律滤波','structural-cut':'段落短切','echo-out':'回声收尾','drum-bridge':'鼓桥接歌','loop-ramp':'鼓桥连续变速','half-double':'半／双拍对位接歌','drum-first':'鼓先行',...exitNames}
export const experimentalMethod=(method:string)=>['drum-first','drum-bridge','loop-ramp','half-double',...Object.keys(exitNames)].includes(method)
export type MusicalFeatures={boundary:number;vocalConflict:number;drumConflict:number;levelJumpDb:number;tempoChange:number;waitFraction:number;benefit:number;tailFit:number;uncertainty:number;energyTargetDb?:number;tempoGap?:number;incomingVoice?:number;outgoingVoice?:number}
const clamp=(v:number)=>Math.max(0,Math.min(1,v))
/** Shared evidence contributions. Not a trained perceptual score or probability. */
export function scoreTransition(method:CreativeMethod,f:MusicalFeatures){
 if(!Object.values(f).every(Number.isFinite))throw Error('Non-finite transition evidence')
 const stem=['bass','filter','yield','vocal','bass_filter','drum-first'].includes(method)
 const c:Record<string,number>={base:60,boundary:12*clamp(f.boundary),vocalConflict:stem?-20*clamp(f.vocalConflict):8*(1-clamp(f.vocalConflict)),levelJump:-6*clamp(Math.abs(f.levelJumpDb)/6),energyPreference:-4*clamp(Math.abs(f.levelJumpDb-(f.energyTargetDb??0))/5),waiting:-3*clamp(f.waitFraction),uncertainty:-10*clamp(f.uncertainty)}
 if(stem){c.approvedBenefit=14*clamp(f.benefit);c.drumConflict=6*(1-clamp(f.drumConflict))-24*clamp(f.drumConflict);c.tempo=-8*clamp(f.tempoChange);if(method==='drum-first')c.drumLead=8*clamp(f.tailFit)}
 else{c.drumConflict=10*clamp(f.drumConflict);c.tempo=-12*clamp(f.tempoChange);if(method==='echo-out')c.tailFit=6*clamp(f.tailFit)-2;if(method==='half-double')c.accentMapping=4*clamp(f.tailFit);if(method==='drum-bridge'||method==='loop-ramp'){c.bridge=12*clamp(f.drumConflict)+8*clamp(f.tempoChange)-8;c.tempo=method==='loop-ramp'?-2*clamp(f.tempoChange):c.tempo}}
 if(f.tempoGap!==undefined){const gap=clamp(f.tempoGap/.5),drum=clamp(f.drumConflict),iv=clamp(f.incomingVoice??f.vocalConflict),ov=clamp(f.outgoingVoice??0)
  c.sceneFit=stem?-4*gap-4*gap*drum:method==='vinyl-brake'?10*gap+2*drum-2-2*ov:method==='backspin-echo'?6*gap+6*drum-3-8*iv-6*ov:method==='loop-roll'?12*(1-gap)*drum-4*gap-3-8*ov:method==='reverb-out'?5*gap+4*(1-drum)-1-10*iv-2*ov:method==='echo-out'?2*gap-6*iv:method==='structural-cut'?3*gap+2*drum:method==='half-double'?3*(1-gap):2*drum-4*iv
  if(Object.hasOwn(exitNames,method))c.tempo=0
  if(method==='reverb-out')c.tailFit=6*clamp(f.tailFit)-2
 }
 return{method,score:Math.round(Math.max(0,Math.min(100,Object.values(c).reduce((s,v)=>s+v,0)))*100)/100,components:c,features:f}
}
export function chooseTransition<T extends {id:string;score:number;eligible:boolean;reason:string}>(rows:T[],manual:boolean,preferred?:(row:T)=>boolean){
 const ranked=rows.filter(r=>r.eligible&&Number.isFinite(r.score)&&r.score>=65).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
 const best=ranked[0],reference=!manual&&preferred&&best?ranked.find(row=>best.score-row.score<=1.5&&preferred(row)):null
 return{winner:reference??best??null,fallback:!ranked.length&&manual,reason:reference&&reference!==best?'通过共同门槛，评分接近时优先考虑已复核的 DJ 曲对':ranked.length?'来源、执行条件通过后按共同音乐证据排序':manual?'没有达到共同门槛的可执行方案，用户手动请求允许原渐混后备':'没有达到共同门槛的可执行方案，保留当前播放'}
}
