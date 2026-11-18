import {afterEach,expect,it,vi} from 'vitest'
import {AudioBufferPool,AudioCache} from '../listen-upstream/realtime/cache'
import {ListenRun} from './listen'
import {ListenTransport} from './listen-transport'
import {liveFixture,liveTracks} from './longmix/live-fixture'

const cleanups:(()=>void)[]=[]
afterEach(()=>{for(const clean of cleanups.splice(0))clean();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()})

function fixture(){
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 const base=new URL('https://example.test/listen/'),approval=liveFixture(),{a,b}=liveTracks(approval)
 const entry={id:approval.id,sha256:'e'.repeat(64),sceneSha256:approval.sceneSha256,url:'/listen/longmix-live/v1/'+'e'.repeat(64)+'.json',from:a.id,to:b.id,sourcePosition:40}
 const fetcher=vi.fn(async(input:URL|string)=>new URL(input).pathname==='/listen/longmix-live/v1/index.json'
  ?new Response(JSON.stringify({schema:'harbeat.live-layering-index.v1',scenes:[entry]}))
  :new Response('unpublished',{status:404}))
 vi.stubGlobal('fetch',fetcher)
 const ctx={sampleRate:44100,currentTime:0,state:'running'} as AudioContext
 // Only the Web Audio hardware constructor is bypassed. The transport method,
 // session, port, both catalogs and their metadata validation remain real.
 const p:any=Object.create(ListenTransport.prototype)
 Object.assign(p,{ctx,cache:new AudioCache(ctx,base,()=>{},new AudioBufferPool()),notify:()=>{},tracks:[a,b],active:null,pending:null,gate:{locked:false},busy:false,paused:false,logs:[],sessionId:'role-routing-test',multiMode:'off',liveSession:null,livePort:null,liveTimer:null})
 const run=new ListenRun({schema:'harbeat.continuous-library.v1',tracks:[]} as any,base,()=>{})
 run.player=p
 cleanups.push(()=>{p.liveSession?.dispose();p.livePort?.dispose();p.liveBaselineOwner?.dispose();p.cache.dispose()})
 return{run,p,a,b,fetcher}
}

it.each(['roles-c','roles-cd'] as const)('routes %s from ListenRun through the real transport and retains AB when roles are unpublished',async mode=>{
 const {run,p,a,b,fetcher}=fixture()
 expect(p.configureLiveLayering).toBe(ListenTransport.prototype.configureLiveLayering)
 await run.setLiveLayering(true)
 await run.setMultiLayering(mode)
 expect(p.liveLayeringStatus).toMatchObject({enabled:true,multiMode:mode,state:'idle',sourceCount:2})
 expect(fetcher.mock.calls.map(([url])=>new URL(url).pathname)).toEqual([
  '/listen/longmix-live/v1/index.json','/listen/longmix-live/v1/index.json','/listen/role-replacement/v1/index.json'
 ])
 p.active={track:a,at:0,offset:10}
 expect(p.livePreferredTargets([b])).toEqual([b.id])
 expect(p.logs).toContainEqual(expect.objectContaining({kind:'multi_layering_unavailable'}))
 expect(p.liveLayeringStatus).toMatchObject({enabled:true,multiMode:mode,sourceCount:2})
})

it('rejects an unknown mode at both API boundaries without changing the configured session',async()=>{
 const {run,p,fetcher}=fixture()
 await run.setLiveLayering(true)
 const session=p.liveSession,calls=fetcher.mock.calls.length
 await expect(run.setMultiLayering('roles-unknown' as any)).rejects.toThrow('多来源模式无效')
 await expect(p.configureLiveLayering(true,run.base,'takeover-b','roles-unknown' as any)).rejects.toThrow('多来源模式无效')
 expect(p.liveSession).toBe(session)
 expect(p.liveLayeringStatus).toMatchObject({enabled:true,multiMode:'off',state:'idle',sourceCount:2})
 expect(fetcher).toHaveBeenCalledTimes(calls)
})

it.each(['off','c','cd'] as const)('preserves the existing %s mode while ordinary mixing is selected',async mode=>{
 const {run,p,fetcher}=fixture()
 await run.setMultiLayering(mode)
 expect(p.liveLayeringStatus).toMatchObject({enabled:false,multiMode:mode,state:'disabled'})
 expect(p.liveSession).toBeNull()
 expect(fetcher).not.toHaveBeenCalled()
})
