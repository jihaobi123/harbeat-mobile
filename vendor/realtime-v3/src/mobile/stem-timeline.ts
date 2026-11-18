import type {Track,Plan} from '../metric-upstream/realtime/planner'
import {valueAt,type Point} from './device-execution'
export const STEM_ROLES=['drums','bass','other','vocals'] as const
export type StemRole=typeof STEM_ROLES[number]
export type StemTimeline={schema:'harbeat.stem-timeline.v1';clock:'transition-start';duration:number;a:Record<StemRole,Point[]>;b:Record<StemRole,Point[]>}
export function validateStemTimeline(value:any,duration:number):StemTimeline{
 const fail=()=>{throw Error('声部时间线缺失、越界或无法连续接管正文')}
 if(value?.schema!=='harbeat.stem-timeline.v1'||value.clock!=='transition-start'||!Number.isFinite(duration)||duration<1||duration>32||value.duration!==duration)fail()
 for(const side of ['a','b'] as const){if(!value[side]||Object.keys(value[side]).sort().join()!==[...STEM_ROLES].sort().join())fail()
  for(const role of STEM_ROLES){const points=value[side][role];if(!Array.isArray(points)||points.length<2||points.length>32)fail()
   for(let i=0;i<points.length;i++){const p=points[i],q=points[i-1];if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[0]>duration||p[1]<0||p[1]>1||q&&(p[0]<=q[0]||Math.abs(p[1]-q[1])/(p[0]-q[0])>20.000001))fail()}
   if(points[0][0]!==0||points.at(-1)[0]!==duration||points[0][1]!==Number(side==='a')||points.at(-1)[1]!==Number(side==='b'))fail()
  }
 }
 // Do not allow two full bass/drum/melody/vocal layers to double the same bus.
 for(const role of STEM_ROLES){const times=new Set<number>([...value.a[role],...value.b[role]].map(p=>p[0]));for(const t of times)if(valueAt(value.a[role],t)+valueAt(value.b[role],t)>1.000001)fail()}
 return value
}
/** Merge short breaths. These are source-bound activity phrases, not lyric semantics. */
export function voicePhrases(t:Track):[number,number][]{
 const intervals=[...(t.vocals??[]),...(t.alignment?.phrases??[]).map(p=>[p.start,p.tailEnd] as [number,number])].filter(([s,e])=>Number.isFinite(s)&&Number.isFinite(e)&&e>s).sort((a,b)=>a[0]-b[0]),out:[number,number][]=[]
 for(const [s,e] of intervals){const last=out.at(-1);if(last&&s-last[1]<.35)last[1]=Math.max(last[1],e);else out.push([s,e])}return out
}
export function validateTimelineVoices(t:StemTimeline,a:Track,b:Track,p:Plan){
 if(!Array.isArray(a.vocals)||!Array.isArray(b.vocals))throw Error('声部时间线缺少同源人声活动依据')
 const fail=()=>{throw Error('声部时间线不能截断 A 人声或从 B 半句中恢复')},times=(curve:Point[],s:number,e:number)=>[Math.max(0,s),Math.min(t.duration,e),...curve.filter(([x])=>x>s&&x<e).map(([x])=>x)]
 for(const [s,e] of voicePhrases(a))if(e>p.start&&s<p.end){if(e>p.end+.002)fail();if(times(t.a.vocals,s-p.start,e-p.start).some(x=>valueAt(t.a.vocals,x)<.999))fail()}
 for(const [s,e] of voicePhrases(b))if(e>p.window.start&&s<p.window.end){const ss=(s-p.window.start)/p.rate,ee=(e-p.window.start)/p.rate,levels=times(t.b.vocals,ss,ee).map(x=>valueAt(t.b.vocals,x));if(!levels.every(x=>x<.001)&&!(ss>=-.002&&levels.every(x=>x>.999)))fail()}
 return t
}
