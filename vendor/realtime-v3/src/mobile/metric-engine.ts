import {MetricRun,loadMetricIndex} from './metric'
import type {Host} from './session'
import {MetricTransport} from './device-transport'

// Android exposes the APK-only bridge. Web embeds this same engine in a
// same-origin frame, bound to the parent with an origin and per-frame nonce.
const origin=location.origin,webHost=!window.HarBeatEngineHost,token=location.hash.slice(1)
if(webHost){
 window.HarBeatEngineHost={state:json=>parent.postMessage(JSON.stringify({harbeat:'metric-state',token,json}),origin),reply:(id,json)=>parent.postMessage(JSON.stringify({harbeat:'metric-reply',token,id,json}),origin)}
 window.HarBeatHost={requestFocus:()=>true,close:()=>{},saveSession:()=>{},exportLog:(text,format)=>{parent.postMessage(JSON.stringify({harbeat:'metric-export',token,text,format}),origin)}}
}
let run:MetricRun|null=null,ready=true,error=''
const info=(t:any)=>t?{id:t.id,title:t.title,bpm:t.bpm,style:t.style??'待确认',duration:t.duration,collection:t.collection,styleLabels:t.styleLabels,playStatus:t.playStatus,mixStatus:t.mixStatus}:null
function snapshot(){const p=run?.player,t=p?.transition,q=p?.continuation;return {ready,error:error||run?.error||'',playing:p?.playing||false,paused:p?.paused||false,busy:p?.busy||false,buffering:p?.buffering||false,current:info(p?.current),position:p?.position||0,duration:p?.current?.duration||0,status:run?.working?run.notice:p?.status||run?.notice||'智能分轨已就绪',pending:t?{title:t.b.title,remaining:Math.max(0,t.end-p!.ctx.currentTime),locked:true}:q?{title:q.track.title,remaining:Math.max(0,q.at-p!.ctx.currentTime),locked:true,kind:'sequential'}:null,
 audioHealth:p?.logs.filter(e=>e.kind==='audio_health').slice(-1)[0]??null,metric:run?.snapshot()||{},cacheMB:p?.cache.sizeMB||0,observations:p?.logs.filter(e=>e.kind==='audio_observation').slice(-3)||[],logCount:p?.logs.length||0}}
function publish(){window.HarBeatEngineHost.state(JSON.stringify(snapshot()))}
window.addEventListener('harbeat-host',event=>{if(!(event as CustomEvent).detail?.active)run?.pauseForHost((event as CustomEvent).detail?.reason??'host-inactive')})
document.addEventListener('visibilitychange',()=>{if(document.hidden)run?.pauseForHost('document-hidden')})
window.addEventListener('pagehide',()=>run?.pauseForHost('page-hidden'))
window.HarBeatEngine={async dispatch({id,method,args}){try{
 error=''
 if(method==='prepare'){run?.dispose();const base=new URL('/listen/',location.href);run=new MetricRun(await loadMetricIndex(base),base,publish,window.HarBeatHost as Host,(_base,changed)=>new MetricTransport(new URL('.',location.href),changed))}
 else{
  if(!run)throw Error('请先开启智能分轨混音')
  switch(method){
   case 'setSession':await run.setSession(args.manifest,String(args.name??''));break
   case 'clearSet':run.clearSet();break
   case 'cacheSet':void run.cacheSet(args.manifest).catch(e=>{if((e as Error).name!=='AbortError')error=(e as Error).message;publish()});break
   case 'refreshLibrary':await run.refreshLibrary();break
   case 'start':await run.start(String(args.trackId));break
   case 'select':run.choose(String(args.trackId));break
   case 'metricPrepare':await run.prepare();break
   case 'mixSoon':await run.mixSoon();break
   case 'metricMethod':run.selectMethod(args.method);break
   case 'metricApply':await run.apply(args.audition===true);break
   case 'pause':run.pause();break
   case 'resume':await run.resume();break
   case 'seek':await run.seek(Number(args.position));break
   case 'stop':run.stop();break
   case 'cancel':run.cancel();break
   case 'volume':run.setVolume(Number(args.value));break
   case 'filters':run.filters(args);break
   case 'direction':run.direction(args);break
   case 'recommend':run.requestNext();break
   case 'request':if(args.intent?.kind!=='next')throw Error('请选择目标风格和能量');run.requestNext();break
   case 'export':window.HarBeatHost?.exportLog(JSON.stringify(run.export(),null,2),'json');break
   default:throw Error('智能分轨不支持此操作')
  }
 }
 publish();window.HarBeatEngineHost.reply(id,JSON.stringify({ok:true,state:snapshot(),...(['prepare','refreshLibrary'].includes(method)?{tracks:run!.index.tracks.map(info)}:{})}))
 }catch(e){error=(e as Error).message;publish();window.HarBeatEngineHost.reply(id,JSON.stringify({ok:false,error}))}}}
if(webHost)window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==origin||typeof event.data!=='string')return;let data;try{data=JSON.parse(event.data)}catch{return}if(data?.token!==token)return;if(data?.harbeat==='metric-command'&&Number.isInteger(data.id)&&typeof data.method==='string')void window.HarBeatEngine.dispatch({id:data.id,method:data.method,args:data.args??{}});else if(data?.harbeat==='metric-lifecycle'&&!data.active)run?.pauseForHost('web-host-inactive')})
setInterval(()=>{run?.tick();publish()},250)
publish()
