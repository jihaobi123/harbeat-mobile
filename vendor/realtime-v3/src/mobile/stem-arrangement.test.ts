import {it,expect} from 'vitest'
import {jetsonFixture} from './jetson-test-fixture'
import {pcmBuffer,type WindowPCM} from './decision-core'
import {analyseStemArrangement,evaluateStemConflicts} from './stem-arrangement'
import {valueAt} from './device-execution'
const sr=44100
function tone(d:number,hz:number,active:[number,number][]=[[0,d]]){const x=new Float32Array(Math.round(d*sr)*2);for(let i=0;i<x.length/2;i++)if(active.some(([s,e])=>i/sr>=s&&i/sr<e))x[i*2]=x[i*2+1]=.035*Math.sin(2*Math.PI*hz*i/sr);return pcmBuffer(x,sr)}
function audio(d:number):WindowPCM{const sides:any={};for(const side of ['a','b']){const rows:any={bass:tone(d,side==='a'?110:146.83),other:tone(d,side==='a'?440:622.25),drums:tone(d,70),vocals:tone(d,220,side==='a'?[[0,2]]:[[.1,1],[4,6]])};const sum=new Float32Array(Math.round(d*sr)*2);for(let i=0;i<sum.length/2;i++)sum[i*2]=sum[i*2+1]=Object.values(rows).reduce((s:number,v:any)=>s+v.getChannelData(0)[i],0);rows.master=pcmBuffer(sum,sr);sides[side]=rows}return sides}
it('holds A through its tail, mutes overlapping B, and restores B at a complete later phrase',async()=>{
 const f=await jetsonFixture(),d=f.p.duration;aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,1],[4,6]])
 const r=analyseStemArrangement(f.a,f.b,f.p,audio(d))
 expect(r.eligible,r.reason).toBe(true);expect(r.timeline).toBeTruthy()
 expect(valueAt(r.timeline!.a.vocals,1.9)).toBe(1);expect(valueAt(r.timeline!.b.vocals,.5)).toBe(0);expect(valueAt(r.timeline!.b.vocals,4)).toBe(1)
 expect(r.evidence!.processed.vocals).toBeLessThan(.01);expect(r.evidence!.processed.bass).toBeLessThan(r.evidence!.baseline.bass)
})
it('scores only audible stem overlap rather than an unchanged whole-song clash',()=>{
 const pcm=audio(8),g:any={schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration:8,a:{},b:{}}
 for(const role of ['vocals','bass','other','drums']){g.a[role]=[[0,1],[2,0],[8,0]];g.b[role]=[[0,0],[2,0],[2.1,1],[8,1]]}
 const separated=evaluateStemConflicts(pcm,g),both=evaluateStemConflicts(pcm,{...g,a:Object.fromEntries(Object.keys(g.a).map(r=>[r,[[0,1],[8,1]]])),b:Object.fromEntries(Object.keys(g.b).map(r=>[r,[[0,1],[8,1]]]))} as any)
 expect(separated.bass).toBeLessThan(.01);expect(both.bass).toBeGreaterThan(.8);expect(both.vocals).toBeGreaterThan(0)
})
it('rejects keeping A when its current phrase continues beyond the approved source window',async()=>{
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,f.p.duration+2]]);aVoice(f.b,0,[[4,6]])
 const r=analyseStemArrangement(f.a,f.b,f.p,audio(f.p.duration));expect(r.eligible).toBe(false);expect(r.reason).toContain('人声')
})
it('does not restore B in the middle of a phrase that crosses the body takeover',async()=>{
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,12]])
 const r=analyseStemArrangement(f.a,f.b,f.p,audio(f.p.duration));expect(r.eligible).toBe(false);expect(r.reason).toContain('人声')
})
function aVoice(t:any,offset:number,parts:[number,number][]){t.vocals=parts.map(([s,e])=>[offset+s,offset+e]);t.alignment.phrases=t.vocals.map(([s,e]:number[])=>({start:s,end:e,tailEnd:e}))}
it('rejects a large source reconstruction discrepancy instead of hiding an unchecked master residual',async()=>{
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,1],[4,6]])
 const pcm=audio(f.p.duration);for(let c=0;c<2;c++){const m=pcm.b.master.getChannelData(c),v=pcm.b.vocals.getChannelData(c);for(let i=0;i<m.length;i++)m[i]+=v[i]*8}
 const r=analyseStemArrangement(f.a,f.b,f.p,pcm);expect(r.eligible).toBe(false);expect(r.reason).toContain('重建')
})

it('rejects a short reconstruction gap at either the A entrance or B body takeover',async()=>{
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,1],[4,6]])
 for(const side of ['a','b'] as const){const pcm=audio(f.p.duration),n=Math.round(.2*sr);for(const role of ['bass','other','drums','vocals'])for(let c=0;c<2;c++){const x=pcm[side][role].getChannelData(c);x.fill(0,side==='a'?0:x.length-n,side==='a'?n:x.length)}
  const result=analyseStemArrangement(f.a,f.b,f.p,pcm);expect(result.eligible,side).toBe(false);expect(result.reason).toContain('重建')
  expect(analyseStemArrangement(f.a,f.b,f.p,pcm,{calibrateSources:true}).eligible).toBe(false)
 }
})

