import {it,expect,vi} from 'vitest'
import {PerformanceEffects} from './performance-effects'
function fixture(){
 const param=(value=1)=>({value,events:[] as any[],cancelAndHoldAtTime(t:number){this.events.push(['hold',t])},cancelScheduledValues:vi.fn(),setValueAtTime(v:number,t:number){this.events.push(['set',v,t])},linearRampToValueAtTime(v:number,t:number){this.events.push(['ramp',v,t])}})
 const gains:any[]=[],filters:any[]=[],sources:any[]=[],node=()=>({connect:vi.fn(),disconnect:vi.fn()})
 const ctx:any={currentTime:1,createGain:()=>{const n={...node(),gain:param()};gains.push(n);return n},createBiquadFilter:()=>{const n={...node(),frequency:param(),Q:param()};filters.push(n);return n},createBufferSource:()=>{const n={...node(),start:vi.fn(),stop:vi.fn()};sources.push(n);return n}}
 const output:any=node(),fx=new PerformanceEffects(ctx,output)
 return{fx,ctx,output,gains,filters,sources}
}
it('keeps the original lowpass host mode after the mix without touching a deck or volume',()=>{
 const {fx,filters,gains}=fixture();fx.setMC(true)
 expect(fx.mc).toBe(true);expect(filters.map(f=>[f.type,f.frequency.value,f.Q.value])).toEqual([['lowpass',320,-3.0103],['lowpass',320,-3.0103]])
 expect(gains[1].gain.events.at(-1)).toEqual(['ramp',0,1.45]);expect(gains[2].gain.events.at(-1)).toEqual(['ramp',1,1.45])
 fx.setMC(false);expect(gains[1].gain.events.at(-1)).toEqual(['ramp',1,1.45]);expect(gains[2].gain.events.at(-1)).toEqual(['ramp',0,1.45])
})
it('schedules scratch and backing restoration on the audio clock, rejecting double taps',()=>{
 const {fx,ctx,gains,sources}=fixture(),clip:any={duration:1}
 fx.setMC(true);expect(fx.scratch(clip,1.5)).toBe(true);expect(fx.mc).toBe(false)
 expect(fx.scratching).toBe(true);expect(fx.scratch(clip,1.5)).toBe(false)
 expect(sources[0].start).toHaveBeenCalledWith(1.5)
 expect(gains[0].gain.events.slice(-3)).toEqual([['ramp',0,1.5],['set',0,2.492],['ramp',1,2.5]])
 expect(gains[3].gain.value).toBe(.6)
 ctx.currentTime=2.51;expect(fx.scratching).toBe(false)
})
it('pause cancellation stops a scheduled clip and removes every future backing ramp',()=>{
 const {fx,ctx,gains,sources}=fixture();fx.scratch({duration:1} as any,1.5);fx.cancelScratch(true)
 expect(fx.scratching).toBe(false);expect(sources[0].stop).toHaveBeenCalledWith(ctx.currentTime)
 expect(gains[0].gain.events.at(-1)).toEqual(['ramp',1,ctx.currentTime]);fx.reset();expect(fx.mc).toBe(false)
})
