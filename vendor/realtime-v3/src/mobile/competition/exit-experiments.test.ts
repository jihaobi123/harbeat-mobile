import {it,expect} from 'vitest'
import {renderExitExperiment,type ExitExperiment} from './exit-experiments'
const sr=8000,a=[Float32Array.from({length:sr*4},(_,i)=>.3*Math.sin(i/9))],b=[Float32Array.from({length:sr*2},(_,i)=>.2*Math.sin(i/7))]
it('renders all four finite exits while preserving native incoming PCM after the outgoing tail',()=>{
 for(const m of ['vinyl-brake','backspin-echo','loop-roll','reverb-out'] as ExitExperiment[]){const r=renderExitExperiment(m,a,b,sr,100),x=r.channels[0];expect(x.every(Number.isFinite)).toBe(true);expect(Math.max(...x.map(Math.abs))).toBeLessThan(.98)
  for(let i=r.tailEndFrame+1;i<x.length;i+=97)expect(x[i]).toBeCloseTo(.646*b[0][i-r.handoffFrame],7)
  const silent=renderExitExperiment(m,[new Float32Array(a[0].length)],b,sr,100).channels[0];expect(silent.slice(0,a[0].length).every(v=>v===0)).toBe(true)
 }
})
it('rejects nonfinite evidence and leaves its source PCM untouched',()=>{
 const saved=a[0].slice();renderExitExperiment('loop-roll',a,b,sr,100);expect(a[0]).toEqual(saved)
 expect(()=>renderExitExperiment('loop-roll',a,b,sr,NaN)).toThrow();expect(()=>renderExitExperiment('unknown' as any,a,b,sr,100)).toThrow()
})
