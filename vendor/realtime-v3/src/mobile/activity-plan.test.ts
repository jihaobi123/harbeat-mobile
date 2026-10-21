import {describe,it,expect} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {planActivitySet} from './activity-plan'
import {choiceForPlan,rankChoices} from './smart-selection'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'

const input=()=>{
 const tracks=['a','b','c','d'].map(id=>({...qualityTrack(id),styleLabels:['Hip-Hop']}))
 for(const t of tracks)for(const w of t.windows)w.variants=Object.fromEntries(tracks.map(a=>[a.id,{...w.variants.a}]))
 return {tracks,styles:['Hip-Hop'],energy:3,maxTracks:4}
}
describe('reservation multi-cue candidate preparation',()=>{
 it('retains the saved set and its actual size for a one-time replan',()=>{
  const o=input(),p=planActivitySet({...o,retainedTrackIds:['c','d']})
  expect(p.trackIds).toEqual(['c','d'])
  expect(planActivitySet(o).trackIds).toHaveLength(4)
 })
 it('preserves saved tracks after style relabeling while replacements still match the requested style',()=>{
  const o=input();o.tracks[2].styleLabels=['House']
  expect(planActivitySet({...o,retainedTrackIds:['c','d']}).trackIds).toEqual(['c','d'])
  expect(planActivitySet(o).trackIds).not.toContain('c')
  Object.assign(o.tracks[3],{mixStatus:'unavailable'})
  const replacement=planActivitySet({...o,retainedTrackIds:['c','d']})
  expect(replacement.trackIds).toEqual(['c','a'])
  expect(replacement.warnings).not.toContain('retained_track_unavailable:c')
 })
 it('fills only unavailable saved tracks and reports the replacement',()=>{
  const o=input();Object.assign(o.tracks[2],{mixStatus:'unavailable'})
  const p=planActivitySet({...o,retainedTrackIds:['c','d']})
  expect(p.trackIds).toEqual(['d','a'])
  expect(p.warnings).toContain('retained_track_unavailable:c')
  expect(p.warnings).toContain('retained_track_replacement:a')
 })
 it('retains the original automatic best while bounding the requested style set',()=>{
  const o=input(),other={...qualityTrack('e'),styleLabels:['House']};o.tracks.push(other)
  for(const t of o.tracks)for(const w of t.windows)w.variants.e={...w.variants.a}
  const p=planActivitySet(o)
  expect(p.trackIds).toHaveLength(4);expect(p.trackIds).not.toContain('e')
  for(const a of o.tracks.filter(t=>p.trackIds.includes(t.id))){
   const best=rankChoices(a,o.tracks.filter(t=>t.id!==a.id&&p.trackIds.includes(t.id)),35,3).best
   expect(best).toBeTruthy();expect(p.edges.some(e=>e.kind==='automatic'&&e.id===best!.plan.id)).toBe(true)
  }
  expect(p.trackIds).toContain(p.initialTrackId)
 })
 it('retains the live Hip-Hop family and stable ordering',()=>{
  const o=input();o.tracks[0].styleLabels=['boombap']
  expect(planActivitySet(o)).toEqual(planActivitySet({...o,tracks:[...o.tracks].reverse()}))
  expect(planActivitySet(o).trackIds).toContain('a')
 })
 it('never substitutes an invented transition for missing vocal evidence',()=>{
  const o=input();for(const t of o.tracks)t.vocals=null
  expect(planActivitySet(o).edges).toEqual([])
 })
 it('does not replace missing observed beats with nominal BPM alignment',()=>{
  const o=input();for(const t of o.tracks)t.alignment!.bars=[]
  expect(planActivitySet(o).edges).toEqual([])
 })
 it('prepares multiple chronological cues and several target songs, bounded per source',()=>{
  const o=input(),p=planActivitySet(o),edges=p.edges.filter(e=>e.from==='a')
  expect(new Set(edges.map(e=>e.start)).size).toBeGreaterThan(2)
  expect(new Set(edges.map(e=>e.to)).size).toBe(3)
  expect(edges.length).toBeLessThanOrEqual(24)
  expect(p.edges.length).toBeLessThanOrEqual(288)
  expect(p.coverage.tracks).toHaveLength(4)
  for(const e of edges){expect(e.source.a.reportId).toBe('reporta');expect(e.version).toBe('activity-candidate-v2')}
 })
 it('never fills coverage holes with a colliding vocal cue',()=>{
  const o=input();for(const t of o.tracks){t.vocals=[[0,80]];t.preprocessing!.vocalActivity.intervals=[{start_ms:0,end_ms:80000}]}
  const p=planActivitySet(o)
  expect(p.edges).toEqual([])
  expect(p.coverage.tracks.every(t=>!t.complete)).toBe(true)
  expect(p.warnings.some(w=>w.includes('coverage'))).toBe(true)
 })
 it('retains original energy and full local beat gates',()=>{
  const o=input();o.tracks[1].alignment!.bandFrames[0].rmsDbfs=0
  const p=planActivitySet(o)
  expect(p.edges.some(e=>e.to==='b')).toBe(false)
  for(const e of p.edges){
   const a=o.tracks.find(t=>t.id===e.from)!,b=o.tracks.find(t=>t.id===e.to)!
   const raw=planContinuous(a,[b],Math.max(0,e.start-.75),{kind:'next',targetId:b.id},new Set(),60,false)
   const plan=raw.candidates.find(c=>Math.abs(c.start-e.start)<.002&&c.window.id===e.windowId)
   expect(plan).toBeTruthy();expect(choiceForPlan(a,b,plan!,o.energy)).toBeTruthy()
  }
 })
})
