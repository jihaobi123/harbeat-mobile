import {it,expect,vi,afterEach} from 'vitest'
import {ListenTransport} from '../listen-transport'
import {StemPreparation} from './preparation'
import {jetsonFixture} from '../jetson-test-fixture'
vi.mock('../../listen-upstream/realtime/cache',()=>({AudioCache:class{protected=new Set();pool={};sizeMB=0;buffers=new Map();get ready(){return new Set(this.buffers.keys())};async load(a:any){const b={duration:80};this.buffers.set(a.url,b);return b}dispose(){}}}))
vi.mock('../listen-reservation-cache',()=>({ListenReservationAudioCache:class{dispose(){}}}))
vi.mock('../device-prepare',async original=>({...await original<any>(),getDevicePCM:()=>({a:{},b:{}}),pinDevicePCM:()=>()=>{},releaseDevicePCM:()=>{}}))
vi.mock('../device-graph',()=>({scheduleDeviceGraph:(ctx:any)=>({nodes:[],entry:ctx.createGain()})}))
const param=()=>({value:1,cancelAndHoldAtTime(){},cancelScheduledValues(){},setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}})
const node=()=>({gain:param(),frequency:param(),Q:param(),connect(){},disconnect(){},start(){},stop(){}})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()})
it('warms captured production planner results and dispatches the approved graph through the real transport',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 class Context{currentTime=0;state='running';sampleRate=44100;destination=node();audioWorklet={addModule:async()=>{}};createGain=node;createBiquadFilter=node;createBufferSource=node;resume=async()=>{};close=async()=>{};suspend=async()=>{}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',class{port={postMessage:vi.fn()};connect(){};disconnect(){}})
 const f=await jetsonFixture(),prepared=new Map<string,any>(),warm=vi.spyOn(StemPreparation.prototype,'warm').mockImplementation(async p=>{prepared.set(p.id,{...f.result,schema:'harbeat.device-execution-plan.v1',plan:p,execution:{schema:'harbeat.device-execution-plan.v1',plan:p,preparation:'technical-fixture'}} as any)})
 vi.spyOn(StemPreparation.prototype,'assess').mockReturnValue({canPrepare:true,code:'pending',reason:'source-bound fixture'})
 vi.spyOn(StemPreparation.prototype,'ready').mockImplementation(p=>prepared.get(p.id)??null)
 const t=new ListenTransport([f.a,f.b],()=>{},new URL('https://example.test/'),false)
 await t.initialize();t.configureStemMix(null,new URL('https://example.test/'));await t.start(f.a.id)
 await t.prepareAutomatic([f.b.id]);expect(warm).toHaveBeenCalled();expect(t.logs.some(e=>e.kind==='competition_prepared')).toBe(true)
 await t.request({kind:'next',targetId:f.b.id},18,{automatic:true})
 expect(t.logs.find(e=>e.kind==='stem_plan_scheduled')?.method,JSON.stringify(t.logs.slice(-6))).toBe('bass');expect(t.pending?.deck.track.id).toBe(f.b.id)
 expect(t.stemComparison(f.b.id).recommended).toBe('bass');expect(t.status).toContain('已安排');t.cancel();t.dispose()
})

it('schedules a real automatic dual-deck gradual handoff when source-bound stems are unpublished',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 class Context{currentTime=0;state='running';sampleRate=44100;destination=node();audioWorklet={addModule:async()=>{}};createGain=node;createBiquadFilter=node;createBufferSource=node;resume=async()=>{};close=async()=>{};suspend=async()=>{}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',class{port={postMessage:vi.fn()};connect(){};disconnect(){}})
 const f=await jetsonFixture(),t=new ListenTransport([f.a,f.b],()=>{},new URL('https://example.test/'),false)
 await t.initialize();t.configureStemMix(null,new URL('https://example.test/'));await t.start(f.a.id)
 await t.prepareAutomatic([f.b.id]);const cue=t.upcomingPlan!
 expect(t.stemComparison(f.b.id).state).toBe('fallback-ready');expect(t.automaticStart).toBe(cue.start);expect(cue.end).toBeGreaterThanOrEqual(40)
 ;(t.ctx as unknown as Context).currentTime=cue.start-8
 await t.request({kind:'next',targetId:f.b.id},18,{automatic:true})
 expect(t.pending?.plan.start,JSON.stringify(t.logs.slice(-5))).toBe(cue.start);expect(t.pending?.automatic).toBe(true)
 expect(t.logs.some(e=>e.kind==='plan_scheduled')).toBe(true);expect(t.logs.some(e=>e.kind==='stem_plan_scheduled')).toBe(false);t.cancel();t.dispose()
})

