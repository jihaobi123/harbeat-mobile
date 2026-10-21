/** Pure Jetson judgment. No audio scheduling or browser APIs. */
import type {Track,Plan} from '../metric-upstream/realtime/planner'
import type {Prepared,Method} from '../metric-upstream/metric-mix/types'
import type {Controls} from './device-execution'
import {sourceChroma,chromaDifference} from './source-features'
export type PCM=Pick<AudioBuffer,'length'|'sampleRate'|'numberOfChannels'|'getChannelData'>
export type WindowPCM={a:Record<string,PCM>;b:Record<string,PCM>}
export function pcmBuffer(interleaved:Float32Array,sampleRate:number):PCM{
 if(interleaved.length%2||interleaved.some(v=>!Number.isFinite(v)))throw Error('Invalid stereo PCM')
 const channels=[new Float32Array(interleaved.length/2),new Float32Array(interleaved.length/2)]
 for(let i=0;i<channels[0].length;i++){channels[0][i]=interleaved[i*2];channels[1][i]=interleaved[i*2+1]}
 return{length:channels[0].length,sampleRate,numberOfChannels:2,getChannelData:i=>channels[i]}
}
export function rms(b:PCM,start=0,end=b.length){let sum=0;for(let c=0;c<2;c++){const x=b.getChannelData(c);for(let i=start;i<Math.min(end,b.length);i++)sum+=x[i]*x[i]}return Math.sqrt(sum/(2*Math.max(1,Math.min(end,b.length)-start)))}
export function stemOverlap(a:PCM,b:PCM){const size=Math.round(a.sampleRate*.125),n=Math.min(a.length,b.length),values:number[]=[];for(let i=0;i<n;i+=size){const pa=rms(a,i,Math.min(n,i+size)),pb=rms(b,i,Math.min(n,i+size)),g=(i+size/2)/n;if(pa<10**(-45/20)||pb<10**(-45/20)){values.push(0);continue}const x=pa*(1-g),y=pb*g;values.push(2*Math.min(x,y)/(x+y+1e-12))}return Math.max(0,Math.min(1,values.reduce((s,x)=>s+x,0)/Math.max(1,values.length)))}
function vocalExit(a:Track,b:Track,buffers:WindowPCM,p:Plan){
 const av=buffers.a.vocals,bv=buffers.b.vocals;if(!av||!bv)return undefined
 const step=Math.round(av.sampleRate*.05),levels:number[]=[];for(let i=0;i<av.length;i+=step)levels.push(rms(av,i,i+step));const sorted=[...levels].sort((a,b)=>a-b),gate=Math.max(sorted[Math.floor(sorted.length*.95)]*.008,10**(-70/20));let tail=0
 for(let i=0;i<levels.length;i++)if(levels[i]>=gate)tail=Math.min(p.duration,(i+1)*.05)
 for(const [s,e] of a.vocals??[])if(s<p.end&&e>p.start)tail=Math.max(tail,Math.min(e,p.end)-p.start)
 const beat=a.alignment?.bars.flatMap(b=>b.beats).find(t=>t>=p.start+tail+.08&&t+.45<=p.end)
 if(beat===undefined||tail<p.duration*.2||p.duration-tail<.25)return undefined
 const fadeStart=beat-p.start,fadeEnd=fadeStart+.2,bSafe=p.window.start+(fadeEnd+.08)*p.rate
 if((b.vocals??[]).some(([s,e])=>s<bSafe&&e>p.window.start-.08)||rms(bv,0,Math.round((fadeEnd+.08)*bv.sampleRate))>10**(-45/20))return undefined
 return{fadeStart,fadeEnd,tailEnd:tail}
}
const names={original:'原渐混',bass:'独立贝斯交接',filter:'旋律滤波',yield:'旋律让位',vocal:'人声唱完再退出',bass_filter:'贝斯交接＋旋律滤波'}
export function analyseWindow(a:Track,b:Track,p:Plan,audio:WindowPCM){
 const bars=a.alignment!.bars.filter(r=>r.start>=p.start-.065&&r.end<=p.end+.065),last=bars.at(-1),prev=bars.at(-2)
 if(!last||!prev||!audio.a.master||!audio.b.master)throw Error('Incomplete qualified source window')
 // Observed bar boundaries can lead the frozen source cue by up to 65 ms.
 // Curves begin at this source window; never schedule a negative relative event.
 const relative=(time:number)=>Math.max(0,Math.min(p.duration,time-p.start))
 const controls:Controls={duration:p.duration,lastBarStart:relative(last.start),bassTiming:{duckStart:relative(prev.start),swapStart:relative(prev.beats[3]),swapEnd:relative(last.start)},vocalExit:vocalExit(a,b,audio,p)}
 const metrics:Prepared['metrics']={bassOverlap:null,otherOverlap:null,bassDifference:null,otherDifference:null,vocalSafe:!!controls.vocalExit,vocalBenefit:controls.vocalExit?(controls.vocalExit.tailEnd??0)/p.duration:0,definitions:{overlap:'125ms digital RMS and original gain balance; not a clash probability',difference:'Observed-window 32768-sample Hann FFT chroma cosine; not chord truth',renderStats:'Not rendered: device headroom protection remains required'}}
 for(const stem of ['bass','other'] as const)if(audio.a[stem]&&audio.b[stem]){
  metrics[`${stem}Overlap`]=stemOverlap(audio.a[stem],audio.b[stem])
  const profiles=['a','b'].map(side=>{const v=audio[side as 'a'|'b'][stem],n=audio.a.master.length,x=new Float32Array(n),l=v.getChannelData(0),r=v.getChannelData(1);if(v.length<n)throw Error('Incomplete stem PCM');for(let i=0;i<n;i++)x[i]=(l[i]+r[i])*.5;return sourceChroma(x,v.sampleRate)})
  metrics[`${stem}Difference`]=chromaDifference(profiles[0],profiles[1])
 }
 const methods={} as Prepared['decision']['methods'],bass=(metrics.bassOverlap??0)>=.25&&metrics.bassDifference!==null,other=(metrics.otherOverlap??0)>=.25&&metrics.otherDifference!==null,bg=28*(metrics.bassOverlap??0)+12*(metrics.bassDifference??0),fg=24*(metrics.otherOverlap??0)+8*(metrics.otherDifference??0)
 for(const [method,eligible,benefit,cost] of [['original',true,0,0],['bass',bass,bg,6],['filter',other,fg,4],['yield',other&&(metrics.otherOverlap??0)>=.45&&(metrics.otherDifference??0)>=.65,30*(metrics.otherOverlap??0)+14*(metrics.otherDifference??0),11],['vocal',metrics.vocalSafe&&metrics.vocalBenefit>=.2,30*metrics.vocalBenefit,6],['bass_filter',bass&&other&&bg+fg-12-Math.max(bg-6,fg-4)>=6,bg+fg,12]] as [Method,boolean,number,number][]){methods[method]={name:names[method],eligible,score:eligible?50+benefit-cost:null,reason:method==='original'?'保留原选点、EQ和人声规则的渐混后备':eligible?'Jetson 同源窗口指标满足暂定门槛':'缺少证据或未达到暂定门槛',processingCost:cost,levelPenalty:0}}
 const sorted=(Object.keys(methods) as Method[]).filter(m=>methods[m].eligible).sort((a,b)=>methods[b].score!-methods[a].score!),best=sorted[0],recommended=best!=='original'&&methods[best].score!-50>=4?best:'original'
 const decision:Prepared['decision']={recommended,explanation:methods[recommended].reason,methods,policy:{version:'device-source-execution-v1',maximumDuration:32,maximumRate:1.05,minimumRate:.95,renderedStats:false,localHeadroom:true},limitations:['指标是暂定声学代理，需试听校准','Jetson 判断，端侧执行与音量保护；未生成成品转场 WAV']}
 return{controls,metrics,decision}
}
