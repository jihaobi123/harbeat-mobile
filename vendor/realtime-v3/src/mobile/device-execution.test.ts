import {describe,it,expect,vi,afterEach} from 'vitest'
import {jointStretch} from './joint-stretch'
import {stemCurves,validateExecutionTrack} from './device-execution'
import {sourceChroma,chromaDifference} from './source-features'
import {pitchDifferences,assertDecodedCoverage,type DevicePCM} from './device-prepare'
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})

describe('device source preparation and execution',()=>{
 it('keeps pitch and applies one WSOLA mapping to every stem',()=>{
  const sr=8000,n=sr*3,master=new Float32Array(n*2),stem=new Float32Array(n*2)
  for(let i=0;i<n;i++)master[2*i]=master[2*i+1]=Math.sin(2*Math.PI*220*i/sr)*.3
  for(let i=0;i<master.length;i++)stem[i]=master[i]*.25
  const out=jointStretch({master,bass:stem},sr,1.04,sr*2)
  expect(out.master.length).toBe(sr*2*2)
  expect(Math.max(...out.master.map((x,i)=>Math.abs(out.bass[i]-x*.25)))).toBeLessThan(1e-6)
  const mono=out.master.filter((_,i)=>i%2===0),crossings=mono.slice(sr/2,sr*1.5).reduce((sum,v,i,a)=>sum+(i>0&&v>=0&&a[i-1]<0?1:0),0)
  expect(crossings).toBeGreaterThan(217);expect(crossings).toBeLessThan(223)
 })
 it('represents bass replacement as signed corrections, preserving master residual',()=>{
  const curves=stemCurves('bass',{duration:8,lastBarStart:4,bassTiming:{duckStart:0,swapStart:3,swapEnd:4}})
  expect(curves.aBass.at(-1)?.[1]).toBe(0)
  expect(curves.bBass.at(-1)?.[1]).toBe(0)
  expect(curves.aBass.find(p=>p[0]===4)?.[1]).toBe(-.5)
  expect(curves.bBass.find(p=>p[0]===4)?.[1]).toBe(.5)
 })
 it('keeps different stems phase aligned, including antiphase residuals and source pulse timing',()=>{
  const sr=44100,n=sr*3,master=new Float32Array(n*2),bass=new Float32Array(n*2),other=new Float32Array(n*2)
  for(let i=0;i<n;i++){const pulse=i%Math.round(sr*.5)<300?.4:0;for(let c=0;c<2;c++){bass[2*i+c]=.15*Math.sin(2*Math.PI*98*i/sr)*(c?-.7:1);other[2*i+c]=pulse+.04*Math.sin(2*Math.PI*784*i/sr);master[2*i+c]=bass[2*i+c]+other[2*i+c]}}
  const out=jointStretch({master,bass,other},sr,.96,sr*2),error=out.master.reduce((max,x,i)=>Math.max(max,Math.abs(x-out.bass[i]-out.other[i])),0)
  expect(error).toBeLessThan(1e-6)
  const expected=.5/.96,from=Math.round((expected-.065)*sr),to=Math.round((expected+.065)*sr),actual=out.other.slice(from*2,to*2).reduce((max,x)=>Math.max(max,x),0)
  expect(actual).toBeGreaterThan(.3)
  expect(()=>jointStretch({master:master.slice(0,1000)},sr,1.04,sr)).toThrow('cover')
 })
 it('rejects manifest substitution, source gaps and arbitrary asset routes',()=>{
  const h='a'.repeat(64),t={id:'track-a',duration:16,provenance:{masterSha256:h,reportSha256:h,runId:'run-a'}} as any
  const value={schema:'harbeat.execution-track.v1',trackId:t.id,runId:'run-a',sourceSha256:h,reportSha256:h,manifestSha256:h,sampleRate:44100,channels:2,duration:16,frames:16*44100,sourceTimeOrigin:'master_audio_start',profile:{sha256:h,url:`/listen/execution/profiles/${h}.json`,bytes:100},stems:{bass:{sourceSha256:h,segments:[{start:0,end:16,startFrame:0,endFrame:16*44100,asset:{url:`/listen/execution-media/${h}.flac`,sha256:h,duration:16,bytes:1000,sampleRate:44100,channels:2,frames:16*44100}}]}}}
  expect(validateExecutionTrack(value,t).trackId).toBe(t.id)
  expect(()=>validateExecutionTrack({...value,sourceSha256:'b'.repeat(64)},t)).toThrow()
  expect(()=>validateExecutionTrack({...value,stems:{bass:{...value.stems.bass,segments:[{...value.stems.bass.segments[0],start:1}]}}},t)).toThrow()
  expect(()=>validateExecutionTrack({...value,stems:{bass:{...value.stems.bass,segments:[{...value.stems.bass.segments[0],asset:{...value.stems.bass.segments[0].asset,url:'https://evil.test/audio.wav'}}]}}},t)).toThrow()
 })
 it('matches a NumPy FFT golden profile from the existing backend feature definition',()=>{
  const sampleRate=44100,x=new Float32Array(65536)
  for(let i=0;i<x.length;i++){const t=i/sampleRate;x[i]=.1*Math.sin(2*Math.PI*98*t)+.2*Math.sin(2*Math.PI*440*t)+.05*Math.sin(2*Math.PI*1234*t)}
  // Generated independently using NumPy 2.0.2, metric_mix/features.py chroma.
  const expected=[2.232568938500161e-10,1.3798044433217068e-10,6.034504040327167e-10,.06052411790756669,1.1448055753217224e-8,8.231352515187038e-8,.000014902072347554567,.2420031802051564,.00007822205983043492,.9683859176905311,9.925566288163762e-9,5.997636699076873e-10]
  const actual=sourceChroma(x,sampleRate)!
  expect(Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])))).toBeLessThan(1e-6)
  expect(chromaDifference(actual,actual)).toBeLessThan(1e-10)
  expect(sourceChroma(new Float32Array(65536),sampleRate)).toBe(null)
 })
 it('stops a stalled optional FFT before its cue without aborting the handoff request',async()=>{
  vi.useFakeTimers();const workers:any[]=[]
  vi.stubGlobal('Worker',class{onmessage=null;onerror=null;postMessage=vi.fn();terminate=vi.fn();constructor(){workers.push(this)}})
  const buffer={length:1000,getChannelData:()=>new Float32Array(1000)} as unknown as AudioBuffer,pcm={a:{master:buffer,bass:buffer},b:{master:buffer,bass:buffer}} as DevicePCM
  const request=new AbortController();let position=8;const unavailable=vi.fn(),features=pitchDifferences(pcm,44100,request.signal,{start:10,position:()=>position,onUnavailable:unavailable})
  await vi.advanceTimersByTimeAsync(500);position=9.1;await vi.advanceTimersByTimeAsync(50)
  expect(await features).toEqual({bass:null,other:null});expect(request.signal.aborted).toBe(false);expect(workers[0].terminate).toHaveBeenCalledTimes(1);expect(unavailable).toHaveBeenCalledWith('optional_feature_cue_deadline')
  const cancelled=new AbortController(),pending=pitchDifferences(pcm,44100,cancelled.signal,{start:20,position:()=>position}),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});cancelled.abort();await rejected
 })
 it('rejects short decoded chunks and mono substitution instead of silently filling gaps',()=>{
  expect(()=>assertDecodedCoverage({numberOfChannels:2,length:1000},900,100)).not.toThrow()
  expect(()=>assertDecodedCoverage({numberOfChannels:2,length:999},900,100)).toThrow('样本覆盖')
  expect(()=>assertDecodedCoverage({numberOfChannels:1,length:1000},900,100)).toThrow('声道')
 })
})
