import {it,expect,vi,afterEach} from 'vitest'
import {ListenTransport} from '../listen-transport'
import {LiveTransport} from '../../listen-upstream/realtime/transport'
import {selectSessionBatch} from '../listen-selection'
import {fixture} from './fixtures'
afterEach(()=>vi.restoreAllMocks())

function transport(){const a=fixture(),b=fixture('b',129.7),p=Object.create(ListenTransport.prototype) as any;p.active={track:a.track,at:0,offset:0};p.tracks=[a.track,b.track];p.learnedPairs=new Map();p.ctx={currentTime:20,state:'running'};p.paused=false;p.gate={revision:0,locked:false};p.pending=null;p.busy=false;p.creativeRequestRevision=0;p.competition={prepare:vi.fn(async()=> 'b'),request:vi.fn(async()=>{}),cancel:vi.fn(),clearActive:vi.fn()};p.cancelPreparation=vi.fn();p.crossSession={pending:null,cancelPreparation:vi.fn()};p.log=vi.fn();p.notify=vi.fn();return p}
it('delegates preparation to unified competition even when old gradual preparation would succeed',async()=>{
 const p=transport(),original=vi.spyOn(LiveTransport.prototype,'prepareAutomatic').mockResolvedValue('b')
 expect(await p.prepareAutomatic(['b'])).toBe('b');expect(p.competition.prepare).toHaveBeenCalledWith(['b'],true);expect(original).not.toHaveBeenCalled()
})
it('propagates cancelled common preparation without starting another family',async()=>{
 const p=transport();p.competition.prepare.mockRejectedValue(new DOMException('cancelled','AbortError'))
 await expect(p.prepareAutomatic(['b'])).rejects.toMatchObject({name:'AbortError'});expect(p.competition.request).not.toHaveBeenCalled()
})
it('requests an exact common winner without first scheduling old gradual',async()=>{
 const p=transport(),original=vi.spyOn(LiveTransport.prototype,'request').mockResolvedValue(undefined)
 await p.request({kind:'next',targetId:'b'},18,{origin:'mobile_user'})
 expect(p.competition.request).toHaveBeenCalledWith('b',18,false);expect(original).not.toHaveBeenCalled()
})
it('admits an explicitly requested distant tempo only with published family coverage',()=>{
 const row=(id:string,bpm:number)=>({id,title:id,bpm,duration:240,collection:'web',style:'House',styleLabels:['House'],detailUrl:id+'.json',playStatus:'ready',mixStatus:'ready'} as const)
 const a=row('a',95),b=row('b',129.7)
 expect(selectSessionBatch([a,b] as any,a as any,new Map(),[],new Set(),{targetId:'b'}).ids).toEqual([])
 expect(selectSessionBatch([a,b] as any,a as any,new Map(),[],new Set(),{targetId:'b'},new Set(['b'])).ids).toEqual(['b'])
})
it('keeps unplayed coverage before repeating a compatible song',()=>{
 const row=(id:string,bpm:number)=>({id,title:id,bpm,duration:240,collection:'web',style:'House',styleLabels:['House'],detailUrl:id+'.json',playStatus:'ready',mixStatus:'ready'} as const)
 const a=row('a',95),old=row('old',96),fresh=row('fresh',129.7)
 const batch=selectSessionBatch([a,old,fresh] as any,a as any,new Map([['a',1],['old',1]]),[],new Set(),{},new Set(['fresh']))
 expect(batch.ids).toEqual(['fresh']);expect(batch.mode).toBe('unplayed')
})

it('keeps a no-winner manual request resolved for the existing bounded extended search',async()=>{
 const p=transport();p.competition.request.mockImplementation(async(_id:string,budget:number)=>{if(budget<30)throw Error('没有合格跨风格接点')})
 await expect(p.request({kind:'next',targetId:'b'},18)).resolves.toBeUndefined();expect(p.status).toContain('跨风格接点')
 await p.request({kind:'next',targetId:'b'},60);expect(p.competition.request).toHaveBeenLastCalledWith('b',60,false)
})
it('does not start another family when native cancellation refuses during the audio-clock lock window',async()=>{
 const p=transport();p.crossSession.pending={start:20.1};p.cancel=vi.fn(()=>false)
 await expect(p.request({kind:'next',targetId:'b'},18)).rejects.toThrow();expect(p.competition.request).not.toHaveBeenCalled()
})
it('cannot change experimental authorization when the pending native graph is already locked',()=>{
 const p=transport();p.cancel=vi.fn(()=>false);p.competition.setExperimental=vi.fn()
 expect(()=>p.setExperimentalTransitions(false)).toThrow();expect(p.competition.setExperimental).not.toHaveBeenCalled()
})
