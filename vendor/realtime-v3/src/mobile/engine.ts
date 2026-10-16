import {MobileSession} from './session'
import {decisionReport} from '../realtime/DecisionHistory'
import type {Track,Intent} from '../realtime/planner'
import {DanceRun,validateDanceSet} from './dance'
import {ContinuousRun,loadContinuousIndex} from './continuous'
declare global {interface Window {HarBeatEngineHost:{state:(json:string)=>void;reply:(id:number,json:string)=>void};HarBeatEngine:{dispatch:(message:{id:number;method:string;args:Record<string,any>})=>Promise<void>}}}
let tracks:Track[]=[],session:MobileSession|null=null,ready=false,error=''
let localTracks:Track[]=[],dance:DanceRun|null=null
let continuous:ContinuousRun|null=null
const info=(t:Track)=>({id:t.id,title:t.title,bpm:t.bpm,style:t.style,duration:t.duration})
function snapshot(){const p=session?.player,plan=p?.lastPlan,pending=p?.pending;return {
 ready,error,playing:p?.playing||false,paused:p?.paused||false,busy:p?.busy||continuous?.starting||false,buffering:p?.buffering||false,
 current:p?.current?info(p.current):null,position:p?.position||0,duration:p?.current?.duration||0,
 status:p?.status||'六首素材已就绪，点击开始播放',cacheMB:p?.cache.sizeMB||0,
 pending:pending?{title:tracks.find(t=>t.id===pending.plan.to)?.title,remaining:Math.max(0,pending.end-p!.ctx.currentTime),locked:p!.ctx.currentTime>=pending.start-.15}:null,
 plan:plan?{from:tracks.find(t=>t.id===plan.from)?.title,to:tracks.find(t=>t.id===plan.to)?.title,start:plan.start,end:plan.end,bars:plan.window.bars,rate:plan.rate,midDuck:plan.midDuck,dynamicEq:!!plan.v30Eq,vocalOverlap:!!(plan as any).vocalOverlap,reason:plan.reason}:null,
 observations:p?.logs.filter(e=>e.kind==='audio_observation').slice(-3).map(e=>({name:e.name,deltaMs:e.observationDeltaMs,peak:e.peak}))||[],
 outcome:p?.logs.filter(e=>e.kind==='request_outcome').at(-1)?.outcome||null,
 logCount:p?.logs.length||0,dance:dance?.snapshot()||null,continuous:continuous?.snapshot()||null
}}
function publish(){window.HarBeatEngineHost.state(JSON.stringify(snapshot()))}
window.addEventListener('harbeat-host',(event)=>{if((event as CustomEvent).detail?.active)session?.enterForeground();else{continuous?.pauseForHost();void session?.pauseForHost().catch(e=>{error=e.message;publish()})}})
window.HarBeatEngine={async dispatch({id,method,args}){try{
 if(!session||!ready)throw Error(error||'实时混音引擎尚未准备好')
 error='';const p=session.player
 switch(method){
  case 'prepare':{
   if(continuous)continuous.dispose();else session.dispose()
   continuous=null;dance=null;const base=new URL('.',location.href)
   if(args.mode==='legacy'){tracks=localTracks;session=new MobileSession(tracks,publish,base,window.HarBeatHost)}
   else{const index=await loadContinuousIndex(base);continuous=new ContinuousRun(index,base,publish,window.HarBeatHost);session=continuous.session;tracks=index.tracks.map(t=>({...t,bpm:t.bpm??0,duration:t.duration??0,style:t.style??'待确认'})) as unknown as Track[]}
   break
  }
  case 'configure':{const set=validateDanceSet(args.set);if(continuous)continuous.dispose();else session.dispose();continuous=null;tracks=set.tracks;session=new MobileSession(tracks,publish,new URL('.',location.href),window.HarBeatHost);dance=new DanceRun(set);break}
  case 'start':if(continuous)await continuous.start(args.trackId);else await session.start(args.trackId);break
  case 'pause':if(p?.playing||(p?.buffering&&!p.paused))await session.togglePause();break
  case 'resume':if(p?.paused)await session.togglePause();break
  case 'stop':dance?.stop();if(continuous)continuous.stop();else session.stop();await session.player?.ctx.suspend();break
  case 'seek':if(dance)throw Error('自动舞程按播放时间推进，请使用下一首');if(!p?.pending){if(continuous)await continuous.seek(Number(args.position));else{const paused=p?.paused;await p?.seek(Number(args.position));if(paused&&p?.playing)await session.togglePause()}}else throw Error('请先完成或取消交接，再调整播放位置');break
  case 'select':if(!continuous)throw Error('请先开启连续混音');continuous.choose(String(args.trackId));break
  case 'volume':continuous?.setVolume(Number(args.value));break
  case 'automatic':continuous?.setAutomatic(args.enabled===true);break
  case 'filters':continuous?.filters(args);break
  case 'request':{
   const intent=args.intent as Intent;if(!['next','up','down','style'].includes(intent?.kind))throw Error('不支持的混音方向')
   if(!p?.playing)throw Error('请先开始播放，再调整方向')
   if(continuous){if(intent.kind!=='next')throw Error('连续模式请先选择下一首');await continuous.mix()}else await p.request(intent,[10,18,30].includes(args.budget)?args.budget:30);break
  }
  case 'cancel':if(continuous)continuous.cancel();else p?.cancel();if(p)dance?.postpone(p);break
  case 'export':if(!p)throw Error('还没有混音记录');window.HarBeatHost?.exportLog(args.format==='md'?decisionReport(p.logs,tracks):JSON.stringify(p.export(),null,2),args.format==='md'?'md':'json');break
  default:throw Error('未知播放器操作')
 }
 publish();window.HarBeatEngineHost.reply(id,JSON.stringify({ok:true,state:snapshot(),...(['prepare','configure'].includes(method)?{tracks:tracks.map(t=>({...info(t),...(continuous?{collection:(t as any).collection,styleLabels:(t as any).styleLabels,playStatus:(t as any).playStatus,mixStatus:(t as any).mixStatus}:{} )}))}:{})}))
 }catch(e){error=(e as Error).message;publish();window.HarBeatEngineHost.reply(id,JSON.stringify({ok:false,error}))}}
}
fetch('./catalog.json').then(r=>{if(!r.ok)throw Error('本地曲目目录读取失败');return r.json()}).then(c=>{tracks=localTracks=c.tracks;session=new MobileSession(tracks,publish,new URL('.',location.href),window.HarBeatHost);ready=true;publish()}).catch(e=>{error=e.message;publish()})
setInterval(()=>{if(session?.player){continuous?.tick();const finished=dance?.finished;dance?.tick(session.player);if(!finished&&dance?.finished)session.save();publish()}},250)
