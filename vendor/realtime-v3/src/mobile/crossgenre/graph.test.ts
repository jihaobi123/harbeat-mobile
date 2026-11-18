import {it,expect} from 'vitest'
import {scheduleCrossGraph} from './graph'
import {planCrossGenre} from './planner'
import {fixture} from './fixtures'

class Param{value=0;events:any[]=[];setValueAtTime(v:number,t:number){this.events.push(['set',v,t])}linearRampToValueAtTime(v:number,t:number){this.events.push(['ramp',v,t])}cancelScheduledValues(t:number){this.events.push(['cancel',t])}cancelAndHoldAtTime(t:number){this.events.push(['hold',t])}}
class Node{gain=new Param();frequency=new Param();Q=new Param();delayTime=new Param();connections:Node[]=[];type='';disconnected=false;connect(n:Node){this.connections.push(n);return n}disconnect(n?:Node){if(n)this.connections=this.connections.filter(x=>x!==n);else{this.connections=[];this.disconnected=true}}}
function setup(echo=false){const a=fixture(),b=fixture('b',129.7);a.profile.exits[0].echoEligible=echo;const plan=planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)!,created:Node[]=[],ctx={currentTime:10,createGain:()=>{const n=new Node();created.push(n);return n},createDelay:()=>{const n=new Node();created.push(n);return n},createBiquadFilter:()=>{const n=new Node();created.push(n);return n}},tap=new Node(),aGain=new Param(),bGain=new Param(),output=new Node();return{plan,created,ctx,tap,aGain,bGain,output}}

it('cuts on the common clock and leaves B at native speed',()=>{
 const s=setup(),g=scheduleCrossGraph(s.ctx as any,s.tap as any,s.aGain as any,s.bGain as any,s.output as any,s.plan,14)
 expect(s.aGain.events).toContainEqual(['ramp',0,14]);expect(s.bGain.events).toContainEqual(['ramp',.76,14.004])
 expect(s.created).toHaveLength(0);expect(g.end).toBe(14.02)
})
it('echoes only the outgoing deck tap and bounds capture/tail on the sample clock',()=>{
 const s=setup(true),g=scheduleCrossGraph(s.ctx as any,s.tap as any,s.aGain as any,s.bGain as any,s.output as any,s.plan,14)
 expect(s.tap.connections).toHaveLength(1);expect(s.output.connections).toHaveLength(0)
 const delay=s.created.find(n=>n.delayTime.value>0)!;expect(delay.delayTime.value).toBeCloseTo(30/95)
 expect(s.created.some(n=>n.type==='highpass'&&n.frequency.value===600)).toBe(true)
 expect(s.created.some(n=>n.gain.events.some(e=>e[0]==='ramp'&&e[1]===0&&e[2]<=14.35))).toBe(true)
 g.dispose();expect(s.tap.connections).toHaveLength(0);expect(s.created.every(n=>n.disconnected)).toBe(true)
})
it('cancel restores A and clears scheduled gains without touching the existing output graph',()=>{
 const s=setup(true),g=scheduleCrossGraph(s.ctx as any,s.tap as any,s.aGain as any,s.bGain as any,s.output as any,s.plan,14)
 g.cancel();expect(s.aGain.events).toContainEqual(['ramp',.76,10.008]);expect(s.bGain.events).toContainEqual(['ramp',0,10.008])
 expect(s.output.disconnected).toBe(false);g.dispose();g.dispose()
})
it('rejects late scheduling and tampered effect controls before mutating audio',()=>{
 const s=setup(true);s.plan.echo!.feedback=.9
 expect(()=>scheduleCrossGraph(s.ctx as any,s.tap as any,s.aGain as any,s.bGain as any,s.output as any,s.plan,14)).toThrow()
 expect(s.created).toHaveLength(0);expect(s.aGain.events).toHaveLength(0)
})
