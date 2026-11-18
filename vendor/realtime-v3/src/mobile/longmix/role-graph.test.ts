import {it,expect,vi} from 'vitest'
import {RoleGraph} from './role-graph'
import {LiveGraph} from './live-graph'
import {roleFixture} from './role-fixture'
import {createLivePort} from './live-port'
import {canonicalJson} from '../jetson-contract'
class Param{calls:any[]=[];value=.76;setValueAtTime(v:number,t:number){this.calls.push(['set',v,t])}linearRampToValueAtTime(v:number,t:number){this.calls.push(['ramp',v,t])}cancelScheduledValues(t:number){this.calls.push(['cancel',t])}}
class Node{gain=new Param();buffer:any;loop=false;starts:any[]=[];stops:any[]=[];connect=vi.fn();disconnect=vi.fn();start(...v:any[]){this.starts.push(v)}stop(...v:any[]){this.stops.push(v)}}
function setup(mode:'roles-c'|'roles-cd'='roles-c'){
 const nodes:Node[]=[],ctx:any={currentTime:10,sampleRate:44100,createGain(){const n=new Node();nodes.push(n);return n},createBufferSource(){const n=new Node();nodes.push(n);return n}},approval=roleFixture(mode),pcm:any={a:{},b:{}}
 for(const l of approval.base.scene.layers)pcm[l.side][l.role]={duration:41}
 const ready:any={approval,buffers:new Map(approval.layers.map((l:any)=>[l.source+':'+l.role,{length:Math.round(l.lengthFrames/l.rate),duration:Math.round(l.lengthFrames/l.rate)/44100,numberOfChannels:2,sampleRate:44100}])),release:vi.fn()},original=new Param()
 return{ctx,nodes,ready,pcm,original}
}
it('replaces only measured B.other/vocals curves while bass, drums, A and the immutable base remain exact',()=>{
 const f=setup('roles-cd'),plain=setup('roles-cd'),before=structuredClone(f.ready.approval.base)
 new LiveGraph(plain.ctx,new Node()as any,plain.ready.approval.base,plain.pcm,plain.original as any,20,()=>{})
 new RoleGraph(f.ctx,new Node()as any,f.ready,f.pcm,f.original as any,20,()=>{})
 const baseGains=f.nodes.filter(n=>!n.starts.length).slice(1,8),plainGains=plain.nodes.filter(n=>!n.starts.length).slice(1)
 f.ready.approval.base.scene.layers.forEach((l:any,i:number)=>{if(l.side!=='b'||!['other','vocals'].includes(l.role))expect(baseGains[i].gain.calls).toEqual(plainGains[i].gain.calls)})
 expect(f.ready.approval.base).toEqual(before)
 for(const role of ['other','vocals']){const i=f.ready.approval.base.scene.layers.findIndex((l:any)=>l.side==='b'&&l.role===role),points=role==='other'?f.ready.approval.bOther:f.ready.approval.bVocals;for(const [j,[t,v]] of points.entries())expect(baseGains[i].gain.calls).toContainEqual([j?'ramp':'set',v*f.ready.approval.base.scene.sourceGains.b,20+t])}
 const extras=f.nodes.filter(n=>n.starts.length).slice(7);expect(extras).toHaveLength(2);expect(extras.every(n=>!n.loop)).toBe(true);expect(extras.map(n=>n.starts[0][0])).toEqual([25,26.25]);expect(extras.map(n=>n.stops[0][0])).toEqual([35,30.25])
 const extraGains=f.nodes.filter(n=>!n.starts.length).slice(8);expect(extraGains[0].gain.calls).toContainEqual(['ramp',.5,25.625]);expect(extraGains[1].gain.calls).toContainEqual(['ramp',.5,26.33])
})
it('C-only changes no vocal envelope and restores its B.other role before every original safe exit',()=>{
 const f=setup(),plain=setup();new LiveGraph(plain.ctx,new Node()as any,plain.ready.approval.base,plain.pcm,plain.original as any,20,()=>{});const g=new RoleGraph(f.ctx,new Node()as any,f.ready,f.pcm,f.original as any,20,()=>{})
 const gains=f.nodes.filter(n=>!n.starts.length).slice(1,8),original=plain.nodes.filter(n=>!n.starts.length).slice(1),i=f.ready.approval.base.scene.layers.findIndex((l:any)=>l.side==='b'&&l.role==='vocals');expect(gains[i].gain.calls).toEqual(original[i].gain.calls)
 for(const exit of f.ready.approval.base.scene.exits){if(exit.at!==g.exit.at)g.setExit(exit);expect(g.exit).toBe(exit);expect(f.ready.approval.bOther.at(-1)).toEqual([40,1])}g.stop()
})
it('keeps one pause clock, approved early exits and original restoration on cancellation',()=>{
 const f=setup(),g=new RoleGraph(f.ctx,new Node()as any,f.ready,f.pcm,f.original as any,20,()=>{}),e=f.ready.approval.base.scene.exits[0]
 f.ctx.currentTime=25;expect(g.position).toBe(5);expect(g.position).toBe(5);g.setExit(e);expect(g.end).toBe(40.008);expect(f.nodes.filter(n=>n.starts.length).at(-1)!.stops[0][0]).toBe(35)
 g.cancel();expect(f.original.calls.slice(-2)).toEqual([['cancel',25],['set',.76,25]]);expect(f.nodes.filter(n=>n.starts.length).every(n=>n.stops.length>1)).toBe(true)
})
it('cannot use replacement envelopes with another AB scene or unprepared extra PCM',()=>{
 const f=setup();f.ready.approval.base.entry.sourcePosition+=1;expect(()=>new RoleGraph(f.ctx,new Node()as any,f.ready,f.pcm,f.original as any,20,()=>{})).toThrow();expect(f.original.calls).toEqual([])
 const x=setup('roles-cd');x.ready.buffers.delete('d:vocals');expect(()=>new RoleGraph(x.ctx,new Node()as any,x.ready,x.pcm,x.original as any,20,()=>{})).toThrow();expect(x.original.calls.slice(-1)).toEqual([['set',.76,10]])
})
it('schedules separately parsed but identical AB exits and maps only the permitted resource subset',()=>{
 for(const mode of ['roles-c','roles-cd'] as const){
  const f=setup(mode),executionBase=f.ready.approval.base,preparedBase=structuredClone(executionBase),exits=[preparedBase.scene.exits[0],preparedBase.scene.exits[2]]
  expect(canonicalJson(preparedBase)).toBe(canonicalJson(executionBase));expect(exits[0]).not.toBe(executionBase.scene.exits[0])
  const host:any={ctx:f.ctx,cache:{pool:{owners:new Set()}},gate:{},monitor:{port:{postMessage:vi.fn()}},log:vi.fn()},port=createLivePort(host,new URL('https://example.test'),vi.fn()),ready:any={approval:preparedBase,exits,pcm:f.pcm,roles:f.ready}
  const graph=port.schedule(ready,{gain:{gain:f.original}}as any,20)
  expect(graph.exit).toBe(executionBase.scene.exits[2]);expect(graph.nextExit()).toBe(executionBase.scene.exits[0]);f.ctx.currentTime=25;graph.setExit(exits[0]);expect(graph.end).toBe(40.008)
  expect(()=>graph.setExit(preparedBase.scene.exits[1])).toThrow();expect(()=>graph.setExit({...exits[0],bPosition:exits[0].bPosition+.1})).toThrow();graph.cancel();port.dispose()
 }
})
it('rejects independently parsed exits whose approved source, fade or measured peak differs before muting A',()=>{
 for(const change of [(e:any)=>e.bPosition+=.1,(e:any)=>e.fadeStart+=.01,(e:any)=>e.peak-=.01]){
  const f=setup(),exit=structuredClone(f.ready.approval.base.scene.exits[0]);change(exit)
  expect(()=>new RoleGraph(f.ctx,new Node()as any,f.ready,f.pcm,f.original as any,20,()=>{},[exit])).toThrow();expect(f.original.calls).toEqual([])
 }
})
