import {it,expect} from 'vitest'
import {validateBridge,planLoopRamp,sourceBeatAt,halfDoubleMapping,bridgeEligible,bridgeFingerprint} from './bridge'
const h='a'.repeat(64)
const material:any={schema:'harbeat.transition-material.v1',id:'drum-01',trackId:'a',runId:'run-a',masterSha256:h,reportSha256:h,stemSha256:h,profileSha256:h,asset:{sha256:h,url:'drum.wav',frames:176400,sampleRate:44100,channels:2},startFrame:441000,endFrame:617400,bpm:120,meter:[4,4],beats:8,accents:[1,.2,.6,.2,1,.2,.6,.2],rateRange:[.8,1.2],edgeMs:5,peak:.8,review:{status:'pending'}}
it('requires source identity, exact sample range and explicit finite percussion geometry',()=>{
 expect(validateBridge(material)).toBe(material)
 for(const patch of [{stemSha256:''},{endFrame:600000},{beats:0},{peak:1.2},{rateRange:[.1,3]}])expect(()=>validateBridge({...material,...patch})).toThrow()
})
it('keeps unreviewed or changed materials out of automatic selection',async()=>{
 expect(await bridgeEligible(material)).toBe(false)
 const reviewed={...material,review:{status:'approved',reviewer:'DJ self-report',at:'2026-10-26',fingerprint:await bridgeFingerprint(material)}}
 expect(await bridgeEligible(reviewed)).toBe(true);expect(await bridgeEligible({...reviewed,accents:reviewed.accents.map((v:number)=>v*.9)})).toBe(false)
})
it('integrates a bounded continuous tempo ramp to exactly the declared finite beats',()=>{
 const p=planLoopRamp(material,100,140,2);expect(p.duration).toBeCloseTo(8)
 expect(sourceBeatAt(p,p.duration)).toBeCloseTo(16);expect(sourceBeatAt(p,p.duration/2)).toBeCloseTo(7.3333333)
 expect(()=>planLoopRamp(material,100,150,2)).toThrow();expect(()=>planLoopRamp(material,100,140,99)).toThrow()
})
it('uses half/double beat mapping only with reviewed accent correspondence, never a 2x playback speed',()=>{
 expect(halfDoubleMapping(65,130,{reviewed:false,pairs:[[0,0],[4,8]]})).toBeNull()
 const m=halfDoubleMapping(65,130,{reviewed:true,pairs:[[0,0],[4,8]]})!
 expect(m.factor).toBe(.5);expect(m.rate).toBe(1);expect(m.aBeatToBBeat(3)).toBe(6)
 expect(halfDoubleMapping(65,130,{reviewed:true,pairs:[[0,0],[4,7]]})).toBeNull()
})
