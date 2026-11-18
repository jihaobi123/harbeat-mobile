import {it,expect,vi} from 'vitest'
import {scheduleDeviceGraph} from './device-graph'
it('stops and disconnects every allocated node when a later graph connection fails',()=>{
 const nodes:any[]=[],param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){}})
 const node=()=>{const n:any={gain:param(),frequency:param(),Q:param(),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};nodes.push(n);return n}
 const ctx:any={currentTime:0,createGain:node,createBufferSource:node,createBiquadFilter:()=>{const n=node();n.connect.mockImplementation(()=>{throw Error('injected filter connection failure')});return n}}
 const result:any={execution:{plan:{duration:8,start:10,restore:17},controls:{duration:8,lastBarStart:6}}}
 expect(()=>scheduleDeviceGraph(ctx,node(),result,'original',{a:{master:{} as any},b:{master:{} as any}},1)).toThrow('injected')
 expect(nodes.slice(1).every(n=>n.disconnect.mock.calls.length===1)).toBe(true)
 expect(nodes.some(n=>n.start.mock.calls.length&&n.stop.mock.calls.length)).toBe(true)
})
it('plays eight independent Jetson stem buses without residual master vocals and rejects missing PCM',async()=>{
 const {timelineFixture}=await import('./stem-timeline-fixture'),f=await timelineFixture(),events:any[]=[],nodes:any[]=[],buffers:any[]=[],param=()=>({value:0,cancelScheduledValues(){},setValueAtTime(v:number,t:number){events.push(['set',v,t])},linearRampToValueAtTime(v:number,t:number){events.push(['ramp',v,t])}})
 const node=()=>{const n:any={gain:param(),frequency:param(),Q:param(),connect(){},disconnect(){},start(){},stop(){}};nodes.push(n);return n}
 const ctx:any={currentTime:0,createGain:node,createBufferSource:()=>{const n=node();Object.defineProperty(n,'buffer',{set:v=>buffers.push(v)});return n},createBiquadFilter:node},result:any={execution:{plan:f.p,controls:f.result.controls,arrangement:f.arrangement}}
 scheduleDeviceGraph(ctx,node(),result,'stem-handover' as any,f.pcm as any,10)
 const drumEnd=f.arrangement.timeline!.b.drums[2][0],expected=.60
 expect(events.some(([kind,v,t])=>kind==='ramp'&&t===10+drumEnd&&Math.abs(v-expected)<1e-9)).toBe(true)
 expect(buffers.length).toBe(8);expect(buffers).not.toContain(f.pcm.a.master);expect(buffers).toContain(f.pcm.b.drums)
 const bad:any={a:{...f.pcm.a},b:{...f.pcm.b}};delete bad.b.drums
 expect(()=>scheduleDeviceGraph(ctx,node(),result,'stem-handover' as any,bad,10)).toThrow()
})
it('executes the Jetson common deck gain on the independent stem buses',async()=>{
 const {timelineFixture}=await import('./stem-timeline-fixture'),f=await timelineFixture(),values:number[]=[],param=()=>({value:0,cancelScheduledValues(){},setValueAtTime(v:number){values.push(v)},linearRampToValueAtTime(v:number){values.push(v)}}),node=()=>({gain:param(),frequency:param(),Q:param(),connect(){},disconnect(){},start(){},stop(){}})
 const ctx:any={currentTime:0,createGain:node,createBiquadFilter:node,createBufferSource:node},arrangement={...f.arrangement,sourceGains:{a:1.18,b:1.17}},result:any={execution:{plan:f.p,controls:f.result.controls,arrangement}}
 scheduleDeviceGraph(ctx,node() as any,result,'stem-handover',f.pcm as any,10)
 expect(values.some(x=>Math.abs(x-.60*1.18)<1e-9)).toBe(true);expect(values.some(x=>Math.abs(x-.60*1.17)<1e-9)).toBe(true)
 arrangement.sourceGains.b=3;expect(()=>scheduleDeviceGraph(ctx,node() as any,result,'stem-handover',f.pcm as any,10)).toThrow()
})
