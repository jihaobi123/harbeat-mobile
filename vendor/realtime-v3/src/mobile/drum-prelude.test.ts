import {expect,it} from 'vitest'
import {drumPreludeCorrection,validateDrumPreludeApproval,valueAt,type DrumPreludeApproval} from './device-execution'

const sha='a'.repeat(64)
const result:any={id:sha,plan:{from:'a',to:'b',start:40,end:48,duration:8,rate:1,bStart:20,bEnd:28},execution:{plan:{start:40,end:48,duration:8,rate:1,restore:46,window:{start:20,end:28}},controls:{duration:8,lastBarStart:4,bassTiming:{duckStart:0,swapStart:3,swapEnd:4}},sourceFingerprints:{a:{masterSha256:sha},b:{masterSha256:sha}}}}
const buffer=(duration:number)=>({duration,sampleRate:44100,length:Math.round(duration*44100),numberOfChannels:2})
const pcm:any={a:{master:buffer(14)},b:{master:buffer(14.008),drums:buffer(14.008)},body:buffer(8)}
const approval=():DrumPreludeApproval=>({schema:'harbeat.drum-prelude.v1',scope:'audition-only',authority:'jetson',approved:true,planId:sha,proofSha256:sha,sourceFingerprints:result.execution.sourceFingerprints,preparedAssets:{a:{master:{sha256:sha,bytes:100,duration:14}},b:{master:{sha256:sha,bytes:100,duration:14.008},drums:{sha256:sha,bytes:100,duration:14.008}}},takeoverAsset:{sha256:sha,bytes:100,duration:8,sourceStart:28},leadSeconds:6,fadeInSeconds:2,holdSeconds:4,maxGain:.25,sourceWindow:{aStart:34,aEnd:48,bStart:14,bEnd:28,rate:1},checks:{sourceAligned:true,beatAligned:true,vocalSafe:true,drumCompatible:true,headroomSafe:true}})
it('keeps B drums at one quarter through the prelude and continuously joins the original B gain',()=>{
 const points=drumPreludeCorrection(approval(),8)
 expect(valueAt(points,0)).toBe(0);expect(valueAt(points,1)).toBeCloseTo(.125)
 expect(valueAt(points,2)).toBe(.25);expect(valueAt(points,5.99)).toBe(.25)
 for(const t of [0,.01,1,2,4,8])expect(valueAt(points,6+t)+t/8).toBeCloseTo(Math.max(.25,t/8))
 expect(valueAt(points,14)).toBe(0)
})
it('requires Jetson source-bound approval and refuses overlong, gapped or over-budget PCM',()=>{
 expect(validateDrumPreludeApproval(approval(),result,pcm).leadSeconds).toBe(6)
 for(const mutate of [(a:any)=>a.approved=false,(a:any)=>a.authority='device',(a:any)=>a.sourceFingerprints.a={masterSha256:'b'.repeat(64)},(a:any)=>a.planId='b'.repeat(64),(a:any)=>a.checks.drumCompatible=null,(a:any)=>a.holdSeconds=3,(a:any)=>a.maxGain=.5,(a:any)=>a.sourceWindow.bStart=15]){
  const a=structuredClone(approval());mutate(a);expect(()=>validateDrumPreludeApproval(a,result,pcm)).toThrow()
 }
 expect(()=>validateDrumPreludeApproval({...approval(),leadSeconds:18,fadeInSeconds:6,holdSeconds:12},result,pcm)).toThrow()
 expect(()=>validateDrumPreludeApproval(approval(),result,{...pcm,b:{...pcm.b,drums:buffer(5)}})).toThrow()
 const huge:any={a:{master:{...buffer(14),length:16*1024*1024}},b:pcm.b}
 expect(()=>validateDrumPreludeApproval(approval(),result,huge)).toThrow()
})
