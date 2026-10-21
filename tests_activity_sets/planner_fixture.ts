import {qualityTrack} from '../vendor/realtime-v3/src/metric-upstream/continuous/qualityFixture'
const tracks=['a','b','c','d'].map(id=>({...qualityTrack(id),styleLabels:['Hip-Hop']}))
for(const t of tracks){
 for(const w of t.windows)w.variants=Object.fromEntries(tracks.map(a=>[a.id,{...w.variants.a}]))
 Object.assign(t.preprocessing!,{unusedFullReport:{largeDebugRows:Array(1000).fill({unrelated:'publication trace'})}})
}
process.stdout.write(JSON.stringify({tracks,styles:['Hip-Hop'],energy:3,maxTracks:4}))
