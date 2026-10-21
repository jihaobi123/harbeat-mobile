import {drumPreludeCorrection,valueAt,type DevicePrepared,type DrumPreludeApproval} from './device-execution'
import type {Method} from '../metric-upstream/metric-mix/types'
import {scheduleDrumPreludeAudition,type DrumAuditionPCM} from './drum-prelude-audition'
async function render(method:Method,enabled:boolean){
 const sr=44100,total=14.008,ctx=new OfflineAudioContext(2,Math.ceil(22.01*sr),sr),buffer=(seconds:number,value:number)=>{const pcm=ctx.createBuffer(2,Math.round(seconds*sr),sr);for(let c=0;c<2;c++)pcm.getChannelData(c).fill(value);return pcm}
 const sha='a'.repeat(64),plan:any={id:sha,from:'a',to:'b',start:40,end:48,duration:8,rate:1,restore:46,window:{id:'w',start:20,end:28}},controls={duration:8,lastBarStart:4,bassTiming:{duckStart:0,swapStart:3,swapEnd:4}}
 const result={id:sha,decision:{methods:{original:{eligible:true},bass:{eligible:true}}},execution:{schema:'harbeat.device-execution-plan.v1',plan,controls,sourceFingerprints:{a:{id:'a'},b:{id:'b'}}}} as unknown as DevicePrepared
 const approval:DrumPreludeApproval={schema:'harbeat.drum-prelude.v1',scope:'audition-only',authority:'jetson',approved:true,planId:sha,proofSha256:sha,sourceFingerprints:result.execution.sourceFingerprints,preparedAssets:{a:{master:{sha256:sha,bytes:100,duration:14},bass:{sha256:sha,bytes:100,duration:14}},b:{master:{sha256:sha,bytes:100,duration:total},bass:{sha256:sha,bytes:100,duration:total},drums:{sha256:sha,bytes:100,duration:total}}},takeoverAsset:{sha256:sha,bytes:100,duration:8,sourceStart:28},leadSeconds:6,fadeInSeconds:2,holdSeconds:4,maxGain:.25,sourceWindow:{aStart:34,aEnd:48,bStart:14,bEnd:28,rate:1},checks:{sourceAligned:true,beatAligned:true,vocalSafe:true,drumCompatible:true,headroomSafe:true}}
 const pcm:DrumAuditionPCM={a:{master:buffer(14,.1),bass:buffer(14,.03)},b:{master:buffer(total,.2),bass:buffer(total,.04),drums:buffer(total,.08)},body:buffer(8,.2)}
 scheduleDrumPreludeAudition(ctx as unknown as AudioContext,ctx.destination,result,method,pcm,0,approval,enabled)
 return{output:await ctx.startRendering(),approval}
}
document.querySelector('#run')?.addEventListener('click',()=>{void(async()=>{
 const target=document.querySelector('#result')!;target.textContent='正在使用浏览器 OfflineAudioContext 渲染…'
 try{
  const checks:any[]=[]
  for(const method of ['original','bass'] as const){const plain=await render(method,false),extra=await render(method,true),points=drumPreludeCorrection(extra.approval,8);let error=0,boundaryJump=0,takeoverDeviation=0
   for(let c=0;c<2;c++){const a=plain.output.getChannelData(c),b=extra.output.getChannelData(c);for(let i=32;i<14*44100;i++){const expected=.08*.60*valueAt(points,i/44100);error=Math.max(error,Math.abs(b[i]-a[i]-expected))}const n=6*44100;boundaryJump=Math.max(boundaryJump,Math.abs((b[n+1]-a[n+1])-(b[n-1]-a[n-1])));for(let i=14*44100;i<14.02*44100;i++)takeoverDeviation=Math.max(takeoverDeviation,Math.abs(a[i]-.12),Math.abs(b[i]-.12))}
   checks.push({method,maxSignedCorrectionError:error,mainCueBoundaryJump:boundaryJump,nativeBodyTakeoverAmplitudeError:takeoverDeviation,pass:error<1e-6&&boundaryJump<1e-5&&takeoverDeviation<1e-6})
  }
  target.textContent=JSON.stringify({pass:checks.every(c=>c.pass),checks,scope:'Synthetic numerical execution only; not real music approval or listening preference.'},null,2)
 }catch(error){target.textContent=String(error)}
 })()})