it('checks retained cross-role pitched layers rather than only bass/bass and melody/melody',async()=>{
 const {measureStemCompatibility}=await import('./stem-compatibility'),pcm=audio(8),t:any={schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration:8,a:{},b:{}}
 for(const role of ['drums','bass','other','vocals']){t.a[role]=[[0,0],[8,0]];t.b[role]=[[0,0],[8,0]]}
 t.a.bass=[[0,1],[8,1]];t.b.other=[[0,1],[8,1]]
 const clash=measureStemCompatibility(pcm,t,120);expect(clash.pitchedRisk).toBeGreaterThan(.8);expect(clash.pass).toBe(false)
 t.b.other=[[0,0],[8,0]];const clear=measureStemCompatibility(pcm,t,120);expect(clear.pitchedRisk).toBe(0);expect(clear.pass).toBe(true)
})

it('does not dilute a two-second incompatible cross-role overlap over a longer transition',async()=>{
 const {measureStemCompatibility}=await import('./stem-compatibility'),pcm=audio(8),t:any={schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration:8,a:{},b:{}}
 for(const role of ['drums','bass','other','vocals']){t.a[role]=[[0,0],[8,0]];t.b[role]=[[0,0],[8,0]]}
 t.a.bass=[[0,1],[4,1],[4.25,0],[8,0]];t.b.other=[[0,0],[2,0],[2.25,1],[8,1]]
 const clash=measureStemCompatibility(pcm,t,120);expect(clash.pitchedRisk).toBeGreaterThan(.8);expect(clash.incompatiblePitchedSeconds).toBeGreaterThan(1.8);expect(clash.pass).toBe(false)
 for(let c=0;c<2;c++){const x=pcm.b.other.getChannelData(c);for(let i=0;i<x.length;i++)x[i]*=3}
 const unbalanced=measureStemCompatibility(pcm,t,120);expect(unbalanced.pass).toBe(false)
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,1],[4,6]])
 const result=analyseStemArrangement(f.a,f.b,f.p,audio(f.p.duration));expect(result.eligible,result.reason).toBe(true)
 expect(result.evidence!.compatibility.incompatiblePitchedSeconds).toBeLessThanOrEqual(result.evidence!.compatibility.drumOverlapLimit)
})

it('ignores isolated-vocal DC bias but continues to protect a real quiet AC tail',async()=>{
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,1],[4,6]])
 const pcm=audio(f.p.duration)
 for(let c=0;c<2;c++){const v=pcm.a.vocals.getChannelData(c),m=pcm.a.master.getChannelData(c);for(let i=0;i<v.length;i++){v[i]+=.0012;m[i]+=.0012}}
 const result=analyseStemArrangement(f.a,f.b,f.p,pcm);expect(result.eligible,result.reason).toBe(true);expect(result.evidence!.aTailEnd).toBeLessThan(2.1)
 for(let c=0;c<2;c++){const v=pcm.a.vocals.getChannelData(c),m=pcm.a.master.getChannelData(c);for(let i=2*sr;i<v.length;i++){const tail=.0008*Math.sin(2*Math.PI*220*i/sr);v[i]+=tail;m[i]+=tail}}
 const quietTail=analyseStemArrangement(f.a,f.b,f.p,pcm);expect(quietTail.eligible).toBe(false);expect(quietTail.reason).toContain('尾音')
})

it('checks a retained tonal vocal against the other songs pitched accompaniment',async()=>{
 const {measureStemCompatibility}=await import('./stem-compatibility'),pcm=audio(8),t:any={schema:'harbeat.stem-timeline.v1',clock:'transition-start',duration:8,a:{},b:{}}
 for(const role of ['drums','bass','other','vocals']){t.a[role]=[[0,0],[8,0]];t.b[role]=[[0,0],[8,0]]}
 pcm.a.vocals=tone(8,220);t.a.vocals=[[0,1],[8,1]];t.b.other=[[0,1],[8,1]]
 expect(measureStemCompatibility(pcm,t,120).pass).toBe(false)
 t.a.vocals=[[0,0],[8,0]];expect(measureStemCompatibility(pcm,t,120).pass).toBe(true)
})
it('calibrates a common source-stem level before conflict, headroom and takeover checks',async()=>{
 const f=await jetsonFixture();aVoice(f.a,f.p.start,[[0,2]]);aVoice(f.b,f.p.window.start,[[.1,1],[4,6]])
 const pcm=audio(f.p.duration)
 for(const side of ['a','b'] as const)for(const role of ['bass','other','drums','vocals'])for(let c=0;c<2;c++){const x=pcm[side][role].getChannelData(c);for(let i=0;i<x.length;i++)x[i]*=.8}
 expect(analyseStemArrangement(f.a,f.b,f.p,pcm).eligible).toBe(false)
 const result=analyseStemArrangement(f.a,f.b,f.p,pcm,{calibrateSources:true});expect(result.eligible,result.reason).toBe(true)
 expect(result.sourceGains!.a).toBeCloseTo(1.25,4);expect(result.sourceGains!.b).toBeCloseTo(1.25,4)
 expect(result.evidence!.reconstruction.a.errorRatio).toBeLessThan(.001)
})
