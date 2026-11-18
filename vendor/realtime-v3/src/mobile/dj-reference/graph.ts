import { valueAt, type ReferenceCase, type Variant } from "./contract";
export type PCM = {
  a: AudioBuffer;
  b: AudioBuffer;
  stretchedB: AudioBuffer;
};
export class ReferenceGraph {
  private nodes: AudioNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private stopped = false;
  readonly at: number;
  readonly end: number;
  constructor(
    private ctx: AudioContext,
    target: AudioNode,
    readonly spec: ReferenceCase,
    pcm: PCM,
    variant: Variant,
    at: number,
  ) {
    this.at = at;
    const mix = at + spec.lead,
      takeover = mix + spec.duration;
    this.end = takeover + spec.tail;
    const keep = <T extends AudioNode>(n: T) => {
      this.nodes.push(n);
      return n;
    };
    try {
      const bus = keep(ctx.createGain());
      bus.gain.setValueAtTime(spec.outputGain, at);
      bus.gain.setValueAtTime(spec.outputGain, this.end - 0.01);
      bus.gain.linearRampToValueAtTime(0, this.end);
      bus.connect(target);
      const gain = (points: [number, number][], start: number) => {
        const n = keep(ctx.createGain());
        n.connect(bus);
        for (const [i, [t, v]] of points.entries())
          i
            ? n.gain.linearRampToValueAtTime(v, start + t)
            : n.gain.setValueAtTime(v, start + t);
        return n;
      };
      const source = (
        buffer: AudioBuffer,
        node: AudioNode,
        start: number,
        offset: number,
        duration: number,
      ) => {
        const n = keep(ctx.createBufferSource());
        n.buffer = buffer;
        n.connect(node);
        this.sources.push(n);
        n.start(start, offset, duration);
      };
      const a = gain(
        [
          [0, 1],
          ...[...spec.variants[variant].a].map(
            ([t, v]) => [t + spec.lead, v] as [number, number],
          ),
        ],
        at,
      );
      source(pcm.a, a, at, 0, spec.lead + spec.duration);
      const b = gain(spec.variants[variant].b, mix);
      b.gain.setValueAtTime(1, takeover);
      b.gain.linearRampToValueAtTime(0, takeover + 0.008);
      source(pcm.stretchedB, b, mix, 0, spec.duration + 0.008);
      const body = gain(
        [
          [0, 0],
          [0.008, 1],
        ],
        takeover,
      );
      source(pcm.b, body, takeover, spec.duration * spec.rate, spec.tail);
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  get position() {
    return Math.max(
      0,
      Math.min(
        this.spec.lead + this.spec.duration + this.spec.tail,
        this.ctx.currentTime - this.at,
      ),
    );
  }
  get finished() {
    return this.ctx.currentTime >= this.end;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const n of this.sources)
      try {
        n.stop();
      } catch {}
    for (const n of this.nodes)
      try {
        n.disconnect();
      } catch {}
  }
}
/** Check the exact device-stretched sources, rather than trusting a metadata peak. */
export function measuredPeak(c: ReferenceCase, pcm: PCM, variant: Variant) {
  let peak = 0;
  const curves = c.variants[variant];
  const frames = Math.round(c.duration * 44100);
  const lead = Math.round(c.lead * 44100);
  const bodyStart = Math.round(c.duration * c.rate * 44100);
  const tail = Math.round(c.tail * 44100);
  const measure = (sample: number) => {
    const value = sample * c.outputGain;
    if (!Number.isFinite(value)) throw Error("DJ 对照包含无效样本");
    peak = Math.max(peak, Math.abs(value));
  };
  for (let ch = 0; ch < 2; ch++) {
    const a = pcm.a.getChannelData(ch);
    const b = pcm.stretchedB.getChannelData(ch);
    const nativeB = pcm.b.getChannelData(ch);
    for (let i = 0; i < lead; i++) measure(a[i]);
    for (let i = 0; i < frames; i++) {
      measure(
        a[lead + i] * valueAt(curves.a, i / 44100) +
          b[i] * valueAt(curves.b, i / 44100),
      );
    }
    for (let i = 0; i < tail; i++) {
      const seconds = i / 44100;
      const nativeGain = Math.min(1, seconds / 0.008);
      const boundary = nativeGain < 1 ? b[frames + i] * (1 - nativeGain) : 0;
      const endGain = Math.min(1, (c.tail - seconds) / 0.01);
      measure((boundary + nativeB[bodyStart + i] * nativeGain) * endGain);
    }
  }
  return peak;
}
