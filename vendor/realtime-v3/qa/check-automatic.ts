import fs from 'node:fs';import {planCrossGenre} from '../src/mobile/crossgenre/planner'
const root='../../outputs/crossgenre-20261026',c=JSON.parse(fs.readFileSync(root+'/catalog-qa.json','utf8')),idx=JSON.parse(fs.readFileSync(root+'/publication/index.json','utf8')),ts=new Map<string,any>(c.tracks.map((t:any)=>[t.id,t]))
const profile=(id:string)=>{const row=idx.tracks.find((t:any)=>t.trackId===id);return JSON.parse(fs.readFileSync(root+'/publication/objects/'+row.profile.sha256+'.json','utf8'))}
const a=ts.get('track-778955521e34b542bb1f'),b=ts.get('track-6ac3f8303bcf91194b8b')
console.log(JSON.stringify(planCrossGenre(a,b,profile(a.id),profile(b.id),23.759,120,3,{automatic:true}),null,2))
