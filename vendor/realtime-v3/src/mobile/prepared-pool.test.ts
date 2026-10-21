import {expect,it,vi} from 'vitest'
import {PreparedPool} from './prepared-pool'
const controller=()=>new AbortController()
it('coalesces background and foreground without letting one cancelled waiter abort the other',async()=>{
 const pool=new PreparedPool<number>(3),warm=controller(),manual=controller();let finish!:(v:number)=>void,inner!:AbortSignal
 const create=vi.fn((signal:AbortSignal)=>{inner=signal;return new Promise<number>(r=>finish=r)})
 const first=pool.get('same',create,warm.signal);const rejected=expect(first).rejects.toMatchObject({name:'AbortError'})
 const second=pool.get('same',create,manual.signal);await Promise.resolve();warm.abort();await rejected
 expect(inner.aborted).toBe(false);finish(7);expect(await second).toBe(7);expect(create).toHaveBeenCalledTimes(1)
 expect(await pool.get('same',create,controller().signal)).toBe(7);expect(create).toHaveBeenCalledTimes(1)
})
it('serializes DSP, discards cancelled generations and bounds retained results',async()=>{
 const dropped:number[]=[],pool=new PreparedPool<number>(2,()=>true,v=>dropped.push(v));let release!:(v:number)=>void
 const first=pool.get('a',()=>new Promise<number>(r=>release=r),controller().signal)
 const secondFactory=vi.fn(async()=>2),second=pool.get('b',secondFactory,controller().signal)
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(secondFactory).not.toHaveBeenCalled();release(1);await first;await second
 await pool.get('c',async()=>3,controller().signal);expect(pool.entries().map(e=>e.value)).toEqual([2,3]);expect(dropped).toEqual([1])
 pool.clear();expect(pool.entries()).toEqual([]);expect(dropped).toEqual([1,2,3])
})
it('recomputes an evicted PCM result and does not retain a late cancelled operation',async()=>{
 let valid=true;const pool=new PreparedPool<number>(3,()=>valid),factory=vi.fn(async()=>1)
 await pool.get('a',factory,controller().signal);valid=false
 await pool.get('a',factory,controller().signal);expect(factory).toHaveBeenCalledTimes(2)
 const cancel=controller();let finish!:(v:number)=>void
 const pending=pool.get('late',()=>new Promise<number>(r=>finish=r),cancel.signal),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));cancel.abort();await rejected;finish(9);await Promise.resolve();await Promise.resolve()
 expect(pool.entries().some(e=>e.key==='late')).toBe(false)
})
