import {afterEach,expect,it,vi} from 'vitest'

const {pauseForHost,mock}=vi.hoisted(()=>({pauseForHost:vi.fn(),mock:{player:undefined as any}}))
vi.mock('./listen',()=>({
 loadListenIndex:vi.fn(async()=>({})),
 ListenRun:class {
  get player(){return mock.player}
  tick(){}
  snapshot(){return {}}
  catalogEntries(){return []}
  pauseForHost=pauseForHost
 },
}))
vi.mock('./listen-transport',()=>({ListenTransport:class{}}))
vi.mock('./dj-reference/session',()=>({ReferenceRun:class{}}))

afterEach(()=>{
 vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();pauseForHost.mockClear();mock.player=undefined
})

it('publishes deck motion at the actual mix start rather than when the cue is armed',async()=>{
 vi.useFakeTimers()
 const publish=vi.fn()
 vi.stubGlobal('window',Object.assign(new EventTarget(),{
  HarBeatEngineHost:{state:publish,reply:vi.fn()},HarBeatHost:{},
 }))
 vi.stubGlobal('document',new EventTarget())
 vi.stubGlobal('location',new URL('https://appassets.androidplatform.net'))
 const a={id:'a',title:'First'},b={id:'b',title:'Second'}
 const p:any=mock.player={current:a,playing:true,ctx:{currentTime:9.9},pending:{deck:{track:b},plan:{to:'b',duration:5,window:{start:20,end:25.5}},start:10,end:15},tracks:[a,b],gate:{locked:true},logs:[],cache:{}}
 await import('./metric-engine')
 await window.HarBeatEngine.dispatch({id:1,method:'prepare',args:{}})
 const snapshot=()=>{vi.advanceTimersByTime(250);return JSON.parse(publish.mock.lastCall![0]).decks}
 expect(snapshot()).toMatchObject({primaryPlaying:true,incoming:{track:{id:'b'},playing:false,position:20}})
 p.ctx.currentTime=11
 expect(snapshot()).toMatchObject({primaryPlaying:true,incoming:{track:{id:'b'},playing:true,position:21.1}})
 p.pending.plan={to:'b',duration:0,window:{start:0,end:0,role:'native-continuation'}}
 p.pending.start=p.pending.end=15
 expect(snapshot()).toMatchObject({incoming:{track:{id:'b'},playing:false,position:0}})
 p.playing=false
 expect(snapshot()).toMatchObject({primaryPlaying:false,incoming:{track:{id:'b'},playing:false}})
 p.playing=true;p.ctx.currentTime=15.1;p.current=b;p.pending=null
 expect(snapshot()).toEqual({primaryPlaying:true,incoming:null})
})

it.each([true,false])('keeps native service playback independent of document visibility (%s)',async background=>{
 vi.useFakeTimers()
 const host=Object.assign(new EventTarget(),{
  HarBeatEngineHost:{state:vi.fn(),reply:vi.fn()},
  HarBeatHost:{supportsBackgroundPlayback:()=>background},
 })
 const document=Object.assign(new EventTarget(),{hidden:true})
 vi.stubGlobal('window',host)
 vi.stubGlobal('document',document)
 vi.stubGlobal('location',new URL('https://appassets.androidplatform.net'))
 await import('./metric-engine')
 await window.HarBeatEngine.dispatch({id:1,method:'prepare',args:{}})
 document.dispatchEvent(new Event('visibilitychange'))
 if(background)expect(pauseForHost).not.toHaveBeenCalled()
 else expect(pauseForHost).toHaveBeenCalledWith('document-hidden')
 pauseForHost.mockClear()
 host.dispatchEvent(new CustomEvent('harbeat-host',{detail:{active:false,reason:'audio-focus:-1'}}))
 expect(pauseForHost).toHaveBeenCalledTimes(1)
 expect(pauseForHost).toHaveBeenCalledWith('audio-focus:-1')
})
