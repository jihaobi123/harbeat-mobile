import {it,expect} from 'vitest'
import {selectSessionBatch} from './listen-selection'
const rows=()=>Array.from({length:12},(_,i)=>({id:String(i).padStart(2,'0'),title:String(i),bpm:98,duration:240,collection:'web',styleLabels:['Hip-Hop'],detailUrl:i+'.json',playStatus:'ready',mixStatus:'ready'})) as any[]
it('brings a prepared scene target into the batch without bypassing style or unplayed selection',()=>{const tracks=rows(),batch=selectSessionBatch(tracks,tracks[0],new Map([['00',1]]),[],new Set(),{style:'Hip-Hop'},new Set(),new Set(['11']));expect(batch.ids[0]).toBe('11');expect(batch.ids).toHaveLength(8);tracks[11].styleLabels=['KPOP'];expect(selectSessionBatch(tracks,tracks[0],new Map([['00',1]]),[],new Set(),{style:'Hip-Hop'},new Set(),new Set(['11'])).ids).not.toContain('11')})
it('does not repeat a played longmix target while other compatible fresh music remains',()=>{const tracks=rows();expect(selectSessionBatch(tracks,tracks[0],new Map([['00',1],['11',1]]),[],new Set(),{},new Set(),new Set(['11'])).ids).not.toContain('11')})
it('does not give every other song from a reference set a collection bonus',()=>{
 const tracks=rows(),ordinary=tracks[1],otherSetTrack=tracks[2]
 tracks[0].collection=otherSetTrack.collection='Bassment FM'
 tracks[0].referenceSet=otherSetTrack.referenceSet='bassmentfm'
 otherSetTrack.bpm=99
 const batch=selectSessionBatch(tracks.slice(0,3),tracks[0],new Map(),[],new Set())
 expect(batch.ids).toEqual([ordinary.id,otherSetTrack.id])
})
