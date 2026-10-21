import {afterEach,expect,it,vi} from 'vitest'
import {nearbyResult} from './nearby-result'
const plan:any={from:'a',to:'b',start:10,end:18,duration:8,rate:1,window:{id:'w',start:4,end:12}}
const result=(method='filter'):any=>({id:method,plan:{from:'a',to:'b',start:10,end:18,duration:8,rate:1,bStart:4,bEnd:12,windowId:'w'},decision:{recommended:method,methods:{[method]:{eligible:true}}},assets:{[method]:{url:method}}})
const pending=()=>new Promise<any>(()=>{})
const setup=()=>({plan,position:()=>6,signal:new AbortController().signal,cloud:vi.fn(async(_signal:AbortSignal)=>result()),original:vi.fn(async(_signal:AbortSignal)=>result('original')),load:vi.fn(async()=>{}),event:vi.fn()})
afterEach(()=>vi.useRealTimers())
it('uses the existing non-original decision only after its audio is playable',async()=>{
 const s=setup();let release!:()=>void;s.load.mockImplementation(()=>new Promise<void>(r=>release=r))
 const task=nearbyResult(s);await vi.waitFor(()=>expect(s.load).toHaveBeenCalledTimes(1));release()
 expect((await task).decision.recommended).toBe('filter');expect(s.original).toHaveBeenCalledTimes(1)
})
it('keeps the same local cue when a cloud task remains unready',async()=>{
 vi.useFakeTimers();const s=setup();s.cloud.mockImplementation(pending)
 const task=nearbyResult(s);await vi.advanceTimersByTimeAsync(2001)
 expect((await task).decision.recommended).toBe('original');expect(s.cloud.mock.calls[0][0].aborted).toBe(true)
})
it('does not mistake a server result with a stalled download for playable stems',async()=>{
 vi.useFakeTimers();const s=setup();s.load.mockImplementation(pending)
 const task=nearbyResult(s);await vi.advanceTimersByTimeAsync(2001)
 expect((await task).decision.recommended).toBe('original');expect(s.event).toHaveBeenCalledWith('nearby_original_fallback',expect.objectContaining({stage:'downloading'}))
})
it('does not submit cold work when there is no scheduling budget',async()=>{
 const s=setup();s.position=()=>9.4
 expect((await nearbyResult(s)).decision.recommended).toBe('original');expect(s.cloud).not.toHaveBeenCalled()
})
it('rejects a late result for a different B entry even at the same A start',async()=>{
 const s=setup();s.cloud.mockResolvedValue({...result(),plan:{...result().plan,bStart:20,bEnd:28}})
 expect((await nearbyResult(s)).decision.recommended).toBe('original');expect(s.load).not.toHaveBeenCalled()
})
it('cancels both preparations on a superseding direction and ignores late completions',async()=>{
 const s=setup(),controller=new AbortController();s.signal=controller.signal;s.cloud.mockImplementation(pending);s.original.mockImplementation(pending)
 const task=nearbyResult(s),rejected=expect(task).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
 expect(s.cloud.mock.calls[0][0].aborted).toBe(true);expect(s.original.mock.calls[0][0].aborted).toBe(true)
})
