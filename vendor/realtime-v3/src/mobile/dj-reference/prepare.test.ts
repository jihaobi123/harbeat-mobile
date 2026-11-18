import { it, expect, vi, afterEach } from "vitest";
import { prepareReference, readCase } from "./prepare";
import { fixture } from "./fixture";
afterEach(() => vi.unstubAllGlobals());
it("does not decode or adopt bytes when a bundled source digest differs", async () => {
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
  const decode = vi.fn(),
    ctx: any = { sampleRate: 44100, decodeAudioData: decode };
  await expect(
    prepareReference(
      fixture(),
      ctx,
      new URL("https://appassets.androidplatform.net/assets/realtime/"),
      new AbortController().signal,
    ),
  ).rejects.toThrow("指纹不一致");
  expect(decode).not.toHaveBeenCalled();
});
it("missing case never substitutes an ordinary or precombined audio mix", async () => {
  const fetch = vi.fn(async () => new Response("", { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    readCase(
      new URL("https://x.test/metric-engine/"),
      new AbortController().signal,
    ),
  ).rejects.toThrow("尚未就绪");
  expect(fetch).toHaveBeenCalledTimes(1);
});
