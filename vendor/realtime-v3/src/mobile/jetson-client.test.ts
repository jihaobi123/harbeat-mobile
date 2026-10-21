import {afterEach,expect,it,vi} from 'vitest'
import {qualityTrack} from '../metric-upstream/continuous/qualityFixture'
import {requestJetsonPlan,nativeJetsonPlan} from './jetson-client'
import {jetsonFixture} from './jetson-test-fixture'
import {sealJetsonDecision} from './jetson-contract'
const id='f'.repeat(64),a=qualityTrack('a'),b=qualityTrack('b')
const plan:any={id:'pair',from:a.id,to:b.id,start:30,end:38,duration:8,rate:1,window:b.windows[0],asset:b.windows[0].variants.a}
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
