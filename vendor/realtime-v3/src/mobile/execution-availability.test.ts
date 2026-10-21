import {it,expect,vi,afterEach} from 'vitest'
import {loadMetricIndex} from './metric'
const row=(id:string)=>({id,title:id,bpm:100,duration:80,playStatus:'ready',mixStatus:'ready',styleLabels:['Hip-Hop'],collection:'NAS'})
afterEach(()=>vi.unstubAllGlobals())
it('a playable song without a published strategy profile is excluded from mixed candidates',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>new Response(JSON.stringify(url.pathname.endsWith('library.json')?{schema:'harbeat.continuous-library.v1',tracks:[row('a'),row('b')]}:{schema:'harbeat.execution-library.v1',tracks:[{trackId:'b',profile:{sha256:'a'.repeat(64)},assetsReady:false}]}))))
 const library=await loadMetricIndex(new URL('https://example.test/listen/'))
 expect(library.tracks[0]).toMatchObject({playStatus:'ready',mixStatus:'unavailable'})
 // A published analysis profile can authorize original continuation even when stems are cold.
 expect(library.tracks[1].mixStatus).toBe('ready')
})
it('a failed strategy index keeps original playback available without pretending mixing is ready',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>url.pathname.endsWith('library.json')?new Response(JSON.stringify({schema:'harbeat.continuous-library.v1',tracks:[row('a')]})):new Response('{}',{status:503})))
 expect((await loadMetricIndex(new URL('https://example.test/'))).tracks[0]).toMatchObject({playStatus:'ready',mixStatus:'unavailable'})
})