it('selects the Jetson arrangement in the real automatic transport and preserves its role timelines',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 class Context{currentTime=0;state='running';sampleRate=44100;destination=node();audioWorklet={addModule:async()=>{}};createGain=node;createBiquadFilter=node;createBufferSource=node;resume=async()=>{};close=async()=>{};suspend=async()=>{}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',class{port={postMessage:vi.fn()};connect(){};disconnect(){}})
 const {timelineFixture}=await import('../stem-timeline-fixture'),f=await timelineFixture(),prepared=new Map<string,any>()
 vi.spyOn(StemPreparation.prototype,'assess').mockReturnValue({canPrepare:true,code:'pending',reason:'source-bound technical fixture'})
 vi.spyOn(StemPreparation.prototype,'warm').mockImplementation(async p=>{if(p.duration===f.p.duration)prepared.set(p.id,{...f.result,schema:'harbeat.device-execution-plan.v1',plan:p,execution:{schema:'harbeat.device-execution-plan.v1',plan:p,arrangement:f.arrangement,preparation:'technical-fixture'}} as any)})
 vi.spyOn(StemPreparation.prototype,'ready').mockImplementation(p=>prepared.get(p.id)??null)
 const t=new ListenTransport([f.a,f.b],()=>{},new URL('https://example.test/'),false)
 await t.initialize();t.configureStemMix(null,new URL('https://example.test/'));await t.start(f.a.id)
 await t.prepareAutomatic([f.b.id]);await t.request({kind:'next',targetId:f.b.id},18,{automatic:true})
 const log=t.logs.find(e=>e.kind==='stem_plan_scheduled')
 expect(log?.method,JSON.stringify(t.logs.slice(-6))).toBe('stem-handover');expect(log?.timeline).toEqual(f.arrangement.timeline)
 expect(log?.processedEvidence).toEqual(f.arrangement.evidence);expect(t.pending?.deck.track.id).toBe(f.b.id);t.cancel();t.dispose()
})

it.each([true,false])('keeps a prepared half-track cue when the automatic late-region preference changes (stems=%s)',async(stems)=>{
 vi.useFakeTimers();vi.stubGlobal('window',globalThis)
 class Context{currentTime=0;state='running';sampleRate=44100;destination=node();audioWorklet={addModule:async()=>{}};createGain=node;createBiquadFilter=node;createBufferSource=node;resume=async()=>{};close=async()=>{};suspend=async()=>{}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',class{port={postMessage:vi.fn()};connect(){};disconnect(){}})
 const f=await jetsonFixture(),{buildV30Eq}=await import('../../listen-upstream/v30/eq'),p={...f.p,id:`${f.a.id}:${f.b.id}:${f.p.window.id}:50.000`,start:42,end:50,restore:49};p.v30Eq=buildV30Eq(f.a,f.b,p)
 const prepared=new Map<string,any>()
 vi.spyOn(StemPreparation.prototype,'assess').mockReturnValue({canPrepare:stems,code:stems?'pending':'source-unpublished',reason:'source-bound technical fixture'})
 vi.spyOn(StemPreparation.prototype,'warm').mockImplementation(async plan=>{if(stems)prepared.set(plan.id,{...f.result,schema:'harbeat.device-execution-plan.v1',plan,execution:{schema:'harbeat.device-execution-plan.v1',plan,preparation:'technical-fixture'}} as any)})
 vi.spyOn(StemPreparation.prototype,'ready').mockImplementation(plan=>prepared.get(plan.id)??null)
 const t=new ListenTransport([f.a,f.b],()=>{},new URL('https://example.test/'),false)
 await t.initialize();t.configureStemMix(null,new URL('https://example.test/'));await t.start(f.a.id)
 t.setReservation({strategyVersion:'jetson-decision-v1',preparationPriority:()=>0,approvedCandidates:()=>[{track:f.b,plan:p}]} as any)
 await t.prepareAutomatic([f.b.id]);expect(t.automaticStart).toBe(42)
 ;(t.ctx as unknown as Context).currentTime=34
 await t.request({kind:'next',targetId:f.b.id},18,{automatic:true})
 expect(t.pending?.plan.start,JSON.stringify(t.logs.filter(e=>['request_failed','competition_unavailable'].includes(e.kind)))).toBe(42)
 expect(t.logs.some(e=>e.kind==='stem_plan_scheduled')).toBe(stems);t.cancel();t.dispose()
})
