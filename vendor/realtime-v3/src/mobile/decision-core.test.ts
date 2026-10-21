import {it,expect} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {nearbyPlan} from './nearby'
import {analyseWindow,pcmBuffer} from './decision-core'
const sr=44100
function tone(seconds:number,hz=110,gain=.1){const x=new Float32Array(Math.round(seconds*sr)*2);for(let i=0;i<x.length/2;i++)x[2*i]=x[2*i+1]=Math.sin(i*hz*2*Math.PI/sr)*gain;return pcmBuffer(x,sr)}
it('retains observed-window metrics and established bass/filter ranking with aligned PCM',()=>{
 const a=qualityTrack('a'),b=qualityTrack('b'),p=nearbyPlan(a,b,10)!,audio={a:{master:tone(p.duration),bass:tone(p.duration),other:tone(p.duration,440)},b:{master:tone(p.duration+.008),bass:tone(p.duration+.008,220),other:tone(p.duration+.008,660)}}
 const r=analyseWindow(a,b,p,audio)
 expect(r.metrics.bassOverlap).toBeGreaterThan(.49);expect(r.metrics.bassOverlap).toBeLessThan(.52)
 expect(r.metrics.otherDifference).toBeGreaterThan(.9);expect(r.decision.methods.original.eligible).toBe(true)
 expect(r.decision.methods.filter.eligible).toBe(true);expect(r.controls.duration).toBe(p.duration)
})
it('keeps missing stems unknown and permits only the original fallback',()=>{
 const a=qualityTrack('a'),b=qualityTrack('b'),p=nearbyPlan(a,b,10)!,r=analyseWindow(a,b,p,{a:{master:tone(p.duration)},b:{master:tone(p.duration+.008)}})
 expect(r.metrics.bassDifference).toBeNull();expect(r.metrics.vocalSafe).toBe(false);expect(r.decision.recommended).toBe('original')
 expect(Object.values(r.decision.methods).filter(m=>m.eligible)).toHaveLength(1)
})
it('retains a quiet vocal tail until an observed beat and rejects an incoming voice before release',()=>{
 const a=qualityTrack('a'),b=qualityTrack('b'),p=nearbyPlan(a,b,10)!;a.vocals=[];b.vocals=[]
 const voice=tone(p.duration);for(let c=0;c<2;c++)voice.getChannelData(c).fill(0,Math.round(sr*2))
 const base={a:{master:tone(p.duration),vocals:voice},b:{master:tone(p.duration+.008),vocals:tone(p.duration+.008,110,0)}}
 const good=analyseWindow(a,b,p,base);expect(good.controls.vocalExit?.fadeStart).toBeGreaterThanOrEqual(2.08)
 b.vocals=[[p.window.start,p.window.start+1]];expect(analyseWindow(a,b,p,base).controls.vocalExit).toBeUndefined()
})

it('clips a permitted observed-grid lead at source zero without moving the frozen cue',()=>{
 const a=qualityTrack('a'),b=qualityTrack('b'),p=nearbyPlan(a,b,10)!;const frozen=p.start+.037;p.start=frozen;p.duration=4;p.end=frozen+4
 const r=analyseWindow(a,b,p,{a:{master:tone(p.duration)},b:{master:tone(p.duration+.008)}})
 expect(r.controls.bassTiming.duckStart).toBeGreaterThanOrEqual(0);expect(r.controls.lastBarStart).toBeLessThan(p.duration);expect(p.start).toBe(frozen)
})
