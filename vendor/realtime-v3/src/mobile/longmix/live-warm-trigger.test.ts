import {it,expect,vi} from 'vitest'
import {ListenTransport} from '../listen-transport'
it('begins approved-scene preparation once the ordinary escape is protected, before cold ordinary analysis finishes',async()=>{
 const p:any=Object.create(ListenTransport.prototype);Object.assign(p,{logs:[],ctx:{currentTime:0},sessionId:'test',learnedPairs:new Map(),tracks:[],cancelPreparation:vi.fn(),liveSession:{enabled:true,snapshot:()=>({state:'idle'}),warm:vi.fn(async()=>{})}})
 let finish!:(id:string)=>void;p.competition={prepare:vi.fn(async()=>{p.log('competition_baseline_protected',{start:100});return new Promise<string>(r=>finish=r)})}
 const task=p.prepareAutomatic(['b']);await Promise.resolve();expect(p.liveSession.warm).toHaveBeenCalledWith(['b']);finish('b');await task
})
it('retains the established escape pins while a different ordinary winner is only tentative',()=>{
 const p:any=Object.create(ListenTransport.prototype);Object.assign(p,{logs:[],ctx:{currentTime:0},sessionId:'test',liveBaselineOwner:{protected:new Set(['escape'])},liveSession:{enabled:false}})
 p.log('competition_baseline_protected',{start:100});p.pinLiveGradual([{url:'tentative'}]);expect(p.liveBaselineOwner.protected).toEqual(new Set(['escape','tentative']))
})
