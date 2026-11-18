import {it,expect,vi} from 'vitest'
import {nativeAudioPriorityFetch} from './native-audio-priority'
const base=new URL('https://appassets.androidplatform.net/assets/realtime/'),hash='a'.repeat(64),a=`/api/analysis-lab/media/${hash}?sha256=${hash}`
it('marks current cold body playback and background entry/set downloads without changing URLs or abort signals',async()=>{
 let current=false;const transport=vi.fn(async()=>new Response()),fetcher=nativeAudioPriorityFetch(base,()=>current,transport),controller=new AbortController()
 await fetcher(new URL(a,base),{signal:controller.signal,headers:{'X-Existing':'yes'}})
 let [url,options]=transport.mock.calls[0] as unknown as [URL,RequestInit]
 expect(url.href).toBe(new URL(a,base).href);expect(options.signal).toBe(controller.signal);expect(new Headers(options.headers).get('X-HarBeat-Audio-Purpose')).toBe('prepare');expect(new Headers(options.headers).get('X-Existing')).toBe('yes')
 current=true;await fetcher(new URL(a,base));options=(transport.mock.calls[1] as unknown as [URL,RequestInit])[1]
 expect(new Headers(options.headers).get('X-HarBeat-Audio-Purpose')).toBe('playback')
})
it('does not tag web deployments, foreign URLs, metadata, blobs or unbound media',async()=>{
 const transport=vi.fn(async()=>new Response()),foreground=vi.fn(()=>false),fetcher=nativeAudioPriorityFetch(base,foreground,transport)
 for(const url of ['https://foreign.test'+a,'/listen/library.json','blob:https://appassets.androidplatform.net/a',`/api/analysis-lab/media/${hash}`])await fetcher(url)
 await nativeAudioPriorityFetch(new URL('https://8.136.120.255/'),foreground,transport)(a)
 expect(foreground).not.toHaveBeenCalled();for(const call of transport.mock.calls)expect((call as unknown[])[1]).toBeUndefined()
})
it('preserves Request headers while overriding a stale purpose after a handoff',async()=>{
 const transport=vi.fn(async()=>new Response()),fetcher=nativeAudioPriorityFetch(base,()=>true,transport),request=new Request(new URL(a,base),{headers:{'X-Existing':'request','X-HarBeat-Audio-Purpose':'prepare'}})
 await fetcher(request,{headers:{'X-Init':'init'}})
 const headers=new Headers((transport.mock.calls[0] as unknown as [Request,RequestInit])[1].headers)
 expect(headers.get('X-Existing')).toBe('request');expect(headers.get('X-Init')).toBe('init');expect(headers.get('X-HarBeat-Audio-Purpose')).toBe('playback')
})
it('uses active and incoming deck segments dynamically and restores fetch on disposal',async()=>{
 const {ListenTransport}=await import('./listen-transport');vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 const gain=()=>({gain:{value:1},connect:vi.fn(),disconnect:vi.fn()})
 vi.stubGlobal('AudioContext',class{sampleRate=44100;currentTime=0;destination={};createGain=gain;close=async()=>{}})
 const previous=globalThis.fetch,transport=vi.fn(async()=>new Response());vi.stubGlobal('fetch',transport)
 const p=new ListenTransport([],()=>{},base),track=(id:string)=>({id,native:{url:`/listen/media/${id}.flac`,sha256:hash,duration:30},audioSegments:[{start:0,end:30,asset:{url:`/listen/media/${id}.flac`,sha256:hash,duration:30}}]})
 const request=(id:string)=>globalThis.fetch(new URL(`/listen/media/${id}.flac?sha256=${hash}`,base))
 try{
  p.active={track:track('a')} as any;p.pending={deck:{track:track('b')}} as any
  await request('a');await request('b');await request('c')
  p.active={track:track('b')} as any;p.pending=null;await request('a');await request('b')
  expect(transport.mock.calls.map(call=>new Headers((call as unknown as [URL,RequestInit])[1].headers).get('X-HarBeat-Audio-Purpose'))).toEqual(['playback','playback','prepare','prepare','playback'])
 }finally{p.active=null;p.pending=null;p.dispose();expect(globalThis.fetch).toBe(transport);vi.unstubAllGlobals();vi.useRealTimers();expect(globalThis.fetch).toBe(previous)}
})
