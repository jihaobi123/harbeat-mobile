import {expect,it} from 'vitest'
import {scheduleDeviceGraph} from './device-graph'
import {scheduleDrumPreludeAudition} from './drum-prelude-audition'
const sha='a'.repeat(64)
function fixture(){
 const sources:any[]=[],gains:any[]=[]
 const param=()=>({events:[] as any[],value:0,cancelScheduledValues(t:number){this.events.push(['cancel',t])},setValueAtTime(v:number,t:number){this.events.push(['set',v,t])},linearRampToValueAtTime(v:number,t:number){this.events.push(['ramp',v,t])},exponentialRampToValueAtTime(v:number,t:number){this.events.push(['exp',v,t])}})
 const node=()=>({connect:()=>{},disconnect:()=>{}})
 const ctx:any={currentTime:0,createGain:()=>{const n={...node(),gain:param()};gains.push(n);return n},createBiquadFilter:()=>({...node(),frequency:param(),gain:param(),Q:param()}),createBufferSource:()=>{const n={...node(),start(...args:any[]){n.calls.push(args)},calls:[] as any[]};sources.push(n);return n}}
 const buffer=(duration:number)=>({duration,sampleRate:44100,length:Math.round(duration*44100),numberOfChannels:2})
 const pcm:any={a:{master:buffer(14)},b:{master:buffer(14.008),drums:buffer(14.008)},body:buffer(8)}
 const controls={duration:8,lastBarStart:4,bassTiming:{duckStart:0,swapStart:3,swapEnd:4}}
 const p={duration:8,start:40,end:48,rate:1,restore:46,window:{start:20,end:28}}
 const result:any={id:sha,execution:{plan:p,controls,sourceFingerprints:{a:{id:'a'},b:{id:'b'}}}}
 const approval:any={schema:'harbeat.drum-prelude.v1',scope:'audition-only',authority:'jetson',approved:true,planId:sha,proofSha256:sha,sourceFingerprints:result.execution.sourceFingerprints,preparedAssets:{a:{master:{sha256:sha,bytes:100,duration:14}},b:{master:{sha256:sha,bytes:100,duration:14.008},drums:{sha256:sha,bytes:100,duration:14.008}}},takeoverAsset:{sha256:sha,bytes:100,duration:8,sourceStart:28},leadSeconds:6,fadeInSeconds:2,holdSeconds:4,maxGain:.25,sourceWindow:{aStart:34,aEnd:48,bStart:14,bEnd:28,rate:1},checks:{sourceAligned:true,beatAligned:true,vocalSafe:true,drumCompatible:true,headroomSafe:true}}
 return{ctx,pcm,result,approval,sources,gains}
}
it('starts one shared mapped source window and adds only a continuous approved drum layer',()=>{
 const f=fixture()
 scheduleDeviceGraph(f.ctx,{} as AudioNode,f.result,'original',f.pcm,16,{prelude:{approval:f.approval,enabled:true}})
 expect(f.sources).toHaveLength(3);expect(f.sources.every(s=>s.calls[0][0]===10)).toBe(true)
 const extra=f.gains.find(g=>g.gain.events.some((e:any)=>e[0]==='ramp'&&e[1]===.15&&e[2]===12))
 expect(extra).toBeDefined();expect(extra.gain.events).toContainEqual(['ramp',.15,16]);expect(extra.gain.events).toContainEqual(['ramp',0,18])
})
it('keeps the same prelude mapping for reference variants without adding B drums',()=>{
 const f=fixture()
 scheduleDeviceGraph(f.ctx,{} as AudioNode,f.result,'original',f.pcm,16,{prelude:{approval:f.approval,enabled:false}})
 expect(f.sources).toHaveLength(2);expect(f.sources.every(s=>s.calls[0][0]===10)).toBe(true)
 expect(f.gains.some(g=>g.gain.events.some((e:any)=>e[0]==='set'&&e[1]===.60&&e[2]===10))).toBe(true)
 expect(f.gains.some(g=>g.gain.events.some((e:any)=>e[0]==='set'&&e[1]===0&&e[2]===10))).toBe(true)
})
it('schedules the identical native B body at the frozen main endpoint with an eight-millisecond join',()=>{
 for(const enabled of [false,true]){const f=fixture();f.result.execution.schema='harbeat.device-execution-plan.v1';f.result.decision={methods:{original:{eligible:true}}}
  scheduleDrumPreludeAudition(f.ctx,{} as AudioNode,f.result,'original',f.pcm,10,f.approval,enabled)
  expect(f.sources.at(-1).buffer).toBe(f.pcm.body);expect(f.sources.at(-1).calls).toEqual([[24,0,8]])
  expect(f.gains.at(-1).gain.events).toEqual([['set',0,24],['ramp',.6,24.008],['set',.6,31.75],['ramp',0,32]])
 }
})
