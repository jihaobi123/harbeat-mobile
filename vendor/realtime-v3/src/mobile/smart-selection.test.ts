import {expect,it} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {measuredLevel,rankChoices,shortlist} from './smart-selection'
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
 b.alignment!.bandFrames=[{...b.alignment!.bandFrames[0],end:12}, {...b.alignment!.bandFrames[0],start:12,rmsDbfs:-20}]
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
