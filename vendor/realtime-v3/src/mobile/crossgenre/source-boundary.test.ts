import {it,expect,vi} from 'vitest'
import {protectSourceBoundary} from './source-boundary'

it('does not buffer for an A chunk after its scheduled crossgenre exit',()=>{
 const stream={deadline:22,coveredSourceEnd:32,pump:vi.fn(),dispose:vi.fn()},deck={stream} as any
 const restore=protectSourceBoundary(deck,22)
 expect(deck.stream.deadline).toBe(Infinity);expect(deck.stream.coveredSourceEnd).toBe(32)
 restore();expect(deck.stream).toBe(stream);expect(deck.stream.deadline).toBe(22)
})
it('keeps a missing chunk before the outgoing exit visible to the existing buffering guard',()=>{
 const stream={deadline:21,coveredSourceEnd:31,pump:vi.fn(),dispose:vi.fn()},deck={stream} as any
 const restore=protectSourceBoundary(deck,22);expect(deck.stream.deadline).toBe(21);deck.stream.pump();expect(stream.pump).toHaveBeenCalled();restore()
})

import {SegmentScheduler} from '../../listen-upstream/continuous/segments'
import {LiveTransport} from '../../listen-upstream/realtime/transport'
it('passes the pinned transport buffering check at an actual segment boundary scheduled for A exit',()=>{
 const asset=(id:string)=>({url:id,sha256:'a'.repeat(64),bytes:20,duration:10})
 const first=asset('first'),next=asset('next'),track:any={id:'a',duration:20,native:first,audioSegments:[{start:0,end:10,asset:first},{start:10,end:20,asset:next}]}
 const ctx={currentTime:9.6,suspend:vi.fn(async()=>{})},io={now:()=>ctx.currentTime,load:vi.fn(()=>new Promise<any>(()=>{})),schedule:vi.fn(()=>vi.fn()),changed:vi.fn()}
 const stream=new SegmentScheduler(track,0,0,io);stream.begin({} as AudioBuffer)
 expect(stream.deadline).toBe(10)
 const deck:any={track,stream},host:any={active:deck,pending:null,ctx,protected:vi.fn(),buffering:false,status:'',log:vi.fn(),update:vi.fn(),starting:0}
 const restore=protectSourceBoundary(deck,10)
 ;(LiveTransport.prototype as any).checkSegments.call(host)
 expect(ctx.suspend).not.toHaveBeenCalled();expect(host.buffering).toBe(false)
 restore();stream.dispose()
})
