import {scheduleDeviceGraph} from './device-graph'
import type {DevicePrepared} from './device-execution'
import type {Method} from '../metric-upstream/metric-mix/types'
const output=document.querySelector('#result')!
document.querySelector('#run')!.addEventListener('click',async()=>{
 output.textContent='运行中'
 try{
  const sr=44100,d=8,frames=Math.round((d+.008)*sr),rows=[]
  for(const method of ['original','bass','yield','vocal','filter','bass_filter'] as Method[]){
   const context=new OfflineAudioContext(2,frames+128,sr)
   const make=(hz:number,level:number)=>{const b=context.createBuffer(2,frames,sr);for(let c=0;c<2;c++)for(let i=0;i<frames;i++)b.getChannelData(c)[i]=level*Math.sin(2*Math.PI*hz*i/sr);return b}
   const a={master:make(510,.11),bass:make(98,.07),other:make(440,.05),vocals:make(220,.04)},b={master:make(660,.12),bass:make(110,.065),vocals:make(330,.04)}
   // Include a residual master component: rebuilding from stems would fail.
   for(let c=0;c<2;c++)for(let i=0;i<frames;i++){a.master.getChannelData(c)[i]+=a.bass.getChannelData(c)[i]+a.other.getChannelData(c)[i]+a.vocals.getChannelData(c)[i];b.master.getChannelData(c)[i]+=b.bass.getChannelData(c)[i]+b.vocals.getChannelData(c)[i]}
   const result={execution:{plan:{start:10,duration:d,restore:17.5},controls:{duration:d,lastBarStart:4,bassTiming:{duckStart:0,swapStart:3,swapEnd:4},vocalExit:{fadeStart:2,fadeEnd:2.2}}}} as unknown as DevicePrepared
   scheduleDeviceGraph(context as unknown as AudioContext,context.destination,result,method,{a,b},0)
   const rendered=await context.startRendering(),actual=rendered.getChannelData(0)
   let filtered:Float32Array|undefined
   if(method==='filter'||method==='bass_filter'){
    const independent=new OfflineAudioContext(2,frames+128,sr),src=independent.createBufferSource(),hp=independent.createBiquadFilter();src.buffer=a.other;hp.type='highpass';hp.Q.value=Math.SQRT1_2;hp.frequency.setValueAtTime(20,0);hp.frequency.setValueAtTime(20,4);hp.frequency.exponentialRampToValueAtTime(1800,d);src.connect(hp);hp.connect(independent.destination);src.start();filtered=(await independent.startRendering()).getChannelData(0)
   }
   let max=0,energy=0
   for(let i=0;i<d*sr;i++){
    const t=i/sr,ga=1-t/d,gb=t/d,A=a.master.getChannelData(0)[i],B=b.master.getChannelData(0)[i]
    let expected=A*ga+B*gb
    if(method==='bass'||method==='bass_filter'){const ba=t<3?1-t/6:t<4?.5*(4-t):0,bb=t<3?0:t<4?t-3:1;expected+=a.bass.getChannelData(0)[i]*(ba-ga)+b.bass.getChannelData(0)[i]*(bb-gb)}
    if(method==='yield')expected+=a.other.getChannelData(0)[i]*(Math.max(0,1-t/4)-ga)
    if(method==='vocal'){const va=t<2?1:t<2.2?(2.2-t)/.2:0,blend=t<=2.2?0:t>=2.28?1:(t-2.2)/.08;expected+=a.vocals.getChannelData(0)[i]*(va-ga)+b.vocals.getChannelData(0)[i]*(gb*blend-gb)}
    if(filtered)expected+=(filtered[i]-a.other.getChannelData(0)[i])*ga*Math.max(0,Math.min(1,(t-4)/.02))
    const error=actual[i]-expected*.6;max=Math.max(max,Math.abs(error));energy+=error*error
   }
   rows.push({method,maxAbsoluteError:max,rmsError:Math.sqrt(energy/(d*sr)),tailLastSample:actual[frames-1],pass:max<.0002})
  }
  const worker=await new Promise<{pass:boolean;frames:number}>((resolve,reject)=>{const w=new Worker(new URL('./stretch-worker.ts',import.meta.url),{type:'module'}),n=24000,x=new Float32Array(n*2),y=new Float32Array(n*2);for(let i=0;i<n;i++)x[2*i]=x[2*i+1]=Math.sin(2*Math.PI*220*i/8000)*.2;for(let i=0;i<x.length;i++)y[i]=x[i]*.25;w.onerror=error=>{w.terminate();reject(error)};w.onmessage=({data})=>{w.terminate();if(data.error){reject(Error(data.error));return}const max=data.output.master.reduce((m:number,v:number,i:number)=>Math.max(m,Math.abs(data.output.bass[i]-v*.25)),0);resolve({pass:max<1e-6&&data.output.master.length===32000,frames:data.output.master.length/2})};w.postMessage({input:{master:x,bass:y},sampleRate:8000,rate:1.04,frames:16000})})
  output.textContent=JSON.stringify({schema:'harbeat.device-audio-check.v1',sampleRate:sr,engine:'browser OfflineAudioContext exercises production live graph; source worker loaded by browser',rows,worker,pass:rows.every(r=>r.pass)&&worker.pass},null,2)
 }catch(error){output.textContent=JSON.stringify({pass:false,error:String(error)})}
})
