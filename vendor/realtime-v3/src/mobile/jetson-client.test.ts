import {afterEach,expect,it,vi} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {requestJetsonPlan,nativeJetsonPlan} from './jetson-client'
import {jetsonFixture} from './jetson-test-fixture'
import {sealJetsonDecision} from './jetson-contract'
const id='f'.repeat(64),a=qualityTrack('a'),b=qualityTrack('b')
const plan:any={id:'pair',from:a.id,to:b.id,start:30,end:38,duration:8,rate:1,window:b.windows[0],asset:b.windows[0].variants.a}
it('requests a new approval when execution versions change under unchanged master provenance',async()=>{
 vi.resetModules();const client=await import('./jetson-client'),f=await jetsonFixture()
 const version=(s:any)=>({manifestSha256:s.manifestSha256,profileSha256:s.profileSha256,stemSha256:s.stemSha256})
 client.rememberJetsonExecutionVersion(f.a.id,version(f.result.sourceProof.a))
 await client.rememberJetsonPlan(f.result,f.a,f.b,f.p)
 const newer=structuredClone(f.result);newer.sourceProof.a.manifestSha256='7'.repeat(64);newer.sourceProof.a.profileSha256='8'.repeat(64)
 const approved=await sealJetsonDecision(newer);client.rememberJetsonExecutionVersion(f.a.id,version(approved.sourceProof.a))
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(approved)));vi.stubGlobal('fetch',fetcher)
 expect(await client.requestJetsonPlan(f.a,f.b,f.p,new URL('https://version.test/'),new AbortController().signal)).toEqual(approved)
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it('a reservation cache miss cannot submit a new Jetson job',async()=>{
 vi.resetModules();const {requestJetsonPlan:request}=await import('./jetson-client')
 const fetcher=vi.fn(async()=>new Response('{}',{status:429}));vi.stubGlobal('fetch',fetcher)
 await expect(request(a,b,plan,new URL('https://cached-only.test/'),new AbortController().signal,undefined,{cachedOnly:true})).rejects.toMatchObject({code:'approval_cache_miss'})
 expect(fetcher).not.toHaveBeenCalled()
})
it('a reservation consumes its exact cached approval without a network request',async()=>{
 vi.resetModules();const {requestJetsonPlan:request,rememberJetsonPlan}=await import('./jetson-client')
 const f=await jetsonFixture(),fetcher=vi.fn(()=>{throw Error('offline')}),hit=vi.fn();vi.stubGlobal('fetch',fetcher)
 await rememberJetsonPlan(f.result,f.a,f.b,f.p)
 expect(await request(f.a,f.b,f.p,new URL('https://cached-only.test/'),new AbortController().signal,()=>0,{cachedOnly:true,onCacheHit:hit})).toEqual(f.result)
 expect(hit).toHaveBeenCalledWith('memory');expect(fetcher).not.toHaveBeenCalled()
})
it('resumes an acknowledged cancelled job by GET instead of spending another POST slot',async()=>{
 vi.resetModules();const {requestJetsonPlan:request}=await import('./jetson-client')
 const f=await jetsonFixture(),calls:string[]=[]
 const fetcher=vi.fn(async(_url:URL|string,init?:RequestInit)=>{calls.push(init?.method??'GET');return new Response(JSON.stringify(init?.method==='POST'?{id:f.result.id,status:'queued'}:f.result))});vi.stubGlobal('fetch',fetcher)
 const controller=new AbortController(),pending=request(f.a,f.b,f.p,new URL('https://resume.test/'),controller.signal,()=>0)
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1))
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
 expect(await request(f.a,f.b,f.p,new URL('https://resume.test/'),new AbortController().signal,()=>0)).toEqual(f.result)
 expect(calls).toEqual(['POST','GET'])
})
it('reports HTML rate limits as a retryable HTTP 429 rather than a parse failure',async()=>{
 vi.resetModules();const {requestJetsonPlan:request}=await import('./jetson-client')
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>Too Many Requests</html>',{status:429,headers:{'Retry-After':'10'}})))
 await expect(request(a,b,plan,new URL('https://limited.test/'),new AbortController().signal)).rejects.toMatchObject({status:429,retryAfterMs:10000})
})
it('spaces uncached submissions and cancels without another POST when the subscriber leaves',async()=>{
 vi.resetModules();const {requestJetsonPlan:request}=await import('./jetson-client')
 vi.useFakeTimers();const fetcher=vi.fn(async()=>new Response(JSON.stringify({detail:'not approved'}),{status:422}));vi.stubGlobal('fetch',fetcher)
 await expect(request(a,b,plan,new URL('https://paced.test/'),new AbortController().signal)).rejects.toThrow()
 const controller=new AbortController(),pending=request(a,b,{...plan,start:40,end:48},new URL('https://paced.test/'),controller.signal)
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
 await vi.advanceTimersByTimeAsync(100);expect(fetcher).toHaveBeenCalledTimes(1)
 controller.abort();await rejected;await vi.advanceTimersByTimeAsync(2500);expect(fetcher).toHaveBeenCalledTimes(1)
})
it('preserves native HTTP status and retry delay for a rejected submission',async()=>{
 const events=new EventTarget();vi.stubGlobal('window',events)
 const host:any={requestPlan:vi.fn((id:number)=>queueMicrotask(()=>events.dispatchEvent(Object.assign(new Event('harbeat-plan-result'),{detail:{id,reply:JSON.stringify({ok:false,error:'策略请求过于频繁',httpStatus:429,retryAfterMs:10000})}}))))}
 await expect(nativeJetsonPlan(host,'{}',new AbortController().signal)).rejects.toMatchObject({status:429,retryAfterMs:10000})
})
it('honors shared Retry-After before submitting a different candidate',async()=>{
 vi.resetModules();const {requestJetsonPlan:request}=await import('./jetson-client')
 vi.useFakeTimers();const fetcher=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'10'}}));vi.stubGlobal('fetch',fetcher)
 const base=new URL('https://cooldown.test/')
 await expect(request(a,b,plan,base,new AbortController().signal)).rejects.toMatchObject({status:429})
 const controller=new AbortController(),pending=request(a,b,{...plan,start:40,end:48},base,controller.signal)
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
 await vi.advanceTimersByTimeAsync(2500);expect(fetcher).toHaveBeenCalledTimes(1)
 controller.abort();await rejected
})
it('recreates an expired acknowledged task with a new ID and validates the new approval',async()=>{
 vi.resetModules();const {requestJetsonPlan:request}=await import('./jetson-client')
 const f=await jetsonFixture(),oldId='9'.repeat(64),calls:string[]=[]
 const fetcher=vi.fn(async(_url:URL|string,init?:RequestInit)=>{
  const method=init?.method??'GET';calls.push(method)
  return calls.length===1?new Response(JSON.stringify({id:oldId,status:'queued'})):method==='GET'?new Response(JSON.stringify({detail:'expired'}),{status:404}):new Response(JSON.stringify(f.result))
 });vi.stubGlobal('fetch',fetcher)
 const controller=new AbortController(),pending=request(f.a,f.b,f.p,new URL('https://recreate.test/'),controller.signal,()=>0)
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1))
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
 expect(await request(f.a,f.b,f.p,new URL('https://recreate.test/'),new AbortController().signal,()=>0)).toEqual(f.result)
 expect(calls).toEqual(['POST','GET','POST'])
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()})
it('submits only a data-plan request and cancels polling when its subscriber leaves',async()=>{
 const fetcher=vi.fn(async(_url:URL|string,_options?:RequestInit)=>new Response(JSON.stringify({id,status:'queued'}),{status:200}));vi.stubGlobal('fetch',fetcher)
 const controller=new AbortController(),pending=requestJetsonPlan(a,b,plan,new URL('https://test.local/'),controller.signal,()=>0)
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalled())
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
 const [url,options]=fetcher.mock.calls[0] as unknown as [URL,RequestInit]
 expect(String(url)).toBe('https://test.local/listen/smart-api/plans')
 expect(options.method).toBe('POST');expect(JSON.parse(String(options.body))).toEqual({from:'a',to:'b',windowId:'w',start:30})
 expect(fetcher.mock.calls.every(([url]:any)=>!String(url).includes('/jobs'))).toBe(true)
})
it('stops awaiting an unready plan when its original source cue expires',async()=>{
 vi.useFakeTimers();let position=20
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id,status:'working'}),{status:200})))
 const pending=requestJetsonPlan(a,b,plan,new URL('https://test.local/'),new AbortController().signal,()=>position)
 const rejected=expect(pending).rejects.toMatchObject({code:'cue_expired'})
 await vi.advanceTimersByTimeAsync(100);position=30
 await vi.advanceTimersByTimeAsync(500);await rejected
})
it('the Android bridge sends a data plan rather than a rendered job and ignores late cancelled replies',async()=>{
 const events=new EventTarget();vi.stubGlobal('window',events)
 const host:any={requestPlan:vi.fn((id:number)=>queueMicrotask(()=>events.dispatchEvent(Object.assign(new Event('harbeat-plan-result'),{detail:{id,reply:JSON.stringify({ok:true,data:{id,status:'queued'}})}})))),requestMetric:vi.fn()}
 expect(await nativeJetsonPlan(host,'{}',new AbortController().signal)).toMatchObject({status:'queued'})
 expect(host.requestMetric).not.toHaveBeenCalled()
 const controller=new AbortController();host.requestPlan.mockImplementation(()=>{})
 const pending=nativeJetsonPlan(host,'{}',controller.signal),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
})
it('validates a ready source-bound decision, then reuses that exact approval without a render request',async()=>{
 const f=await jetsonFixture(),fetcher=vi.fn(async()=>new Response(JSON.stringify(f.result),{status:200}));vi.stubGlobal('fetch',fetcher)
 const base=new URL('https://test.local/'),controller=new AbortController()
 expect(await requestJetsonPlan(f.a,f.b,f.p,base,controller.signal,()=>0)).toEqual(f.result)
 expect(await requestJetsonPlan(f.a,f.b,f.p,base,controller.signal,()=>0)).toEqual(f.result)
 expect(fetcher).toHaveBeenCalledTimes(1)
 const other={...f.a,provenance:{...f.a.provenance,runId:'different-run'}}
 await expect(requestJetsonPlan(other,f.b,f.p,base,controller.signal,()=>0)).rejects.toThrow('来源')
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it('revalidates a persisted approval after a player reload without contacting an unavailable Jetson',async()=>{
 const f=await jetsonFixture();f.a.provenance!.runId='offline-run';f.result.sourceProof.a.runId='offline-run';f.result=await sealJetsonDecision(f.result)
 const entries=new Map<string,{body:string;headers:Headers}>(),cache={put:vi.fn(async(key:string,response:Response)=>{entries.set(String(key),{body:await response.text(),headers:new Headers(response.headers)})}),match:async(key:string|Request)=>{const entry=entries.get(typeof key==='string'?key:key.url);return entry?new Response(entry.body,{headers:entry.headers}):undefined},keys:async()=>[...entries.keys()].map(url=>new Request(url)),delete:async(key:string|Request)=>entries.delete(typeof key==='string'?key:key.url)}
 vi.stubGlobal('caches',{open:async()=>cache})
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(f.result)));vi.stubGlobal('fetch',fetcher)
 const base=new URL('https://test.local/'),signal=new AbortController().signal
 await requestJetsonPlan(f.a,f.b,f.p,base,signal,()=>0)
 await vi.waitFor(()=>expect(cache.put).toHaveBeenCalledTimes(1))
 vi.resetModules();const {requestJetsonPlan:reloaded}=await import('./jetson-client')
 fetcher.mockRejectedValue(Error('Jetson offline'))
 expect(await reloaded(f.a,f.b,f.p,base,signal,()=>0)).toEqual(f.result)
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it('negotiates timelines explicitly and cannot reuse a legacy approval as the new mode result',async()=>{
 vi.resetModules();const client=await import('./jetson-client'),{timelineFixture}=await import('./stem-timeline-fixture'),f=await timelineFixture()
 await client.rememberJetsonPlan(f.result,f.a,f.b,f.p)
 const fetcher=vi.fn(async(_url:any,_init:any)=>new Response(JSON.stringify(f.approval)));vi.stubGlobal('fetch',fetcher)
 const approved=await client.requestJetsonPlan(f.a,f.b,f.p,new URL('https://timeline.test/'),new AbortController().signal,()=>0,{timelineVersion:'stem-timeline-v1'} as any)
 expect(approved.analysisVersion).toBe('jetson-decision-v2');expect(JSON.parse(fetcher.mock.calls[0][1].body as string).stemTimelineVersion).toBe('stem-timeline-v1')
})

it('reads a legacy reservation approval in timeline cache-only mode without posting a new job',async()=>{
 vi.resetModules();const client=await import('./jetson-client'),f=await jetsonFixture(),fetcher=vi.fn(()=>{throw Error('offline')});vi.stubGlobal('fetch',fetcher)
 await client.rememberJetsonPlan(f.result,f.a,f.b,f.p)
 expect(await client.requestJetsonPlan(f.a,f.b,f.p,new URL('https://legacy-reservation.test/'),new AbortController().signal,()=>0,{timelineVersion:'stem-timeline-v1',cachedOnly:true})).toEqual(f.result)
 expect(fetcher).not.toHaveBeenCalled()
})

it('a calibrated reservation cache-only miss can fall back through v2 to a legacy approval without any POST',async()=>{
 vi.resetModules();const client=await import('./jetson-client'),f=await jetsonFixture(),fetcher=vi.fn(()=>{throw Error('offline')});vi.stubGlobal('fetch',fetcher)
 await client.rememberJetsonPlan(f.result,f.a,f.b,f.p)
 expect(await client.requestJetsonPlan(f.a,f.b,f.p,new URL('https://calibrated-reservation.test/'),new AbortController().signal,()=>0,{timelineVersion:'stem-timeline-v2',cachedOnly:true})).toEqual(f.result)
 expect(fetcher).not.toHaveBeenCalled()
})
