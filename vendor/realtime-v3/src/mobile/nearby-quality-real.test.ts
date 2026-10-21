import {expect,it} from 'vitest'
import fs from 'node:fs'
import zlib from 'node:zlib'
import {nearbyPlan} from './nearby'
import {planContinuous} from '../metric-upstream/continuous/beatAlignment'
import type {Track} from '../metric-upstream/realtime/planner'
const tracks:Track[]=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/handoff-quality-real.json.gz',import.meta.url))).toString()).tracks
const song=(title:string)=>tracks.find(t=>t.title===title)!
it('does not trade a formal four-bar entry for four milliseconds of earlier start',()=>{
 const a=song('Straight (Battle Beat)'),b=song('Make It Right'),position=123.72856689342399
 const legacy=planContinuous(a,[b],position+.25,{kind:'next',targetId:b.id},new Set(),18,false).best!
 expect(legacy.window.id).toBe('w16-4')
 const p=nearbyPlan(a,b,position)!
 expect(p.window.id).toBe(legacy.window.id);expect(p.duration).toBeCloseTo(8.971972789115647)
})
it('retains the entry material used in the accepted continuous-player session',()=>{
 const a=song('Attention'),b=song('HIPHOP'),position=59.554648526077095
 const legacy=planContinuous(a,[b],position,{kind:'next',targetId:b.id},new Set(),18,false).best!
 const p=nearbyPlan(a,b,position)!
 expect(p.window.id).toBe(legacy.window.id);expect(p.asset.sha256).toBe(legacy.asset.sha256);expect(p.duration).toBe(legacy.duration)
})
it('does not call full-duration double vocals a safe original-master fallback',()=>{
 expect(nearbyPlan(song('Make It Right'),song('아무노래'),90.38877097505663)).toBeNull()
})
