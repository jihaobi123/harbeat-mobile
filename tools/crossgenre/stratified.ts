import fs from 'node:fs'
import path from 'node:path'
import {CrossGenreClient} from '../../vendor/realtime-v3/src/mobile/crossgenre/client'
import {sourceMatches} from '../../vendor/realtime-v3/src/mobile/crossgenre/contract'
import {planCrossGenre} from '../../vendor/realtime-v3/src/mobile/crossgenre/planner'
import {cohorts,selectCohorts,drumDistance,COHORTS} from '../../vendor/realtime-v3/src/mobile/audition/cohorts'
import {DeviceEntryCache} from '../../vendor/realtime-v3/src/mobile/device-entry'
import {planContinuous} from '../../vendor/realtime-v3/src/listen-upstream/continuous/beatAlignment'

const root=path.resolve(process.argv[2]),previous=path.resolve(process.argv[3]),context=JSON.parse(fs.readFileSync(path.join(root,'source-context.json'),'utf8'))
const slim=JSON.parse(fs.readFileSync(path.join(previous,'catalog-merged.json'),'utf8')),tracks=new Map<string,any>(slim.tracks.map((t:any)=>[t.id,t]))
for(const t of context.tracks)tracks.set(t.id,{...tracks.get(t.id),...t})
const publication=path.join(previous,'final-publication'),index=JSON.parse(fs.readFileSync(path.join(publication,'index.json'),'utf8'))
const client=new CrossGenreClient(new URL('https://8.136.120.255/'),index,async input=>new Response(fs.readFileSync(path.join(publication,'objects',path.basename(new URL(String(input)).pathname)))))
const profiles=new Map<string,any>()
for(const row of index.tracks){const t=tracks.get(row.trackId);if(t)profiles.set(t.id,await client.load(t,new AbortController().signal))}
const voice=(t:any,start:number,end:number)=>Math.min(1,(t.vocals??[]).reduce((s:number,[a,b]:number[])=>s+Math.max(0,Math.min(end,b)-Math.max(start,a)),0)/(end-start))
const options:any[]=[]
for(const [aid,ap] of profiles)for(const [bid,bp] of profiles){
 if(aid===bid||!ap.exits.length||!bp.entries.length)continue
 const a=tracks.get(aid),b=tracks.get(bid);if(a.style===b.style)continue
 let best:any=null
 for(const out of ap.exits){
  const position=Math.max(0,out.time-12),structural=planCrossGenre(a,b,ap,bp,position,18,3,{family:'structural-cut'})
  if(!structural)continue
  const ga=context.drumEvidence[aid],gb=context.drumEvidence[bid]
  const aa=ga&&sourceMatches(a,ga.source)?ga.signatures[structural.outgoing.id]:null,bb=gb&&sourceMatches(b,gb.source)?gb.signatures[structural.incoming.id]:null
  const evidence={aBpm:a.bpm,bBpm:b.bpm,drumDifference:aa&&bb?drumDistance(aa,bb):null,aVocal:voice(a,Math.max(0,structural.exit-14),structural.exit),bVocal:voice(b,structural.entry,structural.entry+16)}
  const groups=cohorts(evidence);if(!groups.length)continue
  const echo=planCrossGenre(a,b,ap,bp,position,18,3,{family:'echo-out'}),score=(echo?1:0)+Math.min(evidence.aVocal,evidence.bVocal)*.3+(evidence.drumDifference??0)*.1
  const row={id:aid+':'+bid,from:aid,to:bid,groups,score,a,b,position,structural,echo,evidence,drumSources:ga&&gb?{a:{profile:ga.profile,drumsSha256:ga.drumsSha256},b:{profile:gb.profile,drumsSha256:gb.drumsSha256},basis:ga.basis}:null}
  if(!best||score>best.score)best=row
 }
 if(best)options.push(best)
}
console.log(JSON.stringify({candidatePairs:options.length,cohorts:Object.fromEntries(COHORTS.map(c=>[c,options.filter(o=>o.groups.includes(c)).length]))}))
const chosen=selectCohorts(options,6),full=new Map<string,any>()
for(const row of chosen)for(const t of [row.a,row.b]){
 if(full.has(t.id))continue
 if(t.alignment?.bandFrames?.length){full.set(t.id,t);continue}
 const url=new URL(t.detailUrl,'https://8.136.120.255/listen/'),r=await fetch(url);if(!r.ok)throw Error('Full evidence unavailable '+t.id)
 const value=(await r.json()).track;if(!value||value.id!==t.id||JSON.stringify(value.provenance)!==JSON.stringify(t.provenance))throw Error('Source changed '+t.id)
 full.set(t.id,value)
}
const cache=new DeviceEntryCache({sampleRate:44100} as any,new URL('https://8.136.120.255/'),()=>{}),pairs=[]
for(let i=0;i<chosen.length;i++){
 const row=chosen[i],a=full.get(row.a.id),b=full.get(row.b.id),registered=await cache.register(b,[a])
 const baseline=planContinuous(a,[a,registered],row.position,{kind:'next',targetId:b.id},new Set(),18,false)
 const info=(t:any)=>({id:t.id,title:t.title,bpm:t.bpm,style:t.style,provenance:t.provenance})
 pairs.push({id:'pair-'+String(i+1).padStart(2,'0'),cohort:row.cohort,a:info(a),b:info(b),position:row.position,structural:row.structural,echo:row.echo,evidence:row.evidence,drumSources:row.drumSources,halfDoubleStatus:row.cohort==='half-double'?'tempo-ratio-candidate; accent mapping and listening unreviewed':null,
  legacy:{available:!!baseline.best,plan:baseline.best,exclusions:baseline.exclusions.map(x=>({code:x.code,reason:x.reason,count:x.count})),basis:'unchanged actual planContinuous and DeviceEntryCache register; full published source evidence'},subjectiveListening:'unscored'})
}
cache.dispose();fs.writeFileSync(path.join(root,'corpus.json'),JSON.stringify({schema:'harbeat.crossgenre-corpus.v2',createdAt:new Date().toISOString(),pairs},null,2));fs.writeFileSync(path.join(root,'catalog-full-qa.json'),JSON.stringify({tracks:[...full.values()]}))
console.log(JSON.stringify({pairs:pairs.length,tracks:full.size,baseline:pairs.filter(p=>p.legacy.available).length,echo:pairs.filter(p=>p.echo).length,cohorts:Object.fromEntries(COHORTS.map(c=>[c,pairs.filter(p=>p.cohort===c).length]))}))
