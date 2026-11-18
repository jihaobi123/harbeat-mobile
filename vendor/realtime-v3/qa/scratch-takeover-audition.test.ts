/** Same V2 PCM, different routing only. No network and no public publishing. */
import {it,expect} from 'vitest'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript'
import {planScratch,renderScratch} from '../src/mobile/performance-plan'
import {scratchRouting} from '../src/mobile/performance-effects'
const root=fileURLToPath(new URL('../../../',import.meta.url)),input=root+'.impeccable/review/scratch-ab-v2/',output=root+'.impeccable/review/scratch-takeover/',sr=44100
function wav(path:string,channels:Float32Array[]){
 const frames=channels[0].length,b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40)
 for(let i=0;i<frames;i++)for(let c=0;c<2;c++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+(i*2+c)*2)
 writeFileSync(path,b)
}
it.skipIf(process.env.HARBEAT_SCRATCH_AUDITION!=='1')('compares overlay and takeover with identical V2 scratch PCM and frozen source clock',()=>{
 const legacy:any={},text=execFileSync('git',['show','b7aeb63:vendor/realtime-v3/src/mobile/performance-plan.ts'],{cwd:root,encoding:'utf8'})
 new Function('exports',transpileModule(text,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText)(legacy)
 mkdirSync(output,{recursive:true});const report=[]
 for(const row of JSON.parse(readFileSync(input+'inputs.json','utf8'))){
  expect(row.id).toMatch(/^track-[0-9a-f]{20}$/)
  const track=JSON.parse(readFileSync(input+row.id+'/track.json','utf8')),bytes=readFileSync(input+row.id+'/source.f32'),pcm=[new Float32Array(bytes.length/8),new Float32Array(bytes.length/8)]
  for(let i=0;i<pcm[0].length;i++)for(let c=0;c<2;c++)pcm[c][i]=bytes.readFloatLE(i*8+c*4)
  const plan=planScratch(track,row.position);expect(plan).toEqual(legacy.planScratch(track,row.position))
  const extract=pcm.map(x=>x.slice(Math.round((plan.sourceStart-row.offset)*sr),Math.round((plan.sourceStart-row.offset+plan.sourceDuration)*sr)+1)),fresh=renderScratch(extract,sr,plan),prior=legacy.renderScratch(extract,sr,plan)
  for(let c=0;c<2;c++)expect(fresh[c]).toEqual(prior[c])
  const pre=2,length=Math.round((pre+plan.duration+3)*sr),start=plan.start-pre,directory=output+row.id+'/'
  mkdirSync(directory,{recursive:true})
  for(const kind of ['original','overlay','takeover']){
   const mix=pcm.map((channel,c)=>{
    const x=new Float32Array(length),end=pre+plan.duration
    for(let i=0;i<length;i++){
     const t=i/sr,j=i-Math.round(pre*sr);let gain=1,copyGain=0
     if(kind==='overlay'){
      copyGain=.35
      if(t>=pre-.015&&t<pre)gain=1+(.82-1)*(t-pre+.015)/.015
      else if(t>=pre&&t<end)gain=.82
      else if(t>=end&&t<end+.1)gain=.82+(1-.82)*(t-end)/.1
     }else if(kind==='takeover'){
      copyGain=scratchRouting.scratchGain;const edge=scratchRouting.edgeSeconds
      if(t>=pre-edge&&t<pre)gain=1-(t-pre+edge)/edge
      else if(t>=pre&&t<end-edge)gain=scratchRouting.originalGain
      else if(t>=end-edge&&t<end)gain=(t-end+edge)/edge
     }
     x[i]=.7*(.6*(channel[Math.round((start-row.offset)*sr)+i]??0)*gain+copyGain*(fresh[c][j]??0))
    }
    return x
   })
   expect(mix[0].reduce((peak,v)=>Math.max(peak,Math.abs(v)),0)).toBeLessThan(1);wav(directory+kind+'.wav',mix)
  }
  report.push({...row,plan,routing:scratchRouting,identicalScratchPCM:true,seconds:length/sr})
 }
 writeFileSync(output+'report.json',JSON.stringify(report,null,2));console.log('3 same-PCM takeover comparisons exported')
})
