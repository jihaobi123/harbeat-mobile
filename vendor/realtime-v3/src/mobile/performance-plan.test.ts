import {describe,it,expect} from 'vitest'
import {planScratch,renderScratch} from './performance-plan'
const sha='a'.repeat(64)
function track(period=.5,dense=false):any{
 return {id:'a',duration:40,bpm:60/period,provenance:{masterSha256:sha},alignment:{source:{masterSha256:sha},bars:Array.from({length:16},(_,i)=>({valid:true,start:i*4*period,end:(i+1)*4*period,beats:[0,1,2,3].map(b=>(i*4+b)*period)})),bandFrames:Array.from({length:800},(_,i)=>({start:i*.05,end:(i+1)*.05,low:-25,mid:i%(dense?2:4)===0?-15:-45,high:-30}))}}
}
describe('source-bound baby scratch',()=>{
 it('pushes and returns within every measured beat, independent of arbitrary band attacks',()=>{
  for(const period of [.375,.75,1.2]){
   const p=planScratch(track(period),4.1),dense=planScratch(track(period,true),4.1)
   expect(p.version).toBe('baby-scratch-v2');expect(p.strokes).toHaveLength(4)
   p.strokes.forEach((s,i)=>expect(s.start).toBeCloseTo(period*i/2))
   expect(dense.strokes.map(s=>s.start)).toEqual(p.strokes.map(s=>s.start))
   for(const s of p.strokes)expect(Math.abs(s.to-s.from)/((s.end-s.start)*.85)).toBeCloseTo(1.6,5)
   expect(p.strokes[1].to).toBe(p.strokes[0].from);expect(p.strokes[3].to).toBe(p.strokes[2].from)
   expect(p.sourceDuration).toBeGreaterThan(Math.max(...p.strokes.map(s=>Math.max(s.from,s.to))))
  }
 })
 it('uses unequal measured intervals and rejects mismatched identity / absent analysis',()=>{
  const t=track();t.alignment.bars[2].beats=[4,4.48,5.03,5.49]
  const p=planScratch(t,4.1);expect(p.start).toBe(4.48);expect(p.duration).toBeCloseTo(1.01)
  expect(p.strokes[1].start).toBeCloseTo(.275);expect(p.strokes[2].start).toBeCloseTo(.55)
  t.alignment.source.masterSha256='b'.repeat(64);expect(()=>planScratch(t,4.1)).toThrow('身份')
  expect(()=>planScratch({...track(),alignment:null},4)).toThrow('拍点')
  expect(()=>planScratch(track(),39.8)).toThrow();expect(()=>planScratch(track(),NaN)).toThrow()
 })
 it('selects a published clear onset instead of an arbitrary full-mix instant',()=>{
  const t=track();const p=planScratch(t,4.1),onset=p.sourceStart+.04
  expect(t.alignment.bandFrames.some((f:any)=>Math.abs(f.start-onset)<1e-6&&f.mid===-15)).toBe(true)
  t.alignment.bandFrames=[];expect(()=>planScratch(t,4.1)).toThrow('起音')
  t.alignment.bandFrames=[{start:4.4,end:4.5,low:-5,mid:-65,high:-70}];expect(()=>planScratch(t,4.1)).toThrow('起音')
 })
 it('accepts silent null bands without losing a usable mid onset',()=>{
  const t=track();for(const f of t.alignment.bandFrames){f.low=null;f.high=null}
  expect(planScratch(t,4.1).sourceEvidence).toBe('published-band-onset')
 })
 it('renders bounded stereo without source mutation or quiet amplification',()=>{
  const sr=8000,input=new Float32Array(sr*3).map((_,i)=>.6*Math.sin(2*Math.PI*1400*i/sr)),before=input.slice(),plan=planScratch(track(),4.1)
  const pcm=renderScratch([input,input],sr,plan)
  expect(pcm[0].length).toBe(Math.round(sr*plan.duration));expect(input).toEqual(before)
  expect(Math.max(...pcm[0].map(Math.abs))).toBeLessThan(.7)
  for(const s of plan.strokes)expect(Math.abs(pcm[0][Math.min(pcm[0].length-1,Math.round(s.start*sr))])).toBeLessThan(.06)
  expect(()=>renderScratch([new Float32Array(sr*3)],sr,plan)).toThrow('安静');expect(()=>renderScratch([input.slice(0,100)],sr,plan)).toThrow('覆盖')
 })
 it('removes most scratch-copy bass while keeping the original untouched',()=>{
  const sr=16000,p=planScratch(track(),4.1),tone=(f:number)=>new Float32Array(sr*3).map((_,i)=>.4*Math.sin(2*Math.PI*f*i/sr))
  const rms=(x:Float32Array)=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length)
  expect(rms(renderScratch([tone(80)],sr,p)[0])/rms(renderScratch([tone(1400)],sr,p)[0])).toBeLessThan(.25)
 })
})
