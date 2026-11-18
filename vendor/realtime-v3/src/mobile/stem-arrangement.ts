import type {Track,Plan} from '../metric-upstream/realtime/planner'
import type {WindowPCM,PCM} from './decision-core'
import {rms} from './decision-core'
import {valueAt,type Point} from './device-execution'
import {STEM_ROLES,validateStemTimeline,validateTimelineVoices,voicePhrases,type StemRole,type StemTimeline} from './stem-timeline'
import {calibrateStemSources} from './stem-calibration'
import {vocalEnvelope} from './vocal-envelope'
import {measureStemCompatibility} from './stem-compatibility'
import {measureTimelineAudio,measureReconstruction} from './timeline-audio-evidence'
import {sourceChroma,chromaDifference} from './source-features'
export type StemConflicts=Record<StemRole,number>
export type StemArrangement={schema:'harbeat.stem-arrangement.v1';method:'stem-handover';sourceGains?:Record<'a'|'b',number>;eligible:boolean;recommended:boolean;score:number|null;reason:string;requiredStems:StemRole[];timeline:StemTimeline|null;evidence:{baseline:StemConflicts;processed:StemConflicts;improvement:number;sourceCalibration?:NonNullable<ReturnType<typeof calibrateStemSources>>['evidence'];compatibility:ReturnType<typeof measureStemCompatibility>;headroom:ReturnType<typeof measureTimelineAudio>;reconstruction:ReturnType<typeof measureReconstruction>;aTailEnd:number;bVoiceEntry:number;tailAnalysis:ReturnType<typeof vocalEnvelope>;basis:string;limitations:string[]}|null}
export function evaluateStemConflicts(audio:WindowPCM,t:StemTimeline):StemConflicts{
 const result={} as StemConflicts
 for(const role of STEM_ROLES){const a=audio.a[role],b=audio.b[role];if(!a||!b)throw Error('处理后冲突检查缺少同源声部');const sr=a.sampleRate,step=Math.round(sr*.125),frames=Math.round(t.duration*sr);let total=0,count=0
  for(let i=0;i<frames;i+=step){const end=Math.min(frames,i+step),time=(i+end)/2/sr,aa=rms(a,i,end)*valueAt(t.a[role],time),bb=rms(b,i,end)*valueAt(t.b[role],time);total+=aa<10**(-45/20)||bb<10**(-45/20)?0:2*Math.min(aa,bb)/(aa+bb+1e-12);count++}
  result[role]=total/Math.max(1,count)
 }return result
}
const baseline=(d:number):StemTimeline=>({schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration:d,a:Object.fromEntries(STEM_ROLES.map(r=>[r,[[0,1],[d,0]]])) as StemTimeline['a'],b:Object.fromEntries(STEM_ROLES.map(r=>[r,[[0,0],[d,1]]])) as StemTimeline['b']})
const mono=(v:PCM,d:number)=>{const x=new Float32Array(Math.round(d*v.sampleRate)),a=v.getChannelData(0),b=v.getChannelData(1);for(let i=0;i<x.length;i++)x[i]=(a[i]+b[i])*.5;return x}
export function analyseStemArrangement(a:Track,b:Track,p:Plan,audio:WindowPCM,options:{calibrateSources?:boolean}={}):StemArrangement{
 const fail=(reason:string):StemArrangement=>({schema:'harbeat.stem-arrangement.v1',method:'stem-handover',eligible:false,recommended:false,score:null,reason,requiredStems:[],timeline:null,evidence:null})
 const d=p.duration;if(d<1||d>32||p.rate<.95||p.rate>1.05||(['a','b'] as const).some(side=>['master',...STEM_ROLES].some(r=>!audio[side][r]||audio[side][r].sampleRate!==44100||audio[side][r].length<Math.round(d*44100))))return fail('缺少完整同源四分轨或超出已验证窗口')
 const calibration=options.calibrateSources?calibrateStemSources(audio,d):null
 if(options.calibrateSources&&!calibration)return fail('同源分轨共同增益无法在已验证范围内标定')
 if(calibration)audio=calibration.audio
 const t=baseline(d),relativeBeats=a.alignment!.bars.flatMap(row=>row.beats).map(x=>x-p.start).filter(x=>x>=0&&x<=d),beat=Math.max(.1,60/a.bpm),swap=(role:StemRole,fraction:number)=>{const at=relativeBeats.find(x=>x>=d*fraction)??d*fraction,start=Math.max(.05,Math.min(d-.1,at)),end=Math.min(d-.05,start+Math.max(.05,beat*.5));t.a[role]=[[0,1],[start,1],[end,0],[d,0]];t.b[role]=[[0,0],[start,0],[end,1],[d,1]]}
 // Separate pitched material first, then bass; rhythm keeps its own later clock.
 swap('other',.2);swap('bass',.45);swap('drums',.7)
 const ap=voicePhrases(a).filter(([s,e])=>s<p.end&&e>p.start)
 if(ap.some(([,e])=>e>p.end+.002))return fail('A 人声在接管点后仍未唱完，保持原人声规则')
 const tailAnalysis=vocalEnvelope(audio.a.vocals,d),tail=Math.max(tailAnalysis.tail,0,...ap.map(([,e])=>e-p.start)),release=relativeBeats.find(x=>x>=tail+.08&&x+.2<=d-.12)
 if(release===undefined)return fail('A 人声尾音之后没有足够拍点和退出空隙')
 const releaseEnd=release+.2;t.a.vocals=[[0,1],[release,1],[releaseEnd,0],[d,0]]
 const bp=voicePhrases(b),incoming=bp.find(([s])=>(s-p.window.start)/p.rate>=releaseEnd+.12&&(s-p.window.start)/p.rate<d-.05)
 let entry=incoming?(incoming[0]-p.window.start)/p.rate:d
 if(!incoming&&bp.some(([s,e])=>e>p.window.start+releaseEnd*p.rate&&s<p.window.end))return fail('B 没有可恢复的完整人声句入口，不能从半句中打开')
 const begin=entry-.08;if(begin<releaseEnd+.02||bp.some(([s,e])=>s<p.window.start+entry*p.rate-.00001&&e>p.window.start+begin*p.rate+.00001))return fail('B 人声入口前缺少安全空隙')
 t.b.vocals=[[0,0],[begin,0],[entry,1],...(entry<d?[[d,1] as Point]:[])]
 try{validateStemTimeline(t,d);validateTimelineVoices(t,a,b,p)}catch{return fail('人声完整性或声部曲线连续性校验未通过')}
 // Try harmonic-role orderings at the same cue; a failed cross-role overlap
 // falls back to a short joint pitched exchange, never to a relaxed gate.
 let compatibility=measureStemCompatibility(audio,t,a.bpm)
 if(!compatibility.pass){swap('bass',.2);swap('other',.45);compatibility=measureStemCompatibility(audio,t,a.bpm)}
 if(!compatibility.pass){swap('bass',.2);swap('other',.2);compatibility=measureStemCompatibility(audio,t,a.bpm)}
 if(!compatibility.pass){swap('bass',.45);swap('other',.45);compatibility=measureStemCompatibility(audio,t,a.bpm)}
 if(!compatibility.pass)return fail('保留的旋律与贝斯交叉声部或鼓组重叠仍不相容，保留较简单方案')
 validateStemTimeline(t,d)
 const raw=evaluateStemConflicts(audio,baseline(d)),processed=evaluateStemConflicts(audio,t),pitch={} as Record<'bass'|'other',number>
 for(const role of ['bass','other'] as const){const aa=audio.a[role],bb=audio.b[role];pitch[role]=chromaDifference(sourceChroma(mono(aa,d),aa.sampleRate),sourceChroma(mono(bb,d),bb.sampleRate))??1}
 const risk=(x:StemConflicts)=>x.vocals*2+x.bass*pitch.bass+x.other*pitch.other,improvement=risk(raw)-risk(processed)
 const reconstruction=measureReconstruction(audio,d);if(Object.values(reconstruction).some(v=>[v,v.boundary].some(x=>x.errorRatio>.25||Math.abs(x.levelDeltaDb)>1.5)))return fail('分轨重建与原曲差异过大，不能保证连续进入和正文接管')
 const headroom=measureTimelineAudio(audio,t,p)
 if(!Number.isFinite(headroom.peak)||headroom.peak>.95||headroom.riseDb>3)return fail('处理后混合峰值或音量增长超过已验证余量')
 if(processed.vocals>.01)return fail('处理后的实际人声仍有同时发声冲突')
 if(improvement<.08)return fail('当前窗口没有足够的处理后冲突改善，保留较简单方案')
 return{schema:'harbeat.stem-arrangement.v1',method:'stem-handover',...(calibration?{sourceGains:calibration.gains}:{}),eligible:true,recommended:true,score:Math.min(95,70+20*improvement),reason:'Jetson 按处理后的实际声部重叠批准独立时间线',requiredStems:[...STEM_ROLES],timeline:t,evidence:{baseline:raw,processed,improvement,...(calibration?{sourceCalibration:calibration.evidence}:{}),compatibility,headroom,reconstruction,aTailEnd:tail,bVoiceEntry:entry,tailAnalysis,basis:'gain-weighted source-bound stems; source chroma proxy',limitations:['活动区间不是歌词语义分句','色度差异不是和弦真值；仅对色度集中的人声检查和声，非调性说唱仍以活动及拍点规则约束','峰值含逐声部 EQ 的 128 帧系数代理；端侧仍需音量保护','分离串音仍有检测局限，需试听验证']}}
}
