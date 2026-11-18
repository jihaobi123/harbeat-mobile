import type {CrossDeck} from './lifecycle'

/** Match the pinned scheduler's legacy pending-deck exemption: audio after the
 * frozen A exit is no longer required. Actual earlier gaps stay visible. */
export function protectSourceBoundary(deck:CrossDeck,handoff:number){
 const source=deck.stream;if(!source)return()=>{}
 const capped=new Proxy(source,{get(target,key){
  if(key==='deadline'&&target.deadline>=handoff-1/44100)return Infinity
  const value=Reflect.get(target,key,target)
  return typeof value==='function'?value.bind(target):value
 }})
 deck.stream=capped
 return()=>{if(deck.stream===capped)deck.stream=source}
}
