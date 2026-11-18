import type {Track} from '../listen-upstream/realtime/planner'
// Preparation availability, separate from all musical admission/scoring. The
// observed cold Jetson round trip was ~49 s; keep an 8 s arm margin within 60 s.
export const CONTINUATION_RESERVE_SECONDS=60
export type ContinuationAssessment={allowed:boolean;code:string;reason:string;reserveSeconds:number;window?:{start:number;end:number}}
export function assessContinuation(track:Track,position:number):ContinuationAssessment{
 const reserveSeconds=CONTINUATION_RESERVE_SECONDS,fail=(reason:string,code='continuation-window-unavailable'):ContinuationAssessment=>({allowed:false,code,reason,reserveSeconds})
 if(!Number.isFinite(position)||position<0||!Number.isFinite(track.duration)||!track.provenance||!track.alignment?.source||track.alignment.source.reportId!==track.reportId||(['masterSha256','reportSha256','vocalSha256'] as const).some(k=>track.alignment!.source[k]!==track.provenance![k])||!Array.isArray(track.alignment.bars))return fail('缺少下一跳准备区间的来源依据','continuation-evidence-unavailable')
 const bars=track.alignment.bars
 const valid=(b:typeof bars[number])=>b&&b.valid&&Array.isArray(b.beats)&&b.beats.length===4&&Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start&&b.beats.every((x,i)=>Number.isFinite(x)&&x>=b.start&&x<b.end&&(!i||x>b.beats[i-1]))
 for(let i=0;i<bars.length-1;i++){const a=bars[i],b=bars[i+1];if(!valid(a)||!valid(b)||a.start<position+reserveSeconds||b.end>track.duration-.1||Math.abs(a.end-b.start)>.001)continue
  return{allowed:true,code:'continuation-window-ready',reason:'接管后仍有下一轮准备空间与连续拍点；下一跳仍需独立通过音乐检查',reserveSeconds,window:{start:a.start,end:b.end}}
 }
 return fail('该入口靠近曲尾，下一跳来不及准备；自动演出改找更早入口或其他歌曲')
}

/** Reserve preparation time after an automatic takeover, including playback-only sources. */
export function assessAutoRunway(track:Track,position:number):ContinuationAssessment{
 const reserveSeconds=Math.min(CONTINUATION_RESERVE_SECONDS,track.duration/2)
 const allowed=Number.isFinite(reserveSeconds)&&reserveSeconds>0&&Number.isFinite(position)&&position>=0&&track.duration-position>=reserveSeconds
 return {allowed,code:allowed?'continuation-runway-ready':'continuation-runway-too-short',reason:allowed?'':'下一首的入口靠近曲尾，剩余时长不足以准备后续接歌',reserveSeconds}
}
