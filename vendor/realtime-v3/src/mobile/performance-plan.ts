import type {Track} from '../metric-upstream/realtime/planner'
export type ScratchStroke={start:number;end:number;from:number;to:number}
export type ScratchPlan={version:'baby-scratch-v2';technique:'baby';trackId:string;start:number;end:number;duration:number;rate:number;bpm:number;evidence:'measured-half-beats';sourceEvidence:'published-band-onset';sourceStart:number;sourceDuration:number;strokes:ScratchStroke[]}
const peakSpeed=1.6,rampFraction=.15,padding=.04
/** Read published evidence only: energy selects material, never arbitrary rhythm. */
export function planScratch(track:Track,position:number,rate=1):ScratchPlan{
 if(!Number.isFinite(position)||position<0||!Number.isFinite(rate)||rate<.5||rate>2)throw Error('播放时钟无效')
 const alignment=track.alignment
 if(!alignment)throw Error('当前歌曲缺少已分析拍点，暂不能搓碟')
 const identity=track.provenance?.masterSha256
 if(!identity||alignment.source?.masterSha256!==identity)throw Error('拍点分析与原曲身份不一致')
 const rows=alignment.bars.filter(r=>r.valid&&r.beats.length===4&&Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start&&Math.abs(r.beats[0]-r.start)<.002&&r.beats.every((t,i)=>Number.isFinite(t)&&t>=r.start&&t<r.end&&(!i||t>r.beats[i-1])))
 const beats=[...new Set(rows.flatMap(r=>r.beats))].sort((a,b)=>a-b),index=beats.findIndex(t=>t>=position+.18*rate)
 if(index<0||index+2>=beats.length)throw Error('附近没有完整可用拍点，暂不能搓碟')
 const start=beats[index],end=beats[index+2],duration=(end-start)/rate,intervals=[beats[index+1]-start,end-beats[index+1]]
 if(start-position>1.6*rate||end>track.duration-.2||intervals.some(x=>x/rate<.22||x/rate>1.5)||Math.max(...intervals)/Math.min(...intervals)>1.35||duration>3)throw Error('附近拍点不稳定或接近曲末，暂不能搓碟')
 const strokes:ScratchStroke[]=[]
 let cursor=0
 for(const interval of intervals){
  const half=interval/rate/2,excursion=peakSpeed*(1-rampFraction)*half
  strokes.push({start:cursor,end:cursor+half,from:padding,to:padding+excursion},{start:cursor+half,end:cursor+2*half,from:padding+excursion,to:padding});cursor+=half*2
 }
 const sourceDuration=Math.max(...strokes.map(s=>Math.max(s.from,s.to)))+padding
 const frames=(alignment.bandFrames??[]).filter(f=>Number.isFinite(f.start)&&Number.isFinite(f.end)&&f.end>f.start&&f.end>start-.25&&f.start<start+.4).sort((a,b)=>a.start-b.start)
 const power=(db:number|null)=>db===null?0:Number.isFinite(db)?10**(db/10):NaN
 let best:{start:number;score:number}|null=null
 for(let i=1;i<frames.length;i++){
  const f=frames[i],previous=frames[i-1]
  if(f.start<start-.15||f.start>start+.35||Math.abs(f.start-previous.end)>.006)continue
  const low=power(f.low),midHigh=power(f.mid)+power(f.high),prior=power(previous.mid)+power(previous.high),rise=midHigh-prior,share=midHigh/(low+midHigh+1e-12)
  if(![low,midHigh,prior,share].every(Number.isFinite)||midHigh<1e-4||rise<midHigh*.12||share<.2)continue
  const sourceStart=f.start-padding,score=rise*share
  if(sourceStart<0||sourceStart+sourceDuration>track.duration)continue
  if(!best||score>best.score)best={start:sourceStart,score}
 }
 if(!best)throw Error('附近缺少清晰的中高频起音，暂不适合搓碟')
 return {version:'baby-scratch-v2',technique:'baby',trackId:track.id,start,end,duration,rate,bpm:120/duration,evidence:'measured-half-beats',sourceEvidence:'published-band-onset',sourceStart:best.start,sourceDuration,strokes}
}
/** Trapezoidal signed velocity: smooth turns, sustained push/pull, stable peak speed. */
function travel(phase:number){
 const r=rampFraction,a=1-r
 if(phase<r)return phase*phase/(2*r*a)
 if(phase>1-r)return 1-(1-phase)**2/(2*r*a)
 return (phase-r/2)/a
}
// Fixed peak-speed bound permits one conservative low-pass interpolation bank.
// 16 taps / 256 phases, normalized for DC; no trig in the audio sample loop.
const radius=8,phases=256,cutoff=.9/peakSpeed
const kernels=Array.from({length:phases},(_,phase)=>{
 const fraction=phase/phases,weights=new Float64Array(radius*2)
 for(let k=0;k<weights.length;k++){
  const x=k-radius+1-fraction,sinc=Math.abs(x)<1e-10?cutoff:Math.sin(Math.PI*cutoff*x)/(Math.PI*x)
  weights[k]=Math.abs(x)<radius?sinc*(.5+.5*Math.cos(Math.PI*x/radius)):0
 }
 const sum=weights.reduce((s,v)=>s+v,0);return weights.map(w=>w/sum)
})
/** Cached original only; the scratch copy loses bass, source buffers stay untouched. */
export function renderScratch(channels:Float32Array[],sampleRate:number,plan:ScratchPlan):Float32Array[]{
 if(!Number.isFinite(sampleRate)||sampleRate<8000||!channels.length||channels.length>2||!Number.isFinite(plan.duration)||plan.duration<=0||plan.duration>3||!Number.isFinite(plan.sourceDuration)||channels.some(c=>c.length<Math.floor(sampleRate*plan.sourceDuration)||c.length!==channels[0].length)||plan.strokes.length!==4)throw Error('搓碟片段覆盖不足')
 const alpha=Math.exp(-2*Math.PI*180/sampleRate)
 const filtered=channels.map(channel=>{
  const out=new Float32Array(channel.length);let x1=0,y1=0,x2=0,y2=0
  for(let i=0;i<channel.length;i++){
   const x=Number.isFinite(channel[i])?channel[i]:0
   y1=alpha*(y1+x-x1);x1=x;y2=alpha*(y2+y1-x2);x2=y1;out[i]=y2
  }
  return out
 })
 let inputPeak=0;for(const channel of filtered)for(const value of channel)inputPeak=Math.max(inputPeak,Math.abs(value))
 if(inputPeak<.003)throw Error('当前片段过滤后太安静，暂不适合搓碟')
 const result=channels.map(()=>new Float32Array(Math.round(sampleRate*plan.duration)))
 let strokeIndex=0,peak=0
 for(let i=0;i<result[0].length;i++){
  const time=i/sampleRate
  while(strokeIndex<plan.strokes.length-1&&time>=plan.strokes[strokeIndex].end)strokeIndex++
  const s=plan.strokes[strokeIndex],local=time-s.start,span=s.end-s.start,phase=Math.max(0,Math.min(1,local/span))
  const position=(s.from+(s.to-s.from)*travel(phase))*sampleRate,j=Math.floor(position),kernel=kernels[Math.min(phases-1,Math.floor((position-j)*phases))],edge=Math.min(.004,span*.04),gate=Math.max(0,Math.min(1,local/edge,(span-local)/edge))
  for(let c=0;c<channels.length;c++){
   let value=0;for(let k=0;k<kernel.length;k++)value+=(filtered[c][j+k-radius+1]??0)*kernel[k]
   result[c][i]=value*gate;peak=Math.max(peak,Math.abs(result[c][i]))
  }
 }
 if(peak>.85)for(const channel of result)for(let i=0;i<channel.length;i++)channel[i]*=.85/peak
 return result
}
