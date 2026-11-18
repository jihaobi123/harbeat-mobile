import fs from 'node:fs';import path from 'node:path';import {CrossGenreClient} from '../../vendor/realtime-v3/src/mobile/crossgenre/client';import {planCrossGenre} from '../../vendor/realtime-v3/src/mobile/crossgenre/planner';import {DeviceEntryCache} from '../../vendor/realtime-v3/src/mobile/device-entry';import {planContinuous} from '../../vendor/realtime-v3/src/listen-upstream/continuous/beatAlignment'
const root=path.resolve(process.argv[2]),catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog-merged.json'),'utf8')),index=JSON.parse(fs.readFileSync(path.join(root,'publication/index.json'),'utf8'))
const tracks=new Map<string,any>(catalog.tracks.map((t:any)=>[t.id,t])),client=new CrossGenreClient(new URL('https://8.136.120.255/'),index,async input=>new Response(fs.readFileSync(path.join(root,'publication/objects',path.basename(new URL(String(input)).pathname)))))
const full=JSON.parse(fs.readFileSync(path.join(root,'catalog-full-qa.json'),'utf8'));for(const t of full.tracks)tracks.set(t.id,t)
const profiles=new Map<string,any>();for(const row of index.tracks){const t=tracks.get(row.trackId);if(t)profiles.set(t.id,await client.load(t,new AbortController().signal))}
const options:any[]=[]
for(const [aid,ap] of profiles)for(const [bid,bp] of profiles){if(aid===bid)continue;const a=tracks.get(aid),b=tracks.get(bid);if(a.style===b.style)continue
 const candidate=planCrossGenre(a,b,ap,bp,Math.max(0,(ap.exits[0]?.time??0)-10),60,3)
 if(candidate){const gap=Math.abs(Math.log2(a.bpm/b.bpm)),vocal=Math.min(1,((a.vocals??[]).reduce((s:number,[x,y]:number[])=>s+y-x,0))/a.duration);options.push({a,b,ap,bp,candidate,gap,vocal,priority:gap+(candidate.echo?2:0)+.1*vocal})}}
options.sort((a,b)=>b.priority-a.priority||a.a.id.localeCompare(b.a.id)||a.b.id.localeCompare(b.b.id))
const chosen:any[]=[],count=new Map<string,number>(),seen=new Set<string>()
function add(row:any){const key=row.a.id+':'+row.b.id;if(seen.has(key)||(count.get(row.a.id)??0)>=3||(count.get(row.b.id)??0)>=3)return;chosen.push(row);seen.add(key);count.set(row.a.id,(count.get(row.a.id)??0)+1);count.set(row.b.id,(count.get(row.b.id)??0)+1)}
for(const row of options.filter(x=>x.candidate.echo))if(chosen.length<4)add(row)
for(const row of options.filter(x=>x.gap<.15).sort((a,b)=>b.vocal-a.vocal))if(chosen.length<8)add(row)
for(const row of options)if(chosen.length<20)add(row)
const cache=new DeviceEntryCache({sampleRate:44100} as any,new URL('https://8.136.120.255/'),()=>{})
const pairs=[]
for(let i=0;i<chosen.length;i++){
 const {a,b,ap,bp,candidate,gap,vocal}=chosen[i],position=Math.max(0,candidate.exit-12),registered=await cache.register(b,[a])
 const original=planContinuous(a,[a,registered],position,{kind:'next',targetId:b.id},new Set(),18,false)
 const structural=planCrossGenre(a,b,ap,bp,position,18,3,{family:'structural-cut'}),echo=planCrossGenre(a,b,ap,bp,position,18,3,{family:'echo-out'})
 pairs.push({id:'pair-'+String(i+1).padStart(2,'0'),a:{id:a.id,title:a.title,bpm:a.bpm,style:a.style,provenance:a.provenance},b:{id:b.id,title:b.title,bpm:b.bpm,style:b.style,provenance:b.provenance},position,tempoOctaveGap:gap,sourceVocalFraction:vocal,structural,echo,legacy:{available:!!original.best,plan:original.best,exclusions:original.exclusions.map(x=>({code:x.code,reason:x.reason,count:x.count})),basis:'actual unchanged planContinuous with device-entry register geometry; no readiness requirement; current snapshot native windows; rate and beat gates unchanged'},subjectiveListening:'unscored'})
}
cache.dispose();fs.writeFileSync(path.join(root,'corpus.json'),JSON.stringify({schema:'harbeat.crossgenre-corpus.v1',createdAt:new Date().toISOString(),pairs},null,2));console.log(JSON.stringify({pairs:pairs.length,legacy:pairs.filter(p=>p.legacy.available).length,echo:pairs.filter(p=>p.echo).length,tracks:count.size}))
