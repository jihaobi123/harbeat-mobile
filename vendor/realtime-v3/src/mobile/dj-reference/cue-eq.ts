// Keep the ordinary player's 140 Hz shelf and V3 dry/wet handoff.
const cueBassHz = 140;
const aEnableSeconds = .02;
type Deck = {low:BiquadFilterNode;wet:GainNode;dry:GainNode};

export function scheduleCueBass(deck:Deck, side:'a'|'b', at:number, duration:number, releaseSec:number) {
  const {low,wet,dry} = deck;
  low.gain.setValueAtTime(side === 'a' ? -9 : -7,at);
  const fade = (p:AudioParam,start:number,end:number,from:number,to:number) => {
    p.setValueAtTime(from,start);
    p.linearRampToValueAtTime(to,end);
  };
  if (side === 'a') {
    fade(wet.gain,at,at+aEnableSeconds,0,1);
    fade(dry.gain,at,at+aEnableSeconds,1,0);
  } else {
    wet.gain.setValueAtTime(1,at);
    dry.gain.setValueAtTime(0,at);
    fade(wet.gain,at+duration-releaseSec,at+duration,1,0);
    fade(dry.gain,at+duration-releaseSec,at+duration,0,1);
  }
}

/** Measure the exact browser EQ used by the live deck before arming. */
export async function measureCueBassInput(input:AudioBuffer, side:'a'|'b', duration:number, releaseSec:number) {
  const ctx = new OfflineAudioContext(input.numberOfChannels,input.length,input.sampleRate);
  const source=ctx.createBufferSource(),low=ctx.createBiquadFilter(),wet=ctx.createGain(),dry=ctx.createGain();
  source.buffer=input;
  low.type='lowshelf';
  low.frequency.value=cueBassHz;
  source.connect(low).connect(wet).connect(ctx.destination);
  source.connect(dry).connect(ctx.destination);
  scheduleCueBass({low,wet,dry},side,0,duration,releaseSec);
  source.start(0);
  return ctx.startRendering();
}
