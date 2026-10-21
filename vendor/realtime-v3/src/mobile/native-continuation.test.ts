import {it,expect,vi,afterEach} from 'vitest'
import {MetricTransport} from './device-transport'
vi.mock('./reservation-cache',()=>({ReservationAudioCache:class{protected=new Set();sizeMB=0;load=vi.fn(async()=>({}));dispose=vi.fn()}}))
const param=()=>({value:0,setTargetAtTime:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()})
const node=()=>({gain:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()})
function fixture(){
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 class Context extends EventTarget{currentTime=0;state='suspended';sampleRate=44100;destination=node();audioWorklet={addModule:async()=>{}};createGain=node;createDynamicsCompressor=node;createBufferSource=node;resume=async()=>{this.state='running'};suspend=async()=>{this.state='suspended'};close=async()=>{this.state='closed'}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',class{port={postMessage:vi.fn(),onmessage:null};connect=vi.fn();disconnect=vi.fn()})
 return new MetricTransport(new URL('https://example.test/'),()=>{})
}
const track=(id:string):any=>({id,title:id,duration:80,native:{url:id,duration:80}})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('five whole tracks share the exact end clock without the early end pause or DJ approval',async()=>{
 const p=fixture();await p.start(track('a'))
 for(const id of ['b','c','d','e']){
  await p.queueNativeNext(track(id),new AbortController().signal)
  const at=p.continuation!.at
  ;(p.ctx as any).currentTime=at-.02;(p as any).tick();expect(p.paused).toBe(false)
  ;(p.ctx as any).currentTime=at+.08;(p as any).tick();expect(p.current?.id).toBe(id);expect(p.position).toBeCloseTo(.08);expect(p.playing).toBe(true)
 }
 expect(p.logs.filter(x=>x.kind==='sequential_complete')).toHaveLength(4)
 expect(p.logs.some(x=>x.kind==='device_plan_scheduled'||x.kind==='pause')).toBe(false)
 expect(p.logs.filter(x=>x.kind==='sequential_complete').every(x=>x.mixed===false)).toBe(true);p.dispose()
})
it('a paused or aborted successor never restarts or replaces the current deck',async()=>{
 const p=fixture();await p.start(track('a'));const c=new AbortController();c.abort()
 await expect(p.queueNativeNext(track('b'),c.signal)).rejects.toMatchObject({name:'AbortError'})
 expect(p.continuation).toBeNull();await p.queueNativeNext(track('b'),new AbortController().signal)
 p.pause('audio-focus:-2');expect(p.playing).toBe(false);expect(p.current?.id).toBe('a')
 expect(p.logs.at(-1)).toMatchObject({kind:'pause',reason:'audio-focus:-2'});p.stop();expect(p.continuation).toBeNull();p.dispose()
})
