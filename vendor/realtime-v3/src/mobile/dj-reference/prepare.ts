import {
  validateReferenceCase,
  verifyCaseIdentity,
  sha256,
  type ReferenceCase,
} from "./contract";
import { stretchSceneInputs } from "../longmix/prepare";
import { measuredPeak, type PCM } from "./graph";
export async function readBounded(
  url: URL,
  signal: AbortSignal,
  limit: number,
) {
  const r = await fetch(url, { signal, redirect: "error", cache: "no-store" });
  if (!r.ok) throw Error("DJ 对照素材尚未就绪");
  const reader = r.body?.getReader();
  if (!reader) throw Error("DJ 对照素材为空");
  let n = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      signal.throwIfAborted();
      const x = await reader.read();
      if (x.done) break;
      n += x.value.length;
      if (n > limit) throw Error("DJ 对照下载超过预算");
      chunks.push(x.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out.buffer;
}
export async function readCase(base: URL, signal: AbortSignal) {
  const bytes = await readBounded(
      new URL("reference-case/case.json", base),
      signal,
      512 * 1024,
    ),
    c = validateReferenceCase(JSON.parse(new TextDecoder().decode(bytes)));
  await verifyCaseIdentity(c);
  signal.throwIfAborted();
  return c;
}
export async function prepareReference(
  c: ReferenceCase,
  ctx: AudioContext,
  base: URL,
  signal: AbortSignal,
): Promise<PCM> {
  if (ctx.sampleRate !== 44100) throw Error("DJ 对照需要 44.1 kHz 音频环境");
  const buffers: Partial<PCM> = {};
  for (const side of ["a", "b"] as const) {
    const asset = c.assets[side],
      bytes = await readBounded(
        new URL(asset.url, base),
        signal,
        asset.frames * 8 + 65536,
      );
    if ((await sha256(bytes)) !== asset.sha256)
      throw Error("DJ 音频来源指纹不一致");
    signal.throwIfAborted();
    const decoded = await ctx.decodeAudioData(bytes);
    signal.throwIfAborted();
    if (
      decoded.sampleRate !== 44100 ||
      decoded.numberOfChannels !== 2 ||
      decoded.length !== asset.frames
    )
      throw Error("DJ 音频样本数或声道与批准不一致");
    for (let ch = 0; ch < 2; ch++)
      if (decoded.getChannelData(ch).some((x) => !Number.isFinite(x)))
        throw Error("DJ 音频包含无效样本");
    buffers[side] = decoded;
  }
  const frames = Math.ceil((c.duration + 0.008) * 44100),
    input = ctx.createBuffer(2, buffers.b!.length, 44100);
  for (let ch = 0; ch < 2; ch++)
    input.copyToChannel(buffers.b!.getChannelData(ch), ch);
  const stretched = await stretchSceneInputs(
    { master: input },
    ctx,
    c.rate,
    frames,
    signal,
  );
  signal.throwIfAborted();
  const pcm: PCM = {
    a: buffers.a!,
    b: buffers.b!,
    stretchedB: stretched.master,
  };
  for (const variant of ["original", "reference"] as const)
    if (measuredPeak(c, pcm, variant) > 0.95)
      throw Error("本机试听峰值超过批准范围，暂不播放");
  return pcm;
}
