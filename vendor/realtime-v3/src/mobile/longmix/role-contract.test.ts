import {it,expect} from 'vitest'
import {validateRole,roleIdentity,roleMeasurements,roleBytes,verifyRoleHashes} from './role-contract'
import {canonicalJson} from '../jetson-contract'
import {roleFixture,sealRoleFixture} from './role-fixture'
it('accepts independent three/four-source replacement evidence without changing the approved AB object',()=>{
 for(const mode of ['roles-c','roles-cd'] as const){const v=roleFixture(mode),before=structuredClone(v.base);expect(validateRole(v)).toBe(v);expect(v.base).toEqual(before);expect(roleIdentity(v).base).toBe(v.base);expect(roleBytes(v)).toBeLessThanOrEqual(96*1024*1024)}
})
it('binds the complete arrangement, measurements and immutable AB scene to independent hashes',async()=>{
 const v=await sealRoleFixture(roleFixture('roles-cd'));expect(roleMeasurements(v).arrangementSha256).toBe(v.evidence.arrangementSha256);expect(roleMeasurements(v)).not.toHaveProperty('measurementsSha256');await expect(verifyRoleHashes(v)).resolves.toBeUndefined()
 for(const mutate of [(x:any)=>x.layers[0].gain=.6,(x:any)=>x.evidence.checks.reconstruction=.2,(x:any)=>x.base.scene.layers[0].points[0][1]=.9,(x:any)=>x.base.scene.clips.aStart+=1]){const x=structuredClone(v);mutate(x);await expect(verifyRoleHashes(x)).rejects.toThrow()}
})
it('cannot reuse an old measurement hash after changing gain and publishing a fresh arrangement hash',async()=>{
 const hash=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(v))))).map(x=>x.toString(16).padStart(2,'0')).join('')
 const v=await sealRoleFixture(roleFixture('roles-cd'));await verifyRoleHashes(v)
 const changed=structuredClone(v);changed.layers[0].gain=.6;changed.evidence.arrangementSha256=await hash(roleIdentity(changed))
 expect(changed.evidence.measurementsSha256).toBe(v.evidence.measurementsSha256)
 await expect(verifyRoleHashes(changed)).rejects.toThrow(/测量|指纹/)
})
it('keeps the original output-gain calibration floor for both C and D without changing audibility admission',()=>{
 const v=roleFixture('roles-cd');v.base.scene.outputGain=.475;const floor=v.base.scene.outputGain*.5
 for(const layer of v.layers)layer.gain=floor
 expect(()=>validateRole(v)).not.toThrow();for(const i of [0,1]){const changed=structuredClone(v);changed.layers[i].gain=floor-.000001;expect(()=>validateRole(changed)).toThrow()}
 for(const layer of v.layers)layer.gain=.25
 expect(()=>validateRole(v)).not.toThrow();v.evidence.checks.simultaneousFourRoleSeconds=.9;expect(()=>validateRole(v)).toThrow()
})
it('rejects research approvals, unrelated sources, missing pairwise proof and failed unchanged gates',()=>{
 const mutations=[(v:any)=>v.approved=false,(v:any)=>v.scope='audition-only',(v:any)=>v.schema='harbeat.four-role-audition.v1',(v:any)=>v.base.approved=false,(v:any)=>v.sources.c=v.base.scene.sources.a,(v:any)=>v.sources.d=v.sources.c,(v:any)=>delete v.evidence.pairwise['A/B'],(v:any)=>delete v.evidence.pairwise['C/D'],(v:any)=>v.evidence.pairwise['A/C'].pass_=false,(v:any)=>v.evidence.pairwise['B/D'].pitchedRisk=.36,(v:any)=>v.evidence.pairwise['A/D'].incompatiblePitchedSeconds=1,(v:any)=>v.evidence.peak=.951,(v:any)=>v.evidence.lowEnergyRatio=1.11,(v:any)=>v.evidence.checks.reconstruction=.251,(v:any)=>v.evidence.checks.vocalMaxDb=-44,(v:any)=>v.evidence.checks.beatErrorMs=51,(v:any)=>v.evidence.checks.loopSeamDb=-19,(v:any)=>v.evidence.checks.onsetGrowth=1.36,(v:any)=>v.evidence.checks.originalVocalPreserved=false,(v:any)=>v.evidence.checks.simultaneousFourRoleSeconds=.9,(v:any)=>v.evidence.exitPeaks.pop(),(v:any)=>v.evidence.exitPeaks[0].at+=1]
 for(const change of mutations){const v=roleFixture('roles-cd');change(v);expect(()=>validateRole(v)).toThrow()}
})
it('permits only exact B.other complement and complete independently scheduled D vocals',()=>{
 const mutations=[(v:any)=>v.layers[0].role='bass',(v:any)=>v.layers[0].source='a',(v:any)=>v.layers[0].rate=1.01,(v:any)=>v.layers[0].gain=1.1,(v:any)=>v.layers[0].sourceStartFrame=.5,(v:any)=>v.bOther[1][1]+=.1,(v:any)=>v.layers[0].points[2][1]=.5,(v:any)=>v.layers[1].loop=true,(v:any)=>v.layers[1].outputStart+=.1,(v:any)=>v.layers[1].vocalBoundary.tailComplete=false,(v:any)=>v.layers[1].vocalBoundary.headMaxDb=-40,(v:any)=>v.layers[1].points[2][0]+=.02,(v:any)=>v.bVocals[1][0]+=.02,(v:any)=>v.window[1]=18,(v:any)=>v.base.entry.sourcePosition+=1]
 for(const change of mutations){const v=roleFixture('roles-cd');change(v);expect(()=>validateRole(v)).toThrow()}
 const v=roleFixture();v.bDrums=[[0,0],[40,0]];expect(()=>validateRole(v)).toThrow();const c=roleFixture();c.bVocals=c.base.scene.layers.find((l:any)=>l.role==='vocals').points;expect(()=>validateRole(c)).toThrow()
})
