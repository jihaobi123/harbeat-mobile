import {expect,it} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {planActivitySet} from './activity-plan'
import {rankChoices} from './smart-selection'
function songs(){const tracks=['a','b','c','d','e'].map(id=>({...qualityTrack(id),styleLabels:id==='e'?['House']:['Hip-Hop'],playStatus:'ready',mixStatus:'ready'}));for(const t of tracks)for(const w of t.windows)w.variants=Object.fromEntries(tracks.map(a=>[a.id,{...w.variants.a}]));return tracks}
it('bounds a style set and uses the existing automatic planner at each source',()=>{
 const tracks=songs(),out=planActivitySet({tracks,styles:['Hip-Hop'],energy:3,maxTracks:4})
 expect(out.trackIds).toHaveLength(4);expect(out.trackIds).not.toContain('e');expect(out.edges.length).toBeGreaterThan(0);expect(out.edges.length).toBeLessThanOrEqual(8)
 for(const p of out.edges.filter(p=>p.kind==='automatic')){const a=tracks.find(t=>t.id===p.from)!,options=tracks.filter(t=>out.trackIds.includes(t.id));const expected=rankChoices(a,options,35,3,new Set()).best!.plan;expect(p.start).toBe(expected.start);expect(p.windowId).toBe(expected.window.id)}
 expect(out.trackIds).toContain(out.initialTrackId)
})
it('does not replace unknown source evidence with invented prepared transitions',()=>{
 const tracks=songs();for(const t of tracks)t.vocals=null
 expect(planActivitySet({tracks,styles:['Hip-Hop'],energy:3,maxTracks:4}).edges).toEqual([])
})
it('includes the same Hip-Hop family used by live selection and is deterministic',()=>{
 const tracks=songs();tracks[0].styleLabels=['boombap'];const options={tracks,styles:['Hip-Hop'],energy:3,maxTracks:4}
 expect(planActivitySet(options)).toEqual(planActivitySet({...options,tracks:[...tracks].reverse()}));expect(planActivitySet(options).trackIds).toContain('a')
})
