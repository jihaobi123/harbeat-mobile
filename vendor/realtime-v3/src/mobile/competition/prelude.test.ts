import {readFileSync} from 'node:fs'
import {it,expect} from 'vitest'
import {preludeMatches} from './prelude'
import {verifyDrumPreludeProof,validateDrumPreparedAssets,validateDrumTakeoverAsset} from '../drum-prelude-audition'
it('retains both real historical approvals and excludes changed current source identities',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../../public/drum-first/index.json',import.meta.url),'utf8'));expect(manifest.groups).toHaveLength(2)
 for(const g of manifest.groups){await verifyDrumPreludeProof(g.approval);validateDrumPreparedAssets(g.approval,g.pcm);validateDrumTakeoverAsset(g.approval,g.body)
  const p=g.result.execution.plan,a:any={id:p.from,provenance:g.result.execution.sourceFingerprints.a},b:any={id:p.to,provenance:g.result.execution.sourceFingerprints.b}
  expect(preludeMatches(g,a,b)).toBe(true);expect(preludeMatches(g,{...a,provenance:{...a.provenance,runId:'changed'}},b)).toBe(false)
 }
})
