import {scheduleDeviceGraph} from '../src/mobile/device-graph'
import {planLoopRamp,scheduleLoopRamp,bridgeFingerprint,type BridgeMaterial} from '../src/mobile/crossgenre/bridge'
import type {Method} from '../src/metric-upstream/metric-mix/types'
const SR=44100
const output=async(name:string,body:BodyInit)=>{const r=await fetch('/qa-output/'+name,{method:'POST',body});if(!r.ok)throw Error('Output write failed')}
function wav(b:AudioBuffer){const raw=new ArrayBuffer(44+b.length*4),v=new DataView(raw),txt=(i:number,s:string)=>[...s].forEach((c,n)=>v.setUint8(i+n,c.charCodeAt(0)));txt(0,'RIFF');v.setUint32(4,raw.byteLength-8,true);txt(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,SR,true);v.setUint32(28,SR*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);txt(36,'data');v.setUint32(40,b.length*4,true);for(let i=0;i<b.length;i++)for(let c=0;c<2;c++)v.setInt16(44+4*i+2*c,Math.round(Math.max(-1,Math.min(1,b.getChannelData(c)[i]))*32767),true);return raw}
const peak=(x:Float32Array)=>x.reduce((p,v)=>Math.max(p,Math.abs(v)),0)
async function stem(method:Method){
 const at=1,d=2,end=at+d,ctx=new OfflineAudioContext(2,SR*4,SR),entry=ctx.createGain();entry.gain.value=.76/.60;entry.connect(ctx.destination)
 const tone=(seconds:number,offset:number,side:number,component='master')=>{const b=ctx.createBuffer(2,Math.round(SR*seconds),SR);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++){const t=i/SR+offset,bass=.05*Math.sin(2*Math.PI*(side?83:73)*t),other=.04*Math.sin(2*Math.PI*(side?337:293)*t),vocals=.03*Math.sin(2*Math.PI*(side?569:521)*t);b.getChannelData(c)[i]=component==='bass'?bass:component==='other'?other:component==='vocals'?vocals:bass+other+vocals}return b}
 const ag=ctx.createGain(),bg=ctx.createGain(),as=ctx.createBufferSource(),bs=ctx.createBufferSource();ag.gain.value=.76;bg.gain.value=0;ag.connect(ctx.destination);bg.connect(ctx.destination);as.buffer=tone(4,-at,0);bs.buffer=tone(1, d,1);as.connect(ag);bs.connect(bg);as.start(0);bs.start(end);ag.gain.setValueAtTime(.76,at);ag.gain.linearRampToValueAtTime(0,at+.004);bg.gain.setValueAtTime(0,end);bg.gain.linearRampToValueAtTime(.76,end+.008)
 const pcm={a:Object.fromEntries(['master','bass','other','vocals'].map(k=>[k,tone(d+.008,0,0,k)])),b:Object.fromEntries(['master','bass','other','vocals'].map(k=>[k,tone(d+.008,0,1,k)]))}
 const result:any={execution:{plan:{duration:d,start:10,restore:11.5},controls:{duration:d,lastBarStart:1.5,bassTiming:{duckStart:.8,swapStart:1.2,swapEnd:1.5},vocalExit:{fadeStart:1,fadeEnd:1.5}}}}
 const g=scheduleDeviceGraph(ctx as any,entry,result,method,pcm,at);g.entry.gain.setValueAtTime(0,at);g.entry.gain.linearRampToValueAtTime(1,at+.004)
 const rendered=await ctx.startRendering(),x=rendered.getChannelData(0);let jump=0,error=0
 for(const t of [at,end,end+.008])for(let i=Math.round((t-.001)*SR);i<Math.round((t+.001)*SR);i++)jump=Math.max(jump,Math.abs(x[i]-x[i-1]))
 const reference=tone(1,d,1).getChannelData(0);for(let i=0;i<SR*.025;i++)error=Math.max(error,Math.abs(x[Math.round(end*SR)+i]-.76*reference[i]))
 return{method,peak:peak(x),boundaryMaxSampleStep:jump,takeoverError:error,pass:peak(x)<.98&&jump<.025&&error<1e-5,basis:'synthetic signed master/stems, product scheduleDeviceGraph, complementary 4/8 ms, pre-limiter; no subjective score'}
}
async function run(){
 const status=document.querySelector('#status')!;status.textContent='正在渲染分轨边界…'
 const methods=[];for(const method of ['original','bass','filter','yield','vocal','bass_filter'] as Method[])methods.push(await stem(method))
 await output('stem-audio-check.json',JSON.stringify({pass:methods.every(m=>m.pass),methods},null,2))
 const library=await fetch('/audition/bridge-materials.json').then(r=>r.json()),samples=[]
 for(const material of library.materials as BridgeMaterial[]){
  const decoder=new OfflineAudioContext(2,1,SR),raw=await fetch('/audition/'+material.asset.url).then(r=>r.arrayBuffer())
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==material.asset.sha256)throw Error('Bridge asset changed')
  const buffer=await decoder.decodeAudioData(raw),fingerprint=await bridgeFingerprint(material)
  for(const ramp of [false,true]){
   const p=planLoopRamp(material,material.bpm*(ramp?.9:1),material.bpm*(ramp?1.1:1),2),ctx=new OfflineAudioContext(2,Math.ceil((p.duration+.3)*SR),SR)
   scheduleLoopRamp(ctx,ctx.destination,buffer,material,p,.1);const audio=await ctx.startRendering(),file=material.id+(ramp?'-ramp':'-loop')+'.wav',max=peak(audio.getChannelData(0))
   if(max>=.98)throw Error('Bridge clips');await output(file,wav(audio));samples.push({materialId:material.id,fingerprint,file,plan:p,peak:max,humanReview:'pending',subjectiveListening:'unscored',automaticEligible:false})
  }
 }
 await output('bridge-experiments.json',JSON.stringify({schema:'harbeat.bridge-experiments.v1',scope:'audition-only',samples},null,2));status.textContent=JSON.stringify({methods,samples},null,2)
 for(const s of samples){const p=document.createElement('p');p.textContent=s.file;const a=document.createElement('audio');a.controls=true;a.src='/audition/'+s.file;p.append(a);document.querySelector('#samples')!.append(p)}
}
document.querySelector('#run')!.addEventListener('click',()=>void run().catch(e=>document.querySelector('#status')!.textContent=String(e)))
