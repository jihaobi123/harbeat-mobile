import {it,expect} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {rebuildJetsonPlan,floatWave,checkPreludeBeats} from './jetson-analysis'
it('reconstructs an existing cue without accepting a shifted forged timestamp',()=>{const a=qualityTrack('a'),b=qualityTrack('b'),p=rebuildJetsonPlan(a,b,'w',12);expect(p.start).toBeCloseTo(12);expect(()=>rebuildJetsonPlan(a,b,'w',12.4)).toThrow()})
it('requires the entire extended beat mapping and rejects cumulative drift',()=>{const a=qualityTrack('a'),b=qualityTrack('b');expect(checkPreludeBeats(a,b,8,8,8,1)).toBeLessThan(1);b.alignment!.bars[6].beats[2]+=.08;expect(checkPreludeBeats(a,b,8,8,8,1)).toBeGreaterThan(65)})
it('encodes stereo float source PCM without changing samples or mixing tracks',()=>{const x=new Float32Array([.1,-.2,.3,-.4]),bytes=floatWave(x,44100),view=new DataView(bytes.buffer);expect(view.getUint16(20,true)).toBe(3);expect(view.getUint16(22,true)).toBe(2);expect(view.getFloat32(44,true)).toBe(x[0]);expect(bytes.byteLength).toBe(44+x.byteLength)})

it('rejects a shared missing bar, malformed beats and a partial-prefix boundary',()=>{
 const a=qualityTrack('a'),b=qualityTrack('b')
 a.alignment!.bars=a.alignment!.bars.filter(x=>x.index!==5);b.alignment!.bars=b.alignment!.bars.filter(x=>x.index!==5)
 expect(checkPreludeBeats(a,b,8,8,8,1)).toBe(Infinity)
 const c=qualityTrack('c'),d=qualityTrack('d');d.alignment!.bars[5].beats.pop()
 expect(checkPreludeBeats(c,d,8,8,8,1)).toBe(Infinity)
 expect(checkPreludeBeats(c,c,8.2,8.2,7.8,1)).toBe(Infinity)
})
it('reports actual ordered beat error instead of substituting zero',async()=>{
 const {mainBeatErrorMs}=await import('./jetson-analysis'),a=qualityTrack('a'),b=qualityTrack('b'),p=rebuildJetsonPlan(a,b,'w',12)
 b.alignment!.bars[1].beats[2]+=.012
 expect(mainBeatErrorMs(a,b,p)).toBeCloseTo(12,6)
})

import {analyseJetsonInput,evaluatePreludeAudio} from './jetson-analysis'
import {jetsonFixture} from './jetson-test-fixture'
const sr=44100
async function sourceInput(){
 const f=await jetsonFixture();f.b.windows[0].start=12;f.b.windows[0].end=20
 const p=rebuildJetsonPlan(f.a,f.b,'w',12),files=new Map<string,Float32Array>()
 const window=(side:string,start:number,duration:number)=>{const row:any={start,duration,files:{}};for(const stem of ['master','bass','other','vocals','drums']){const key=side+'-'+stem,x=new Float32Array(Math.round(duration*sr)*2);for(let i=0;i<x.length/2;i++){const t=i/sr,v=stem==='vocals'?0:stem==='master'?.05:stem==='drums'?(t%.5<.0625?Math.sin(t*2*Math.PI*90)*.04:0):Math.sin(t*2*Math.PI*(stem==='bass'?(side.startsWith('a')?110:220):(side.startsWith('a')?440:660)))*.02;x[i*2]=x[i*2+1]=v}files.set(key,x);row.files[stem]=key}return row}
 const input:any={schema:'harbeat.jetson-plan-input.v1',jobId:f.result.id,plannerSha256:f.result.algorithmSha256,sampleRate:sr,channels:2,a:f.a,b:f.b,sourceProof:f.result.sourceProof,request:{windowId:'w',start:12},pcm:{a:window('a-main',12,8),b:window('b-main',12,8.008),body:window('body',20,8)},auditionSingleMethod:'filter',prelude:{leadSeconds:6,fadeInSeconds:2,holdSeconds:4,pcm:{a:window('a-ext',6,14),b:window('b-ext',6,14.008)}}}
 return {input,read:(key:string)=>files.get(key)!,p,files}
}
it('requires an 8-second body and the frozen historically selected eligible single',async()=>{
 const {input,read}=await sourceInput();const missing=structuredClone(input);delete missing.pcm.body
 expect((await analyseJetsonInput(missing,read)).group.skip).toMatch(/正文/)
 const wrong=structuredClone(input);wrong.auditionSingleMethod='vocal'
 expect((await analyseJetsonInput(wrong,read)).group.skip).toMatch(/单项/)
 const valid=await analyseJetsonInput(input,read);expect(valid.group.skip).toBeUndefined();expect(valid.group.singleMethod).toBe('filter')
 expect(valid.group.approval.basis.headroom).toMatch(/RBJ/)
 expect(Object.keys(valid.group.pcm.a).sort()).toEqual(['master','other']);expect(Object.keys(valid.group.pcm.b).sort()).toEqual(['drums','master'])
 expect(valid.result.plan.beatErrorMs).toBeCloseTo(0,6)
 const production=structuredClone(input);delete production.prelude;delete production.auditionSingleMethod;delete production.pcm.body
 const plain=await analyseJetsonInput(production,read);expect(plain.result.decision).toEqual(valid.result.decision);expect(plain.result.drumPrelude).toBeUndefined()
})
it('evaluates main-window added drum level and detects incompatible drum accents',()=>{
 const n=sr*14,zeros=()=>new Float32Array(n*2),a:any={master:zeros(),drums:zeros()},b:any={master:zeros(),drums:zeros()},p:any={duration:8,restore:20,start:12,v30Eq:undefined},controls:any={duration:8,lastBarStart:6,bassTiming:{duckStart:4,swapStart:5.5,swapEnd:6}}
 for(let i=0;i<n;i++){a.master[i*2]=a.master[i*2+1]=.05;b.master[i*2]=b.master[i*2+1]=.05;const pulse=i%(sr/2)<sr/16?.1:0;a.drums[i*2]=a.drums[i*2+1]=pulse;b.drums[i*2]=b.drums[i*2+1]=pulse}
 const safe=evaluatePreludeAudio(a,b,p,controls,'original',6,2);expect(safe.headroomSafe).toBe(true);expect(safe.drumCompatible).toBe(true);expect(safe.peak).toBeCloseTo((.05+.1*.25)*.6*.7,5)
 const eq={...p,v30Eq:{a:[{t:0,low:18,high:18,mid:18}],b:[{t:0,low:18,high:18,mid:18}]}}
 expect(evaluatePreludeAudio(a,b,eq,controls,'original',6,2).peak).toBeGreaterThan(safe.peak*2)
 b.drums.fill(6,sr*6*2,sr*7*2)
 expect(evaluatePreludeAudio(a,b,p,controls,'original',6,2).headroomSafe).toBe(false)
 const dense=zeros();dense.fill(.2);b.drums=dense
 expect(evaluatePreludeAudio(a,b,p,controls,'original',6,2).drumCompatible).toBe(false)
})
