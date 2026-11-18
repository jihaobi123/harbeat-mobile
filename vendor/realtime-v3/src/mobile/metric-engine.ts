import {ListenRun as MetricRun,loadListenIndex as loadMetricIndex} from './listen'
import type {Host} from './session'
import {ListenTransport} from './listen-transport'
import {ReferenceRun} from './dj-reference/session'
import {overlapSourcePosition} from './deck-progress'

// Android exposes the APK-only bridge. Web embeds this same engine in a
// same-origin frame, bound to the parent with an origin and per-frame nonce.
const origin=location.origin,webHost=!window.HarBeatEngineHost,token=location.hash.slice(1)
if(webHost){
 window.HarBeatEngineHost={state:json=>parent.postMessage(JSON.stringify({harbeat:'metric-state',token,json}),origin),reply:(id,json)=>parent.postMessage(JSON.stringify({harbeat:'metric-reply',token,id,json}),origin)}
 window.HarBeatHost={requestFocus:()=>true,close:()=>{},saveSession:()=>{},exportLog:(text,format)=>{parent.postMessage(JSON.stringify({harbeat:'metric-export',token,text,format}),origin)}}
}
let run:MetricRun|null=null,dj:ReferenceRun|null=null,ready=true,error='',generation=0
const info=(t:any)=>t?{id:t.id,title:t.title,bpm:t.bpm,style:t.style??'待确认',duration:t.duration,collection:t.collection,coverPath:t.coverPath,styleLabels:t.styleLabels,playStatus:t.playStatus,mixStatus:t.mixStatus,mixReadiness:t.mixReadiness}:null
function deckState(p:MetricRun['player']){
 const transition=p?.pending??p?.crossGenrePending??p?.liveLayeringPending
 const live=p?.liveLayeringPending,cross=p?.crossGenrePending
 const track=transition===live&&live?p?.tracks.find(t=>t.id===live.attachedTrackId):transition?.deck.track
 const now=p?.ctx.currentTime??0,playing=p?.playing===true
 // A native cut or bridge starts B at takeover. The overlap graphs start B at mix-in.
 const incomingStart=transition&&transition===cross?transition.end:transition?.start??Infinity
 const outgoingEnd=transition&&transition===cross&&cross?.plan.bridge
  ?cross.end-cross.plan.bridge.ramp.duration:transition?.end??Infinity
 let position=0
 if(p?.pending)position=overlapSourcePosition(now,p.pending)
 else if(cross)position=cross.plan.entry+Math.max(0,now-cross.end)
 else if(live){
  const scene=live.prepared.approval.scene
  position=scene.clips.bStart+Math.max(0,now-live.start)*scene.rate
 }
 return {primaryPlaying:playing&&now<outgoingEnd,incoming:track?{track:info(track),playing:playing&&now>=incomingStart,position}:null}
}
function snapshot(){if(dj){const state=dj.snapshot();return {...state,ready:true,mode:'dj-reference',metric:{djReference:true},djReference:state,error:error||state.error}}const p=run?.player,t=p?.pending??p?.crossGenrePending??p?.liveLayeringPending??p?.loopExtensionPending;return {performance:p?.performance??{supported:false},ready,error:error||run?.error||'',playing:p?.playing||false,paused:p?.paused||false,busy:p?.busy||false,buffering:p?.buffering||false,current:info(p?.current),decks:deckState(p??null),position:p?.position||0,duration:p?.current?.duration||0,status:run?.working?run.notice:p?.status||run?.notice||'手机混音已就绪',pending:t?{role:p?.pending?.plan.window.role,title:p?.liveLayeringPending===t&&p.liveLayeringStatus.outcome==='return-a'?`临时加入 ${p.tracks.find(b=>b.id===p.liveLayeringPending?.attachedTrackId)?.title??''}，随后回原曲`:p!.tracks.find(b=>b.id===t.plan.to)?.title??'',remaining:Math.max(0,t.end-p!.ctx.currentTime),locked:p!.gate.locked}:null,
 audioHealth:p?.logs.filter(e=>e.kind==='audio_health').slice(-1)[0]??null,metric:{...run?.snapshot(),orderedSet:run?.orderedSetStatus,autoPreparation:run?.autoPreparationStatus},cacheMB:p?.cache.sizeMB||0,observations:p?.logs.filter(e=>e.kind==='audio_observation').slice(-3)||[],logCount:p?.logs.length||0}}
