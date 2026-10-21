import {expect,it} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {measuredLevel,rankChoices,rankNearbyChoices,shortlist} from './smart-selection'
const track=(id:string,db=-15)=>{const t=qualityTrack(id);t.alignment!.bandFrames[0].rmsDbfs=db;return t}
it('uses library style labels, excludes current/recent songs and retains exact overrides',()=>{
 const row=(id:string,styleLabels=['Hip-Hop'],bpm=120):any=>({id,styleLabels,bpm,playStatus:'ready',mixStatus:'ready'})
 const a=row('a'),b=row('b'),c=row('c',['House']),d=row('d',['HipHop']),far=row('far',['Hip-Hop'],150)
 expect(shortlist([a,b,c,d,far],a,'hiphop',['b'],new Set()).map(t=>t.id)).toEqual(['d'])
 expect(shortlist([a,b,c],a,'Hip-Hop',[],new Set(),'c').map(t=>t.id)).toEqual(['c'])
})
it('ranks source-bound takeover energy without using per-song normalization or changing audio',()=>{
 const a=track('a'),b=track('b'),c=track('c',-12),d=track('d',-18)
 b.energy[0].value=1;c.energy[0].value=.01
 const original=JSON.stringify([a,b,c,d])
 expect(rankChoices(a,[b,c,d],35,3).best!.track.id).toBe('b')
 expect(rankChoices(a,[b,c,d],35,5).best!.track.id).toBe('c')
 expect(rankChoices(a,[b,c,d],35,1).best!.track.id).toBe('d')
 expect(JSON.stringify([a,b,c,d])).toBe(original)
})
it('requires all four takeover blocks, real coverage and matching source identity',()=>{
 const b=track('b',-12),a=track('a')
 b.alignment!.bandFrames=[{...b.alignment!.bandFrames[0],end:12}, {...b.alignment!.bandFrames[0],start:12,rmsDbfs:-23}]
 expect(rankChoices(a,[b],35,4).best).toBeNull()
 b.alignment!.source.masterSha256='different'
 expect(measuredLevel(b,8,12)).toBeNull()
 const missing=track('missing');missing.alignment!.bandFrames=[]
 expect(measuredLevel(missing,4,8)).toBeNull()
})
it('keeps the accepted full-beat gate, full overlap and the worker speed limit',()=>{
 const a=track('a'),b=track('b')
 const p=rankChoices(a,[b],35,3).best!.plan
 expect(p.duration).toBe(8);expect(p.end).toBeGreaterThanOrEqual(78*.65)
 b.windows[0].variants.a.rate=1.06
 expect(rankChoices(a,[b],35,3).best).toBeNull()
 b.windows[0].variants.a.rate=1;b.alignment!.bars[0].beats[1]+=.12
 expect(rankChoices(a,[b],35,3).best).toBeNull()
})

it('nearby direction evaluates energy on the actual entry instead of a later automatic window',()=>{
 const a=track('a'),b=track('b')
 b.windows=[b.windows[0],{...b.windows[0],id:'high-entry',start:24,end:32}]
 b.alignment!.bandFrames=[{...b.alignment!.bandFrames[0],end:32,rmsDbfs:-24},{...b.alignment!.bandFrames[0],start:32,rmsDbfs:-12}]
 const p=rankNearbyChoices(a,[b],0,5).best!
 expect(p.plan.window.id).toBe('high-entry');expect(p.plan.start).toBeLessThan(15);expect(p.energy.deltasDb).toEqual([3,3,3,3])
 expect(rankChoices(a,[b],35,5).best!.plan.end).toBeGreaterThanOrEqual(78*.65)
})
it('nearby ranking excludes incompatible energy without altering source metadata',()=>{
 const a=track('a'),b=track('b',-24),before=JSON.stringify([a,b])
 expect(rankNearbyChoices(a,[b],0,5).best).toBeNull();expect(JSON.stringify([a,b])).toBe(before)
})

it('retrieves related substyles only when the Hip-Hop parent is requested',()=>{
 const row=(id:string,style:string):any=>({id,bpm:120,styleLabels:[style],playStatus:'ready',mixStatus:'ready'})
 const a=row('a','Hip-Hop'),b=row('b','boombap'),c=row('c','trap'),d=row('d','jazz hiphop'),e=row('e','grime'),f=row('f','House')
 expect(shortlist([a,b,c,d,e,f],a,'Hip-Hop',[],new Set()).map(t=>t.id)).toEqual(['b','c','d','e'])
 expect(shortlist([a,b,c,d,e,f],a,'boombap',[],new Set()).map(t=>t.id)).toEqual(['b'])
})
it('allows steady measured energy at high preference and still rejects large jumps',()=>{
 const a=track('a'),b=track('b')
 expect(rankChoices(a,[b],35,5).best?.track.id).toBe('b')
 expect(rankNearbyChoices(a,[b],0,5).best?.track.id).toBe('b')
 b.alignment!.bandFrames[0].rmsDbfs=-7
 expect(rankNearbyChoices(a,[b],0,5).best).toBeNull()
})

it('keeps formal entry material fixed when another window better matches energy',()=>{
 const a=track('a'),b=track('b')
 for(const t of [a,b]){t.vocals=[];t.preprocessing!.vocalActivity!.intervals=[]}
 b.windows=[{...b.windows[0],id:'a-flat'},{...b.windows[0],id:'z-loud',start:24,end:32}]
 b.alignment!.bandFrames=[{...b.alignment!.bandFrames[0],end:32},{...b.alignment!.bandFrames[0],start:32,rmsDbfs:-12}]
 expect(rankNearbyChoices(a,[b],0,5).best!.plan.window.id).toBe('a-flat')
 expect(rankNearbyChoices(a,[b],0,1).best!.plan.window.id).toBe('a-flat')
})
