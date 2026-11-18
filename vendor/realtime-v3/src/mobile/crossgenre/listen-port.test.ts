import {it,expect,vi} from 'vitest'
import {ListenReservationAudioCache} from '../listen-reservation-cache'
import {AudioBufferPool} from '../../listen-upstream/realtime/cache'
import {createListenCrossPort} from './listen-port'
import {fixture} from './fixtures'
import {planCrossGenre} from './planner'

it('owns crossgenre cache pins without replacing active and legacy pins',()=>{
 const pool=new AudioBufferPool(),existing:any={protected:new Set(['a.flac']),pool};pool.owners.add(existing)
 const host:any={ctx:{currentTime:5},cache:existing,active:null,gate:{locked:false},tracks:[],log:vi.fn(),status:'',busy:false}
 const port=createListenCrossPort(host,new URL('https://example.test/'),vi.fn())
 expect(port.cache).toBeInstanceOf(ListenReservationAudioCache)
 port.cache.protected=new Set(['b.flac']);expect(host.cache.protected).toEqual(new Set(['a.flac']))
 expect([...pool.owners].flatMap(o=>[...o.protected]).sort()).toEqual(['a.flac','b.flac'])
 port.cache.dispose();expect(host.cache.protected.has('a.flac')).toBe(true);expect(pool.owners.size).toBe(1)
})

it('commits a real native deck without manufacturing a legacy Plan',()=>{
 const a=fixture(),b=fixture('b',129.7),old={track:a.track},next={track:b.track,at:22,offset:16},plan=planCrossGenre(a.track,b.track,a.profile,b.profile,20,18)!
 const host:any={ctx:{currentTime:22.01},cache:{pool:new AudioBufferPool()},active:old,gate:{locked:true},tracks:[a.track,b.track],retire:vi.fn(),protected:vi.fn(),cancelPreparation:vi.fn(),log:vi.fn()}
 const port=createListenCrossPort(host,new URL('https://example.test/'),vi.fn());port.commit(next as any,plan,22)
 expect(host.active).toBe(next);expect(host.retire).toHaveBeenCalledWith(old,false);expect(host.pending).toBeUndefined()
 port.cache.dispose()
})
