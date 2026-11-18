export function fixture(): any {
  const h = "a".repeat(64),
    duration = (Math.ceil((((8 * 60) / 124) * 44100) / 32) * 32) / 44100;
  const proof = (id: string, bpm: number) => ({
    trackId: id,
    runId: "run-1",
    originalSha256: h,
    masterSha256: h,
    reportSha256: h,
    vocalSha256: h,
    vocalActivitySha256: h,
    sourceBpm: bpm,
    sourceStart: 10,
  });
  const evidence = () => ({
    approved: true,
    sourceAligned: true,
    vocalSafe: true,
    compatibilityPass: true,
    peak: 0.7,
    melodyClash: 0.1,
    beatErrorMs: 10,
    riseDb: 1,
    reconstruction: {
      a: { errorRatio: 0.1, levelDeltaDb: 0 },
      b: { errorRatio: 0.1, levelDeltaDb: 0 },
    },
  });
  return {
    schema: "harbeat.dj-reference-case.v1",
    id: h,
    producer: "jetson",
    scope: "audition-only",
    approved: true,
    title: "Hapa transition",
    fromTitle: "House Loop 2",
    toTitle: "Electro House vol 1",
    sampleRate: 44100,
    bpm: 124,
    rate: 124 / 128,
    duration,
    lead: 4,
    tail: 8,
    outputGain: 0.5,
    sources: { a: proof("a", 124), b: proof("b", 128) },
    assets: {
      a: {
        url: "reference-case/a.wav",
        sha256: h,
        frames: Math.ceil((4 + duration) * 44100),
        sampleRate: 44100,
        channels: 2,
        sourceStart: 6,
      },
      b: {
        url: "reference-case/b.wav",
        sha256: h,
        frames: Math.ceil(((duration * 124) / 128 + 8 + 0.35) * 44100),
        sampleRate: 44100,
        channels: 2,
        sourceStart: 10,
      },
    },
    reference: {
      url: "https://www.youtube.com/watch?v=aqFRSSYp2bg",
      coordinateProofSha256: h,
      note: "Manual alignment",
    },
    variants: {
      original: {
        a: [
          [0, 1],
          [Math.round(((8 * 60) / 124) * 44100) / 44100, 0],
          [duration, 0],
        ],
        b: [
          [0, 0],
          [Math.round(((8 * 60) / 124) * 44100) / 44100, 1],
          [duration, 1],
        ],
        evidence: evidence(),
      },
      reference: {
        a: [
          [0, 1],
          [duration / 2, 1],
          [duration, 0],
        ],
        b: [
          [0, 0],
          [duration / 2, 1],
          [duration, 1],
        ],
        evidence: evidence(),
      },
    },
  };
}
