import { describe, it, expect } from "vitest";
import { fixture } from "./fixture";
import {
  validateReferenceCase,
  verifyCaseIdentity,
  canonicalCase,
  caseBytes,
} from "./contract";
import { createHash, webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
const sign = (v: any) => {
  v.id = createHash("sha256").update(canonicalCase(v)).digest("hex");
  return v;
};
describe("DJ source comparison contract", () => {
  it("accepts the producer's sample-quantized eight-beat fade", () => {
    const c = fixture();
    const fade = Math.round(((8 * 60) / c.bpm) * 44100) / 44100;
    c.variants.original.a[1][0] = fade;
    c.variants.original.b[1][0] = fade;
    expect(() => validateReferenceCase(c)).not.toThrow();
  });
  it("requires Jetson approval, same cue assets and actual quality evidence", async () => {
    const c = sign(fixture());
    expect(validateReferenceCase(c)).toBe(c);
    await verifyCaseIdentity(c);
    expect(caseBytes(c)).toBeLessThan(96 * 1024 * 1024);
    for (const mutate of [
      (v: any) => (v.approved = false),
      (v: any) => (v.variants.original.a = v.variants.reference.a),
      (v: any) => v.assets.a.sourceStart++,
      (v: any) => (v.sources.b.sourceBpm = 130),
      (v: any) => (v.variants.reference.evidence.vocalSafe = false),
      (v: any) => (v.variants.reference.evidence.riseDb = 3.1),
      (v: any) =>
        (v.variants.reference.evidence.reconstruction.a.errorRatio = 0.26),
      (v: any) => (v.assets.b.url = "https://evil.test/b.wav"),
    ]) {
      const v = fixture();
      mutate(v);
      expect(() => validateReferenceCase(v)).toThrow();
    }
  });
  it("rejects changed identity and nonmonotonic or incomplete automation", async () => {
    const v = sign(fixture());
    v.title = "Changed";
    await expect(verifyCaseIdentity(v)).rejects.toThrow();
    for (const points of [
      [
        [0, 1],
        [2, 0.2],
        [4, 0.5],
        [v.duration, 0],
      ],
      [
        [0, 1],
        [1, 0],
      ],
    ]) {
      const c = fixture();
      c.variants.reference.a = points;
      expect(() => validateReferenceCase(c)).toThrow();
    }
  });
});
