import { it, expect } from "vitest";
import { fixture } from "./fixture";
import { ReferenceGraph, measuredPeak } from "./graph";
class Param {
  calls: any[] = [];
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["ramp", v, t]);
  }
}
class Node {
  gain = new Param();
  buffer: any;
  starts: any[] = [];
  stops = 0;
  connect() {}
  disconnect() {}
  start(...args: any[]) {
    this.starts.push(args);
  }
  stop() {
    this.stops++;
  }
}
it("uses one clock, native B offset and 8ms body seam, then releases every source", () => {
  const nodes: Node[] = [],
    ctx: any = {
      currentTime: 10,
      createGain() {
        const n = new Node();
        nodes.push(n);
        return n;
      },
      createBufferSource() {
        const n = new Node();
        nodes.push(n);
        return n;
      },
    },
    c = fixture(),
    pcm: any = { a: {}, b: {}, stretchedB: {} };
  const graph = new ReferenceGraph(
    ctx,
    new Node() as any,
    c,
    pcm,
    "reference",
    10,
  );
  const sources = nodes.filter((n) => n.starts.length);
  expect(sources).toHaveLength(3);
  expect(sources[0].starts[0][0]).toBe(10);
  expect(sources[1].starts[0][0]).toBe(14);
  expect(sources[2].starts[0]).toEqual([
    14 + c.duration,
    c.duration * c.rate,
    8,
  ]);
  expect(nodes.flatMap((n) => n.gain.calls)).toContainEqual([
    "ramp",
    0,
    14 + c.duration + 0.008,
  ]);
  graph.stop();
  expect(sources.every((n) => n.stops === 1)).toBe(true);
});
it("checks lead, boundary and B tail peaks, not just the overlap", () => {
  const c = fixture();
  c.duration = 1;
  const buffer = (frames: number) =>
      ({ getChannelData: () => new Float32Array(frames) }) as any,
    a = buffer(5 * 44100),
    b = buffer(12 * 44100),
    s = buffer(Math.ceil(1.008 * 44100));
  let pcm = { a, b, stretchedB: s };
  expect(measuredPeak(c, pcm, "reference")).toBe(0);
  const samples = new Float32Array(12 * 44100);
  samples[8 * 44100] = 2;
  b.getChannelData = () => samples;
  expect(measuredPeak(c, pcm, "reference")).toBe(1);
  const lead = new Float32Array(5 * 44100);
  lead[1] = 2.2;
  a.getChannelData = () => lead;
  expect(measuredPeak(c, pcm, "original")).toBeCloseTo(1.1);
});
