import {it,expect} from 'vitest'
import {fixture} from '../crossgenre/fixtures'
import {enumerateCrossGenre} from '../crossgenre/planner'
import {exitEffectPlans} from './exit-plans'
import {scheduleNativeGraph} from './native-graph'
import {exitAudioKey} from './exit-audio'
class Param{events:any[]=[];setValueAtTime(v:number,t:number){this.events.push(['set',v,t])}linearRampToValueAtTime(v:number,t:number){this.events.push(['ramp',v,t])}cancelAndHoldAtTime(t:number){this.events.push(['hold',t])}}
class Node{gain=new Param();connections:Node[]=[];starts:number[]=[];stops:number[]=[];buffer:any;connect(n:Node){this.connections.push(n)}disconnect(){this.connections=[]}start(t:number){this.starts.push(t)}stop(t:number){this.stops.push(t)}}
function setup(){const a=fixture('a',100),b=fixture('b',140);a.track.sections=[{start:0,end:32,label:'verse'}];b.track.sections=[{start:16,end:120,label:'chorus'}]
 const cut=enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,30)[0],plans=exitEffectPlans(cut,a.track,b.track),created:Node[]=[],ctx:any={currentTime:10,sampleRate:8000,createBufferSource:()=>{const n=new Node();created.push(n);return n},createGain:()=>{const n=new Node();created.push(n);return n}}
 const tap=new Node(),output=new Node(),ag=new Param(),bg=new Param(),buffer={sampleRate:8000,length:28400,duration:3.55,numberOfChannels:2}
 return{plans,created,ctx,tap,output,ag,bg,buffer}
}
it('schedules each finite A replacement and native B, then cancels without sending B through effects',()=>{
 for(let i=0;i<4;i++){const s=setup(),p=s.plans[i],ready:any={key:exitAudioKey(p),buffer:s.buffer,peakBound:.6,proof:{algorithm:'phone-exit-v1'}}
  const g=scheduleNativeGraph(s.ctx,s.tap as any,s.ag as any,s.bg as any,s.output as any,p,16,undefined,ready)
  expect(s.created[0].starts).toEqual([13]);expect(s.created[0].stops).toEqual([16.55]);expect(g.end).toBe(16.57);expect(s.tap.connections).toHaveLength(0)
  expect(s.ag.events).toContainEqual(['ramp',0,13.004]);expect(s.bg.events).toContainEqual(['ramp',.76,16.004]);g.cancel()
  expect(s.ag.events).toContainEqual(['ramp',.76,10.008]);expect(s.bg.events).toContainEqual(['ramp',0,10.008]);g.dispose();expect(s.created.every(n=>!n.connections.length)).toBe(true)
 }
})
it('rejects missing or stale phone PCM before mutating A or creating effect nodes',()=>{
 const s=setup(),p=s.plans[0]
 expect(()=>scheduleNativeGraph(s.ctx,s.tap as any,s.ag as any,s.bg as any,s.output as any,p,16)).toThrow()
 const ready:any={key:exitAudioKey(p),buffer:s.buffer,peakBound:.6,proof:{algorithm:'phone-exit-v1'}}
 expect(()=>scheduleNativeGraph(s.ctx,s.tap as any,s.ag as any,s.bg as any,s.output as any,{...p,entry:18},16,undefined,ready)).toThrow()
 expect(s.created).toHaveLength(0);expect(s.ag.events).toHaveLength(0)
})
