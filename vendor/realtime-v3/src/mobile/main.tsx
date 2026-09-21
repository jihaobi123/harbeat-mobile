import React,{useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MobileSession} from './session'
import {decisionReport} from '../realtime/DecisionHistory'
import type {Track,Intent} from '../realtime/planner'
import './mobile.css'
const clock=(v:number)=>`${Math.floor(Math.max(0,v)/60)}:${Math.floor(Math.max(0,v)%60).toString().padStart(2,'0')}`
function MobileLab(){
 const [tracks,setTracks]=useState<Track[]>([]),[selected,setSelected]=useState(''),[target,setTarget]=useState(''),[style,setStyle]=useState('Grime'),[budget,setBudget]=useState(30),[error,setError]=useState(''),[loading,setLoading]=useState(false),[,refresh]=useState(0)
 const session=useRef<MobileSession|null>(null)
 useEffect(()=>{let alive=true;fetch('./catalog.json').then(r=>{if(!r.ok)throw Error('曲目目录读取失败');return r.json()}).then(c=>{if(!alive)return;setTracks(c.tracks);setSelected(c.tracks.find((t:Track)=>t.title==='Big Girls')?.id||c.tracks[0].id);session.current=new MobileSession(c.tracks,()=>refresh(v=>v+1),new URL('.',location.href),window.HarBeatHost)}).catch(e=>setError(e.message));const host=(e:Event)=>{if((e as CustomEvent).detail?.active)session.current?.enterForeground();else void session.current?.pauseForHost().catch(e=>setError(e.message))};const visibility=()=>{if(document.hidden)void session.current?.pauseForHost();else session.current?.enterForeground()};window.addEventListener('harbeat-host',host);document.addEventListener('visibilitychange',visibility);return()=>{alive=false;window.removeEventListener('harbeat-host',host);document.removeEventListener('visibilitychange',visibility);session.current?.dispose()}},[])
 const p=session.current?.player,current=p?.current,pending=p?.pending,position=p?.position||0,plan=p?.lastPlan
 const run=async(fn:()=>Promise<unknown>|void)=>{setError('');try{await fn()}catch(e){setError((e as Error).message)}}
 const request=(intent:Intent)=>run(()=>p?.request(intent,budget))
 const start=()=>run(async()=>{setLoading(true);try{await session.current?.start(selected)}finally{setLoading(false)}})
 const events=p?.logs.filter(e=>e.kind==='audio_observation').slice(-3)||[]
 const exportLog=(format:'json'|'md')=>{if(!p)return;const text=format==='json'?JSON.stringify(p.export(),null,2):decisionReport(p.logs,tracks);if(window.HarBeatHost)window.HarBeatHost.exportLog(text,format);else{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text]));a.href=url;a.download=`HarBeat-V3.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}
 return <main>
 <header><button aria-label="返回 HarBeat" onClick={()=>window.HarBeatHost?.close()}>← 返回</button><b>HARBEAT<span>LIVE / V3</span></b><span className="tag">本机运行</span></header>
 <section className="intro"><span className="eyebrow">HIP-HOP / SIX</span><h1>实时混音<span>你决定下一步。</span></h1><p>六首原曲与变速片段已随 App 安装。选点、EQ、淡化和双轨叠加在手机上实时执行。</p></section>
 {error&&<p role="alert" className="error">{error}</p>}
 <section className="deck"><div className="row"><span className="eyebrow">NOW PLAYING</span><b>{pending?'等待 / 交接':p?.paused?'已暂停':p?.playing?'播放中':'待播放'}</b></div><h2>{current?.title||'准备好就开始。'}</h2><p>{current?`${current.bpm} BPM · ${current.style}`:'V3 LIVE · 279b65d'}</p><div className="time"><strong>{clock(position)}</strong><span> / {clock(current?.duration||0)}</span></div>
 <input aria-label="播放位置" type="range" min="0" max={current?.duration||1} step="1" value={position} disabled={!current||!!pending||p?.busy} onChange={e=>void run(()=>p?.seek(Number(e.target.value)))}/>
 <div className="row buttons"><button disabled={!current} onClick={()=>void run(()=>session.current?.togglePause())}>{p?.paused?'继续播放':'暂停'}</button><button disabled={!current&&!p?.busy} onClick={()=>session.current?.stop()}>停止</button></div>
 <label>开始歌曲<select aria-label="开始歌曲" value={selected} onChange={e=>setSelected(e.target.value)}>{tracks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><button className="primary" disabled={!tracks.length||loading} onClick={()=>void start()}>{loading?'正在准备…':current?'重新开始所选歌曲':'开始实时混音'}</button>
 </section>
 <section><div className="row"><h2>控制方向</h2><span className="tag">LIVE CONTROL</span></div><div className="actions"><button disabled={!p?.playing} onClick={()=>void request({kind:'next'})}>下一首 ↗</button><button disabled={!p?.playing} onClick={()=>void request({kind:'up'})}>能量提高 ↑</button><button disabled={!p?.playing} onClick={()=>void request({kind:'down'})}>能量降低 ↓</button></div>
 <div className="pair"><select aria-label="目标风格" value={style} onChange={e=>setStyle(e.target.value)}><option>Trap</option><option>Grime</option></select><button disabled={!p?.playing} onClick={()=>void request({kind:'style',style})}>切换风格</button></div>
 <div className="pair"><select aria-label="指定下一首" value={target} onChange={e=>setTarget(e.target.value)}><option value="">指定下一首</option>{tracks.filter(t=>t.id!==current?.id).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select><button disabled={!p?.playing||!target} onClick={()=>void request({kind:'next',targetId:target})}>按窗口接入</button></div>
 <label>交接等待<select aria-label="等待预算" value={budget} onChange={e=>setBudget(Number(e.target.value))}><option value="10">快速 · 10 秒</option><option value="18">平衡 · 18 秒</option><option value="30">完整 · 30 秒</option></select></label>
 <p role="status" className="status">{p?.status||'准备后即可开始。首次解码需要几秒。'}{pending&&<b> → {tracks.find(t=>t.id===pending.plan.to)?.title} · {Math.max(0,pending.end-p!.ctx.currentTime).toFixed(1)} 秒后接管</b>}</p>{(pending||p?.busy)&&<button onClick={()=>p?.cancel()}>取消待执行请求</button>}
 </section>
 <section><div className="row"><h2>这次怎么混</h2><span className="tag">DECISION LOG</span></div>{plan?<><h3>{tracks.find(t=>t.id===plan.from)?.title} → {tracks.find(t=>t.id===plan.to)?.title}</h3><p>{plan.reason}</p><div className="facts"><div>A 混入 / 退出<b>{clock(plan.start)} / {clock(plan.end)}</b></div><div>B 进入窗口<b>{clock(plan.window.start)} / {clock(plan.window.end)}</b></div><div>变速 / 小节<b>×{plan.rate.toFixed(3)} / {plan.window.bars}</b></div><div>人声中频处理<b>{plan.midDuck?'−5 dB 后恢复':'不衰减'}</b></div></div></>:<p>操作后显示选点与混音依据。没有合适窗口时会保留当前歌曲。</p>}
 {events.length>0&&<div className="observations">{events.map((e,i)=><p key={i}>{e.name}<b>{e.observationDeltaMs.toFixed(2)} ms</b></p>)}<small>音频处理块观察偏差，不是扬声器或蓝牙延迟。</small></div>}
 <div className="row buttons"><button disabled={!p?.logs.length} onClick={()=>exportLog('json')}>保存完整日志</button><button disabled={!p?.logs.length} onClick={()=>exportLog('md')}>保存决策说明</button></div><small>保存到手机“下载 / HarBeat”。每次请求的候选、排除原因、选点与执行记录均保留。</small>
 <details><summary>最近操作记录（{p?.logs.length||0}）</summary><ol>{p?.logs.filter(e=>['request_received','request_outcome','mobile_suspend'].includes(e.kind)).slice(-12).reverse().map((e,i)=><li key={i}>{e.kind==='mobile_suspend'?'离开前台，已暂停':e.kind==='request_received'?`收到请求：${e.intent.kind}`:`${e.outcome} · ${e.reason}`}</li>)}</ol></details>
 </section><footer>当前为 App 内 Web Audio 引擎，算法来自 279b65d。离开页面、锁屏或失去音频焦点会暂停；回来后手动继续。每首最多前 150 秒，小节与风格结果尚待人工确认。当前缓存 {p?.cache.sizeMB||0} MB。</footer>
 </main>
}
createRoot(document.getElementById('root')!).render(<MobileLab/> )
