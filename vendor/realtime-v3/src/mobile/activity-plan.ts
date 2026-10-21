import type {Track} from '../metric-upstream/realtime/planner'
import {rankChoices,rankNearbyChoices,styleMatches} from './smart-selection'
export function planActivitySet(o:{tracks:(Track&{styleLabels:string[];playStatus?:string;mixStatus?:string})[];styles:string[];energy:number;maxTracks:number}){
 if(!Array.isArray(o.tracks)||o.tracks.length>64||!Array.isArray(o.styles)||!o.styles.length||o.styles.length>8||!Number.isInteger(o.energy)||o.energy<1||o.energy>5||!Number.isInteger(o.maxTracks)||o.maxTracks<4||o.maxTracks>12)throw Error('预约参数超出准备范围')
 const eligible=o.tracks.filter(t=>t.mixStatus!=='unavailable'&&t.playStatus!=='unavailable'&&o.styles.some(s=>styleMatches(t.styleLabels,s)))
 const connectivity=(a:Track)=>eligible.filter(b=>a.id!==b.id&&a.bpm/b.bpm>=.95&&a.bpm/b.bpm<=1.05).length
 const tracks=[...eligible].sort((a,b)=>connectivity(b)-connectivity(a)||a.id.localeCompare(b.id)).slice(0,o.maxTracks)
 const edges:{from:string;to:string;windowId:string;start:number;end:number;duration:number;rate:number;bStart:number;bEnd:number;score:number;kind:string}[]=[]
 const warnings:string[]=[]
 for(const a of tracks){
  const options=tracks.filter(b=>b.id!==a.id),auto=rankChoices(a,options,35,o.energy,new Set()).best
  const near=rankNearbyChoices(a,auto?[auto.track]:options,Math.min(30,a.duration*.15),o.energy).best
  for(const [choice,kind] of [[auto,'automatic'],[near,'nearby']] as const){if(!choice)continue;const p=choice.plan
   if(edges.some(e=>e.from===p.from&&e.to===p.to&&e.windowId===p.window.id&&Math.abs(e.start-p.start)<.002))continue
   edges.push({from:p.from,to:p.to,windowId:p.window.id,start:p.start,end:p.end,duration:p.duration,rate:p.rate,bStart:p.window.start,bEnd:p.window.end,score:choice.score,kind})
  }
  if(!auto)warnings.push(a.title+' 暂无通过原自动规则的出口')
 }
 const initialTrackId=edges.filter(e=>e.kind==='automatic').sort((a,b)=>b.score-a.score||a.from.localeCompare(b.from))[0]?.from??tracks[0]?.id??''
 return {trackIds:tracks.map(t=>t.id),initialTrackId,edges,tracks:tracks.map(t=>({id:t.id,title:t.title,bpm:t.bpm,duration:t.duration,styleLabels:t.styleLabels})),warnings}
}
