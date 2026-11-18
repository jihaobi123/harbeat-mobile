/** Opt-in real-owner-audio export. Run prepare_scratch_audition.py first. */
import {it,expect} from 'vitest'
import {readFileSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript'
import {planScratch,renderScratch} from '../src/mobile/performance-plan'
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=root+'.impeccable/review/scratch-ab-v2/',sr=44100
function wav(name:string,channels:Float32Array[]){
 const frames=channels[0].length,b=Buffer.alloc(44+frames*channels.length*2)
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels.length,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*channels.length*2,28);b.writeUInt16LE(channels.length*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40)
 for(let i=0;i<frames;i++)for(let c=0;c<channels.length;c++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+(i*channels.length+c)*2)
 writeFileSync(out+name,b)
}
it.skipIf(process.env.HARBEAT_SCRATCH_AUDITION!=='1')('exports real-song baseline/v1/v2 without changing the app or source audio',()=>{
 const legacy:any={},source=execFileSync('git',['show','03b44e4:vendor/realtime-v3/src/mobile/performance-plan.ts'],{cwd:root,encoding:'utf8'})
 new Function('exports',transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText)(legacy)
 const inputs=JSON.parse(readFileSync(out+'inputs.json','utf8')),report=[]
 for(const row of inputs){
  const track=JSON.parse(readFileSync(out+row.id+'/track.json','utf8')),bytes=readFileSync(out+row.id+'/source.f32'),pcm=[new Float32Array(bytes.length/8),new Float32Array(bytes.length/8)]
  for(let i=0;i<pcm[0].length;i++)for(let c=0;c<2;c++)pcm[c][i]=bytes.readFloatLE(i*8+c*4)
  const old=legacy.planScratch(track,row.position),plan=planScratch(track,row.position),pre=2,start=plan.start-pre,length=Math.round((pre+plan.duration+3)*sr)
  expect(Math.abs(old.start-plan.start)).toBeLessThan(.001)
  const extract=(at:number,duration:number)=>pcm.map(x=>x.slice(Math.round((at-row.offset)*sr),Math.round((at-row.offset+duration)*sr)+1))
  const began=performance.now(),fresh=renderScratch(extract(plan.sourceStart,plan.sourceDuration),sr,plan),renderMs=performance.now()-began,prior=legacy.renderScratch(extract(old.start,.36),sr,old)
  const mix=(clip:Float32Array[]|null,duck:number)=>pcm.map((channel,c)=>{
   const x=new Float32Array(length)
   for(let i=0;i<length;i++){
    const t=i/sr,j=i-Math.round(pre*sr),end=pre+plan.duration
    let backing=1
    if(clip){if(t>=pre-.015&&t<pre)backing=1+(duck-1)*(t-pre+.015)/.015;else if(t>=pre&&t<end)backing=duck;else if(t>=end&&t<end+.1)backing=duck+(1-duck)*(t-end)/.1}
    x[i]=.7*(.6*(channel[Math.round((start-row.offset)*sr)+i]??0)*backing+.35*(clip?.[c][j]??0))
   }
   return x
  })
  const versions={original:mix(null,1),old:mix(prior,.28),new:mix(fresh,.82)}
  for(const [name,x]of Object.entries(versions)){expect(x[0].reduce((peak,v)=>Math.max(peak,Math.abs(v)),0)).toBeLessThan(1);wav(row.id+'/'+name+'.wav',x)}
  wav(row.id+'/scratch-only.wav',fresh.map(c=>c.map(v=>v*.7)))
  report.push({...row,plan,previousPlan:old,renderMs,seconds:length/sr})
 }
 writeFileSync(out+'report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(r=>({title:r.title,bpm:r.bpm,renderMs:r.renderMs,source:r.plan.sourceStart,strokes:r.plan.strokes.length}))))
})
