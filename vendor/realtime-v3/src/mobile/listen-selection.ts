import {shortlistNext,type LibraryEntry} from '../listen-upstream/continuous/catalog'
type SessionEntry=LibraryEntry&{referenceSet?:string}
export const SESSION_SELECTION_POLICY='session-unplayed-first-v1'
/** Metadata ordering only. The unchanged Listen planner still validates and
 * scores each eight-song batch before any audio can be scheduled. */
export function selectSessionBatch(entries:SessionEntry[],current:SessionEntry,played:ReadonlyMap<string,number>,recent:string[],excluded:ReadonlySet<string>,intent:{targetId?:string;style?:string}={},crossGenreIds:ReadonlySet<string>=new Set(),preferred:ReadonlySet<string>=new Set()){
 // Set membership describes where a song was found. Only reviewed pairs
 // may earn a preference, so use neutral collection costs for Set sources.
 const pool=current.referenceSet?entries.map(t=>({...t,collection:''})):entries
 const from=current.referenceSet?{...current,collection:''}:current
 const gradual=shortlistNext(pool,from,[],intent,entries.length),known=new Set(gradual.map(t=>t.id))
 const cross=entries.filter(t=>crossGenreIds.has(t.id)&&t.id!==current.id&&!known.has(t.id)&&t.playStatus==='ready'&&t.mixStatus==='ready'&&typeof t.bpm==='number'&&t.bpm>0&&(!intent.targetId||t.id===intent.targetId)&&(!intent.style||t.styleLabels.includes(intent.style)))
  .sort((a,b)=>Math.abs(Math.log(a.bpm!/current.bpm!))-Math.abs(Math.log(b.bpm!/current.bpm!))||a.id.localeCompare(b.id))
 const compatible=[...gradual,...cross],fresh=compatible.filter(t=>!played.has(t.id)),available=fresh.filter(t=>!excluded.has(t.id))
 const evidence={policy:SESSION_SELECTION_POLICY,compatibleCount:compatible.length,unplayedCompatibleCount:fresh.length,unplayedRemainingCount:available.length,excludedUnplayedCount:fresh.length-available.length,playedTrackCount:played.size}
 if(intent.targetId)return {...evidence,mode:'explicit' as const,reason:'manual_target',ids:compatible.filter(t=>!excluded.has(t.id)).map(t=>t.id)}
 if(available.length)return {...evidence,mode:'unplayed' as const,reason:'unplayed_candidates_available',ids:[...available.filter(t=>preferred.has(t.id)),...available.filter(t=>!preferred.has(t.id))].slice(0,8).map(t=>t.id)}
 const repeats=compatible.filter(t=>played.has(t.id)&&!excluded.has(t.id)),least=Math.min(...repeats.map(t=>played.get(t.id)!)),tier=repeats.filter(t=>played.get(t.id)===least)
 return {...evidence,mode:'repeat-fallback' as const,reason:fresh.length?'unplayed_candidates_exhausted':'all_compatible_tracks_played',ids:crossGenreIds.size?tier.slice(0,8).map(t=>t.id):shortlistNext(tier,from,recent,intent).map(t=>t.id)}
}
