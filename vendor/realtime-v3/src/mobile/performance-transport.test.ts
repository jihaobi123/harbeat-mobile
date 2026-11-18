import {it,expect,vi,afterEach} from 'vitest'
import {MetricTransport} from './device-transport'
vi.mock('./reservation-cache',()=>({ReservationAudioCache:class{protected=new Set();sizeMB=0;buffers=new Map();load=vi.fn(async(asset:any)=>this.buffers.get(asset.url)||{});dispose=vi.fn()}}))
const param=()=>({value:1,cancelAndHoldAtTime:vi.fn(),cancelScheduledValues:vi.fn(),setTargetAtTime:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()})
const node=()=>({gain:param(),frequency:param(),Q:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()})
function fixture(){
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 class Context extends EventTarget{currentTime=0;state='suspended';sampleRate=8000;destination=node();audioWorklet={addModule:async()=>{}};createGain=node;createBiquadFilter=node;createDynamicsCompressor=node;createBufferSource=node;createBuffer=(n:number,length:number,sr:number)=>{const data=Array.from({length:n},()=>new Float32Array(length));return{duration:length/sr,length,sampleRate:sr,numberOfChannels:n,getChannelData:(c:number)=>data[c]}};resume=async()=>{this.state='running'};suspend=async()=>{this.state='suspended'};close=async()=>{this.state='closed'}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',class{port={postMessage:vi.fn(),onmessage:null};connect=vi.fn();disconnect=vi.fn()})
 const p=new MetricTransport(new URL('https://example.test/'),()=>{}),sha='a'.repeat(64),pcm=new Float32Array(8000*8).map((_,i)=>.4*Math.sin(i*.1))
 ;(p.cache as any).buffers.set('a',{sampleRate:8000,numberOfChannels:2,length:pcm.length,getChannelData:()=>pcm})
 const track:any={id:'a',title:'a',duration:80,bpm:120,native:{url:'a',duration:80},provenance:{masterSha256:sha},alignment:{source:{masterSha256:sha},bandFrames:Array.from({length:160},(_,i)=>({start:i*.05,end:(i+1)*.05,low:-25,mid:i%4===0?-15:-45,high:-30})),bars:Array.from({length:40},(_,i)=>({valid:true,start:i*2,end:i*2+2,beats:[0,.5,1,1.5].map(t=>t+i*2)}))}}
 return{p,track}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('runs effects on cached source while the song clock continues, then cancels cleanly on pause',async()=>{
 const {p,track}=fixture();await p.start(track);(p.ctx as any).currentTime=1
 const position=p.position;p.setMC(true);expect(p.performance.mc).toBe(true);expect(p.performance.canScratch).toBe(true)
 p.scratch();expect(p.performance.scratching).toBe(true);expect(p.performance.mc).toBe(false);expect(p.position).toBe(position)
 expect(p.logs.at(-1)).toMatchObject({kind:'scratch_response',plan:{version:'baby-scratch-v2',evidence:'measured-half-beats'}})
 expect(()=>p.scratch()).toThrow();p.pause();expect(p.performance.scratching).toBe(false);expect(p.performance.canScratch).toBe(false)
 await p.resume();expect(p.performance.canScratch).toBe(true);p.stop();expect(p.performance.mc).toBe(false);p.dispose()
})
it('keeps missing data observable and refuses a response that would cross a committed mix cue',async()=>{
 const {p,track}=fixture();await p.start(track);(p.ctx as any).currentTime=1
 ;(p as any).transition={at:1.3};expect(p.performance.canScratch).toBe(false);expect(p.performance.scratchReason).toContain('交接')
 ;(p as any).transition=null;(p.cache as any).buffers.clear();expect(p.performance.canScratch).toBe(false);expect(p.performance.scratchReason).toContain('缓存')
 p.dispose()
})
