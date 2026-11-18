export type Point = [number, number];
export type Variant = "original" | "reference";
type Source = {
  trackId: string;
  runId: string;
  originalSha256: string;
  masterSha256: string;
  reportSha256: string;
  vocalSha256: string;
  vocalActivitySha256: string;
  sourceBpm: number;
  sourceStart: number;
};
type Asset = {
  url: string;
  sha256: string;
  frames: number;
  sampleRate: 44100;
  channels: 2;
  sourceStart: number;
};
export type ReferenceCase = {
  schema: "harbeat.dj-reference-case.v1";
  id: string;
  producer: "jetson";
  scope: "audition-only";
  approved: true;
  title: string;
  fromTitle: string;
  toTitle: string;
  sampleRate: 44100;
  bpm: number;
  rate: number;
  duration: number;
  lead: 4;
  tail: 8;
  outputGain: number;
  sources: Record<"a" | "b", Source>;
  assets: Record<"a" | "b", Asset>;
  reference: {
    url: string;
    coordinateProofSha256: string;
    note?: string;
  };
  variants: Record<
    Variant,
    {
      a: Point[];
      b: Point[];
      evidence: {
        approved: true;
        sourceAligned: true;
        vocalSafe: true;
        compatibilityPass: true;
        peak: number;
        melodyClash: number;
        beatErrorMs: number;
        riseDb: number;
        reconstruction: Record<
          "a" | "b",
          {
            errorRatio: number;
            levelDeltaDb: number;
          }
        >;
      };
    }
  >;
};
const frameAligned = (value: number) =>
  Number.isFinite(value) &&
  Math.abs(value * 44100 - Math.round(value * 44100)) < 1e-6;
const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x),
  num = (x: any, l: number, h: number) =>
    Number.isFinite(x) && x >= l && x <= h,
  near = (a: number, b: number) => Math.abs(a - b) < 1 / 44100 + 1e-9;
export function canonicalCase(value: any): string {
  const { id: _, ...body } = value;
  const sort = (v: any): any =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return JSON.stringify(sort(body));
}
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyCaseIdentity(c: ReferenceCase) {
  if (
    (await sha256(new TextEncoder().encode(canonicalCase(c)).buffer)) !== c.id
  )
    throw Error("DJ 对照方案指纹不一致");
}
export const caseBytes = (c: ReferenceCase) =>
  8 *
  (c.assets.a.frames +
    c.assets.b.frames +
    6 * Math.ceil((c.duration + 0.008) * 44100) +
    2 * c.assets.b.frames);
