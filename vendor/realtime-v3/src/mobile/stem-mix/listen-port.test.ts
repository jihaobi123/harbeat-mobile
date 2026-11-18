import {it,expect,vi} from 'vitest'
import {StemExecution} from './listen-port'
import {jetsonFixture} from '../jetson-test-fixture'
class Param{cancelScheduledValues=vi.fn();value=0;events:any[]=[];setValueAtTime(v:number,t:number){this.events.push(['set',v,t]);return this}linearRampToValueAtTime(v:number,t:number){this.events.push(['ramp',v,t]);return this}}
class Node{gain=new Param();connect=vi.fn();disconnect=vi.fn();stop=vi.fn()}
async function setup(){
 const f=await jetsonFixture(),ctx:any={currentTime:0,sampleRate:44100,createGain:()=>new Node()},a:any={track:f.a,at:0,offset:0,gain:new Node(),sources:[new Node()],stream:{deadline:80,dispose:vi.fn()},nodes:[new Node()]},b:any={track:f.b,gain:new Node(),sources:[],nodes:[new Node()]}
 const pending:any={...f.result,schema:'harbeat.device-execution-plan.v1',execution:{schema:'harbeat.device-execution-plan.v1',plan:f.p},decision:{...f.result.decision,recommended:'bass'}}
 const graph={entry:new Node(),nodes:[new Node()]},cache:any={buffers:new Map([[f.b.native.url,{}]])},host:any={ctx,cache,active:a,tracks:[f.a,f.b],pending:null,lastPlan:null,position:0,playing:true,gate:{locked:false},monitor:{port:{postMessage:vi.fn()}},log:vi.fn(),graph:vi.fn(()=>b),nativeSource:vi.fn(),retire:vi.fn(),protected:vi.fn(),schedule:vi.fn(),cancelScheduled:vi.fn(function(this:any){this.pending=null})}
 const original=host.schedule,pool:any={ready:vi.fn(()=>pending)},release=vi.fn(),port=new StemExecution(host,pool,vi.fn(),{graph:vi.fn(()=>graph) as any,pcm:()=>({a:{},b:{}} as any),pin:()=>release})
 return{...f,ctx,a,b,graph,host,original,pool,port,release}
}
it('schedules the approved method through a truthful base pending with complementary 8ms native takeover',async()=>{
 const f=await setup();f.host.schedule(f.p,0,{kind:'next'},'request',{candidates:[f.p]})
 expect(f.original).not.toHaveBeenCalled();expect(f.host.pending.plan).toBe(f.p);expect(f.host.pending.requestId).toBe('request')
 expect(f.port.method).toBe('bass');expect(f.host.nativeSource).toHaveBeenCalledWith(f.b,expect.anything(),f.p.end,f.p.window.end,false)
 expect(f.host.status).toContain('已安排')
 expect(f.b.gain.gain.events).toContainEqual(['ramp',.76,f.p.end+.008])
 expect(f.a.gain.gain.events).toContainEqual(['ramp',0,f.p.start+.004])
 expect(f.graph.entry.gain.events).toContainEqual(['ramp',1,f.p.start+.004]);f.port.dispose()
})
it('retires native B and restores A before forwarding a failed post-install schedule',async()=>{
 const f=await setup();f.host.protected.mockImplementationOnce(()=>{throw Error('injected post-install failure')})
 f.host.schedule(f.p,0,{kind:'next'},'request',{})
 expect(f.host.retire).toHaveBeenCalledWith(f.b,false);expect(f.original).toHaveBeenCalledTimes(1)
 expect(f.host.pending).toBeNull();expect(f.release).toHaveBeenCalledTimes(1);f.port.dispose()
})
it('forwards unmatched actual automatic backup plans without borrowing a prepared method',async()=>{
 const f=await setup();f.pool.ready.mockReturnValue(null);const backup={...f.p,start:f.p.start+2}
 f.host.schedule(backup,0,{kind:'next'},'request',{candidates:[backup]})
 expect(f.original).toHaveBeenCalledWith(backup,0,{kind:'next'},'request',{candidates:[backup]});expect(f.port.method).toBeNull();f.port.dispose()
})
it('stops graph nodes and releases its independent pin when base cancellation occurs',async()=>{
 const f=await setup();f.host.schedule(f.p,0,{kind:'next'},'request',{});f.host.cancelScheduled()
 expect(f.graph.nodes[0].stop).toHaveBeenCalled();expect(f.graph.entry.disconnect).toHaveBeenCalled();expect(f.release).toHaveBeenCalledTimes(1);expect(f.host.pending).toBeNull();f.port.dispose()
})
it('keeps the scheduled graph through the 8ms native crossfade after base state commits',async()=>{
 const f=await setup();f.host.schedule(f.p,0,{kind:'next'},'request',{});f.host.pending=null;f.host.active=f.b;f.ctx.currentTime=f.p.end+.004;f.port.tick()
 expect(f.release).not.toHaveBeenCalled();f.ctx.currentTime=f.p.end+.012;f.port.tick();expect(f.release).toHaveBeenCalledTimes(1);f.port.dispose()
})
it('executes an explicitly selected eligible method without rewriting the Jetson recommendation',async()=>{
 const f=await setup();f.port.dispose();const r=f.pool.ready();r.decision.methods.filter={...r.decision.methods.bass,eligible:true}
 const graph=vi.fn((..._args:any[])=>f.graph),port=new StemExecution(f.host,f.pool,vi.fn(),{graph:graph as any,pcm:()=>({a:{},b:{}} as any),pin:()=>()=>{}},{method:()=> 'filter',allowOriginal:()=>false})
 f.host.schedule(f.p,0,{kind:'next'},'request',{});expect(port.method).toBe('filter');expect(r.decision.recommended).toBe('bass');expect(graph.mock.calls[0][3]).toBe('filter');port.dispose()
})
it('never silently forwards to gradual when automatic competition loses its prepared PCM',async()=>{
 const f=await setup();f.port.dispose();f.pool.ready.mockReturnValue(null)
 const port=new StemExecution(f.host,f.pool,vi.fn(),undefined,{allowOriginal:()=>false})
 expect(()=>f.host.schedule(f.p,0,{kind:'next'},'request',{})).toThrow(/后备/);expect(f.original).not.toHaveBeenCalled();port.dispose()
})
it('uses the earlier drum lead for native A replacement, pending lock and source coverage',async()=>{
 const f=await setup();f.port.dispose();const graph=vi.fn((..._args:any[])=>f.graph),approval:any={leadSeconds:2,proofSha256:'a'.repeat(64)}
 const port=new StemExecution(f.host,f.pool,vi.fn(),{graph:graph as any,pcm:()=>({a:{},b:{}} as any),pin:()=>()=>{}},{method:()=> 'bass',prelude:()=>approval,allowOriginal:()=>false})
 f.host.schedule(f.p,0,{kind:'next'},'request',{});expect(port.prelude).toBe(true);expect(f.host.pending.start).toBe(f.p.start-2)
 expect(f.a.gain.gain.events).toContainEqual(['ramp',0,f.p.start-2+.004]);expect(graph.mock.calls[0][6]).toEqual({prelude:{approval,enabled:true}})
 f.ctx.currentTime=f.p.start-2+.005;port.tick();expect(f.a.sources[0].stop).toHaveBeenCalled();expect(f.host.nativeSource.mock.calls[0][2]).toBe(f.p.end);port.dispose()
})
