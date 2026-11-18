import fs from 'node:fs'
import {nativeCandidate,preludeCandidate} from '../src/mobile/competition/candidates'
import {experimentalPlans} from '../src/mobile/competition/experiments'
const root=process.argv[2],context=JSON.parse(fs.readFileSync(root+'/source-context.json','utf8')),corpus=JSON.parse(fs.readFileSync(root+'/corpus-audio.json','utf8')),materials=JSON.parse(fs.readFileSync('public/transition-materials/index.json','utf8')).materials,groups=JSON.parse(fs.readFileSync('public/drum-first/index.json','utf8')).groups,catalog=JSON.parse(fs.readFileSync(root+'/catalog-full-qa.json','utf8')),track=(id:string)=>context.tracks.find((t:any)=>t.id===id)??catalog.tracks.find((t:any)=>t.id===id)
const rows=[]
for(const pair of corpus.pairs){const a=track(pair.a.id),b=track(pair.b.id);if(!a||!b)continue;const base=[pair.structural,...(pair.echo?[pair.echo]:[])],all=[...base,...experimentalPlans(base,a,b,materials,true,'a'.repeat(64))],scores=all.map(p=>nativeCandidate(a,b,p,pair.position,30)).sort((a,b)=>b.score-a.score);rows.push({pair:pair.id,a:a.title,b:b.title,position:pair.position,gradualAvailable:pair.legacy.available,methods:scores.map(c=>({method:c.method,score:c.score,exit:(c.plan as any).exit,entry:(c.plan as any).entry,components:c.components}))})}
const prelude=groups.map((g:any)=>{const p=g.result.execution.plan,a=track(p.from),b=track(p.to);return{title:g.title,position:g.approval.sourceWindow.aStart-8,candidate:preludeCandidate(a,b,g,true,g.approval.sourceWindow.aStart-8,30,3)}})
console.log(JSON.stringify({rows,prelude},null,2))