export function validateReferenceCase(v: any): ReferenceCase {
  const fail = () => {
    throw Error("DJ 对照尚未通过来源、坐标和试听安全校验");
  };
  if (
    !v ||
    v.schema !== "harbeat.dj-reference-case.v1" ||
    v.producer !== "jetson" ||
    v.scope !== "audition-only" ||
    v.approved !== true ||
    !hash(v.id) ||
    v.sampleRate !== 44100 ||
    v.lead !== 4 ||
    v.tail !== 8 ||
    !num(v.bpm, 123.999999, 124.000001) ||
    !num(v.rate, 0.95, 1.05) ||
    !num(v.duration, (8 * 60) / 124, 32) ||
    !frameAligned(v.duration) ||
    !frameAligned(v.duration * v.rate) ||
    !num(v.outputGain, 0.01, 0.5) ||
    !["title", "fromTitle", "toTitle"].every(
      (k) => typeof v[k] === "string" && v[k].length > 0 && v[k].length <= 300,
    )
  )
    fail();
  for (const side of ["a", "b"] as const) {
    const s = v.sources?.[side],
      a = v.assets?.[side];
    if (
      !s ||
      typeof s.trackId !== "string" ||
      !s.trackId.length ||
      s.trackId.length > 200 ||
      typeof s.runId !== "string" ||
      !s.runId.length ||
      s.runId.length > 200 ||
      ![
        "originalSha256",
        "masterSha256",
        "reportSha256",
        "vocalSha256",
        "vocalActivitySha256",
      ].every((k) => hash(s[k])) ||
      !num(s.sourceBpm, 60, 240) ||
      !num(s.sourceStart, side === "a" ? v.lead : 0, 7200) ||
      !frameAligned(s.sourceStart) ||
      !a ||
      a.url !== `reference-case/${side}.wav` ||
      !hash(a.sha256) ||
      a.sampleRate !== 44100 ||
      a.channels !== 2 ||
      !Number.isSafeInteger(a.frames) ||
      a.frames < 1 ||
      !num(a.sourceStart, 0, 7200) ||
      !near(a.sourceStart, s.sourceStart - (side === "a" ? v.lead : 0))
    )
      fail();
    const needed =
      side === "a" ? v.lead + v.duration : v.duration * v.rate + v.tail + 0.25;
    if (
      a.frames < Math.round(needed * 44100) ||
      a.frames > Math.ceil((needed + 2) * 44100)
    )
      fail();
  }
  if (
    v.sources.a.trackId === v.sources.b.trackId ||
    !near(v.sources.a.sourceBpm, v.bpm) ||
    !near(v.sources.b.sourceBpm, 128) ||
    Math.abs(v.rate - v.bpm / v.sources.b.sourceBpm) > 1e-9 ||
    v.reference?.url !== "https://www.youtube.com/watch?v=aqFRSSYp2bg" ||
    !hash(v.reference.coordinateProofSha256) ||
    (v.reference.note !== undefined &&
      (typeof v.reference.note !== "string" || v.reference.note.length > 2000))
  )
    fail();
  for (const variant of ["original", "reference"] as const) {
    const p = v.variants?.[variant];
    if (!validReferenceCurve(p, v.duration)) fail();
    if (variant === "original") {
      const fade = Math.round(((8 * 60) / v.bpm) * 44100) / 44100;
      for (const side of ["a", "b"] as const) {
        for (const time of new Set<number>([0, fade, v.duration, ...p[side].map((point: Point) => point[0])])) {
          const fraction = Math.min(1, time / fade);
          const expected = side === "a" ? 1 - fraction : fraction;
          if (Math.abs(valueAt(p[side], time) - expected) > 1e-6) fail();
        }
      }
    }
  }
  if (caseBytes(v) > 96 * 1024 * 1024)
    throw Error("DJ 对照超过 96 MiB PCM 准备预算");
  return v;
}
export type ReferenceCurve = ReferenceCase["variants"]["reference"];
export function validReferenceCurve(p: any, duration: number): p is ReferenceCurve {
  const e = p?.evidence;
  if (!e || e.approved !== true || e.sourceAligned !== true || e.vocalSafe !== true ||
      e.compatibilityPass !== true || !num(e.peak, 0, 0.95) ||
      !num(e.melodyClash, 0, 0.35) || !num(e.beatErrorMs, 0, 50) || !num(e.riseDb, -100, 3))
    return false;
  for (const side of ["a", "b"] as const) {
    const r = e.reconstruction?.[side], points = p[side];
    if (!r || !num(r.errorRatio, 0, 0.25) || !num(r.levelDeltaDb, -1.5, 1.5) ||
        !Array.isArray(points) || points.length < 2 || points.length > 32)
      return false;
    for (let i = 0; i < points.length; i++) {
      const x = points[i], last = points[i - 1];
      if (!Array.isArray(x) || x.length !== 2 || !num(x[0], 0, duration) || !num(x[1], 0, 1) ||
          (last && (x[0] <= last[0] || (side === "a" ? x[1] > last[1] : x[1] < last[1]))))
        return false;
    }
    if (points[0][0] !== 0 || points[0][1] !== Number(side === "a") ||
        !near(points.at(-1)[0], duration) || points.at(-1)[1] !== Number(side === "b"))
      return false;
  }
  return true;
}
export function valueAt(points: Point[], time: number) {
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t, v] = points[i],
      [p, u] = points[i - 1];
    if (time <= t) return u + ((v - u) * (time - p)) / (t - p);
  }
  return points.at(-1)![1];
}
