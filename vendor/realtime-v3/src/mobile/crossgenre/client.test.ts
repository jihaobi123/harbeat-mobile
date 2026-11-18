import {it,expect,vi} from 'vitest'
import {webcrypto} from 'node:crypto'
import {CrossGenreClient} from './client'
import {ALGORITHM_SHA} from './contract'
import {fixture} from './fixtures'
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})

it('checks actual sidecar bytes and digest before caching a Jetson profile',async()=>{
 const {track,profile}=fixture(),raw=new TextEncoder().encode(JSON.stringify(profile)),sha=Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex')
 const row={trackId:track.id,source:profile.source,algorithmSha256:ALGORITHM_SHA,entryCount:1,exitCount:1,echoExitCount:0,profile:{sha256:sha,url:'/listen/crossgenre/objects/'+sha+'.json',bytes:raw.length}}
 const index={schema:'harbeat.crossgenre-library.v1',producer:'jetson',policy:'crossgenre-structural-v1',algorithmSha256:ALGORITHM_SHA,tracks:[row],excluded:[]}
 const read=vi.fn(async()=>new Response(raw)),client=new CrossGenreClient(new URL('https://example.test/'),index as any,read)
 expect((await client.load(track,new AbortController().signal)).source.trackId).toBe('a')
 await client.load(track,new AbortController().signal);expect(read).toHaveBeenCalledTimes(1)
 const bad=new CrossGenreClient(new URL('https://example.test/'),index as any,async()=>new Response(new Uint8Array(raw.length)))
 await expect(bad.load(track,new AbortController().signal)).rejects.toThrow(/校验/)
})

it('never accepts a source merely because a profile says producer Jetson',async()=>{
 const {track}=fixture(),read=vi.fn()
 const client=new CrossGenreClient(new URL('https://example.test/'),null,read)
 await expect(client.load(track,new AbortController().signal)).rejects.toThrow(/尚未/)
 expect(read).not.toHaveBeenCalled()
})

it('cancels oversized chunked responses before consuming the whole body',async()=>{
 const {track,profile}=fixture();let cancelled=false
 const row={trackId:track.id,source:profile.source,algorithmSha256:ALGORITHM_SHA,entryCount:1,exitCount:1,echoExitCount:0,profile:{sha256:'f'.repeat(64),url:'/listen/crossgenre/objects/'+'f'.repeat(64)+'.json',bytes:100}}
 const index={schema:'harbeat.crossgenre-library.v1',producer:'jetson',policy:'crossgenre-structural-v1',algorithmSha256:ALGORITHM_SHA,tracks:[row],excluded:[]}
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(101))},cancel(){cancelled=true}})
 const client=new CrossGenreClient(new URL('https://example.test/'),index as any,async()=>new Response(stream))
 await expect(client.load(track,new AbortController().signal)).rejects.toThrow(/字节/)
 expect(cancelled).toBe(true)
})

it('bounds sidecar network waits without leaving a caller abort listener',async()=>{
 vi.useFakeTimers()
 try{
  const {track,profile}=fixture(),row={trackId:track.id,source:profile.source,algorithmSha256:ALGORITHM_SHA,entryCount:1,exitCount:1,echoExitCount:0,profile:{sha256:'f'.repeat(64),url:'/listen/crossgenre/objects/'+'f'.repeat(64)+'.json',bytes:100}}
  const index={schema:'harbeat.crossgenre-library.v1',producer:'jetson',policy:'crossgenre-structural-v1',algorithmSha256:ALGORITHM_SHA,tracks:[row],excluded:[]}
  let aborted=false
  const read:any=(_url:any,options:any)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(options.signal.reason)}))
  const client=new CrossGenreClient(new URL('https://example.test/'),index as any,read)
  const promise=expect(client.load(track,new AbortController().signal)).rejects.toMatchObject({name:'TimeoutError'})
  await vi.advanceTimersByTimeAsync(15001);await promise;expect(aborted).toBe(true)
 }finally{vi.useRealTimers()}
})
