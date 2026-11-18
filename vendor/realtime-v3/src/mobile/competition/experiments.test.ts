import {it,expect} from 'vitest'
import {fixture} from '../crossgenre/fixtures'
import {enumerateCrossGenre} from '../crossgenre/planner'
import {experimentalPlans,validateNativeWinner} from './experiments'
const h='a'.repeat(64),material:any={schema:'harbeat.transition-material.v1',id:'d',trackId:'a',runId:'run',masterSha256:h,reportSha256:h,stemSha256:h,profileSha256:h,asset:{sha256:h,url:'d.wav',frames:176400,sampleRate:44100,channels:2},startFrame:0,endFrame:176400,bpm:120,meter:[4,4],beats:8,accents:Array(8).fill(.5),rateRange:[.8,1.2],edgeMs:5,peak:.8,review:{status:'pending'}}
it('adds finite source-bound bridge and tempo-loop candidates under explicit experimental authorization',()=>{
 const a=fixture('a',110),b=fixture('b',125),base=enumerateCrossGenre(a.track,b.track,a.profile,b.profile,20,30)
 expect(experimentalPlans(base,a.track,b.track,[],false,h)).toEqual([])
 const plans=experimentalPlans(base,a.track,b.track,[material],true,h)
 expect(plans.some(p=>p.family==='drum-bridge')).toBe(true);expect(plans.some(p=>p.family==='loop-ramp')).toBe(true)
 const p=plans.find(p=>p.bridge)!;expect(p.end).toBeGreaterThan(p.exit);expect(p.bridge!.material.review.status).toBe('pending')
 validateNativeWinner(p,a.track,b.track,a.profile,b.profile,[material],true,h)
 expect(()=>validateNativeWinner({...p,entry:18},a.track,b.track,a.profile,b.profile,[material],true,h)).toThrow()
 expect(()=>validateNativeWinner(p,a.track,b.track,a.profile,b.profile,[material],false,h)).toThrow()
})