function publish(){window.HarBeatEngineHost.state(JSON.stringify(snapshot()))}
function pauseDJ(reason:string){void dj?.pause(reason)}
window.addEventListener('harbeat-host',event=>{if(!(event as CustomEvent).detail?.active){run?.pauseForHost((event as CustomEvent).detail?.reason??'host-inactive');pauseDJ('host-inactive')}})
document.addEventListener('visibilitychange',()=>{
 if(document.hidden&&!window.HarBeatHost?.supportsBackgroundPlayback?.()){
  run?.pauseForHost('document-hidden');pauseDJ('document-hidden')
 }
})
window.addEventListener('pagehide',()=>{run?.pauseForHost('page-hidden');pauseDJ('page-hidden')})
window.HarBeatEngine={async dispatch({id,method,args}){const referenceCommand=args.mode==='dj-reference'||method.startsWith('dj'),owner=method==='prepare'?++generation:generation;try{
 error=''
 let result={}
 if(method==='prepare'){run?.dispose();run=null;dj?.dispose();dj=null;if(args.mode==='dj-reference'){dj=new ReferenceRun(new URL('.',location.href),publish,window.HarBeatHost);await dj.prepare()}else{const base=new URL('/listen/',location.href);run=new MetricRun(await loadMetricIndex(base),base,publish,window.HarBeatHost as Host,(_base,changed)=>new ListenTransport([],changed,new URL('.',location.href)))}}
 else if(dj){switch(method){case'djSnapshot':dj.tick();break;case'djPlay':await dj.play(args.variant);break;case'djPause':await dj.pause();break;case'djResume':await dj.resume();break;case'djStop':case'stop':dj.stop();break;case'djClose':dj.dispose();dj=null;generation++;break;default:throw Error('DJ 对照不支持此操作')}}
 else{
  if(!run)throw Error('请先开启手机混音')
  switch(method){
   case 'setSession':await run.setSession(args.manifest,String(args.name??''));break
   case 'prepareAutoSet':void run.prepareAutoSet(args.manifest,String(args.name??'')).catch(e=>{error=(e as Error).message;publish()});break
   case 'autoPreparation':run.setAutoPreparationPending(args.pending===true);break
   case 'clearSet':run.clearSet();break
   case 'cacheSet':void run.cacheSet(args.manifest).catch(e=>{if((e as Error).name!=='AbortError')error=(e as Error).message;publish()});break
   case 'refreshLibrary':await run.refreshLibrary();break
   case 'start':await run.start(String(args.trackId));break
   case 'toucanAuditions':result={auditions:await run.toucanAuditions()};break
   case 'startToucanSet':await run.startToucanSet(args.auditionSlot);break
   case 'select':run.choose(String(args.trackId));break
   case 'metricPrepare':await run.prepare();break
   case 'mixSoon':await run.mixSoon();break
   case 'experimentalTransitions':run.setExperimentalTransitions(args.enabled===true);break
   case 'metricMethod':run.selectMethod(args.method);break
   case 'metricApply':await run.apply(args.audition===true);break
   case 'pause':await run.pause();break
   case 'resume':await run.resume();break
   case 'seek':await run.seek(Number(args.position));break
   case 'stop':run.stop();break
   case 'cancel':run.cancel();break
   case 'volume':run.setVolume(Number(args.value));break
   case 'mcMode':if(!run.player)throw Error('请先播放歌曲');run.player.setMC(args.enabled===true);break
   case 'scratch':if(!run.player)throw Error('请先播放歌曲');run.player.scratch();break
   case 'filters':run.filters(args);break
   case 'direction':run.direction(args);break
   case 'loopExtension':await run.setLoopExtension(args.enabled===true,args.cycles===undefined?4:Number(args.cycles));break
   case 'continuousSet':run.setContinuousSet(args.enabled===true);break
   case 'multiLayering':await run.setMultiLayering(args.mode);break
   case 'liveLayering':await run.setLiveLayering(args.enabled===true,args.outcome);break
   case 'recommend':run.requestNext();break
   case 'request':if(args.intent?.kind!=='next')throw Error('请选择目标风格和能量');run.requestNext();break
   case 'export':window.HarBeatHost?.exportLog(JSON.stringify(run.export()),'json');break
   default:throw Error('手机混音不支持此操作')
  }
 }
 publish();window.HarBeatEngineHost.reply(id,JSON.stringify({ok:true,state:snapshot(),...result,...(['prepare','refreshLibrary'].includes(method)?{tracks:run?.catalogEntries().map(info)??[]}:{})}))
 }catch(e){if(referenceCommand&&(owner!==generation||(e as Error).name==='AbortError')){window.HarBeatEngineHost.reply(id,JSON.stringify({ok:false,error:'本次 DJ 准备已取消'}));return}error=(e as Error).message;publish();window.HarBeatEngineHost.reply(id,JSON.stringify({ok:false,error}))}}}
if(webHost)window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==origin||typeof event.data!=='string')return;let data;try{data=JSON.parse(event.data)}catch{return}if(data?.token!==token)return;if(data?.harbeat==='metric-command'&&Number.isInteger(data.id)&&typeof data.method==='string')void window.HarBeatEngine.dispatch({id:data.id,method:data.method,args:data.args??{}});else if(data?.harbeat==='metric-lifecycle'&&!data.active){run?.pauseForHost('web-host-inactive');pauseDJ('web-host-inactive')}})
setInterval(()=>{run?.tick();dj?.tick();publish()},250)
publish()
