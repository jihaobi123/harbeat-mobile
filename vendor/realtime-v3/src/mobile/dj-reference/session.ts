import type { Host } from "../session";
import { readCase, prepareReference } from "./prepare";
import { ReferenceGraph, type PCM } from "./graph";
import type { ReferenceCase, Variant } from "./contract";
type Deps = {
  read?: typeof readCase;
  prepare?: typeof prepareReference;
  create?: () => AudioContext;
  graph?: (
    ctx: AudioContext,
    target: AudioNode,
    c: ReferenceCase,
    pcm: PCM,
    variant: Variant,
    at: number,
  ) => ReferenceGraph;
};
type Range = [number, number];
export class ReferenceRun {
  private spec: ReferenceCase | null = null;
  private ctx: AudioContext | null = null;
  private pcm: PCM | null = null;
  private graph: ReferenceGraph | null = null;
  private controller: AbortController | null = null;
  private revision = 0;
  private dead = false;
  private variant: Variant = "original";
  private busy = false;
  private status = "正在读取 DJ 对照资料";
  private error = "";
  private last = 0;
  private intervals: Record<Variant, Range[]> = { original: [], reference: [] };
  constructor(
    private base: URL,
    private changed: () => void,
    private host?: Pick<Host, "requestFocus">,
    private deps: Deps = {},
  ) {}
  async prepare() {
    this.stop();
    const generation = ++this.revision,
      c = (this.controller = new AbortController());
    this.busy = true;
    this.error = "";
    this.changed();
    try {
      const spec = await (this.deps.read ?? readCase)(this.base, c.signal);
      c.signal.throwIfAborted();
      if (this.dead || generation !== this.revision)
        throw new DOMException("已取消", "AbortError");
      if (this.spec?.id !== spec.id) {
        this.pcm = null;
        this.intervals = { original: [], reference: [] };
      }
      this.spec = spec;
      this.status = "对照资料已校验，选择版本开始试听";
    } catch (e) {
      if (generation === this.revision) {
        this.error = (e as Error).message;
        this.status = "素材尚未就绪，普通播放保持可用";
      }
      throw e;
    } finally {
      if (generation === this.revision) this.busy = false;
      this.changed();
    }
  }
  async play(variant: Variant) {
    if (!this.spec || !["original", "reference"].includes(variant))
      throw Error("请等待 DJ 对照资料就绪");
    if (this.busy) throw Error("对照素材正在准备");
    this.stop();
    if (this.host && !this.host.requestFocus()) throw Error("请回到前台后试听");
    const generation = ++this.revision,
      controller = (this.controller = new AbortController());
    this.variant = variant;
    this.busy = true;
    this.error = "";
    this.status = "正在核对音频并准备本机保调变速";
    this.changed();
    try {
      this.ctx ??= (
        this.deps.create ??
        (() =>
          new AudioContext({ sampleRate: 44100, latencyHint: "interactive" }))
      )();
      if (!this.pcm)
        this.pcm = await (this.deps.prepare ?? prepareReference)(
          this.spec,
          this.ctx,
          this.base,
          controller.signal,
        );
      controller.signal.throwIfAborted();
      if (this.dead || generation !== this.revision)
        throw new DOMException("已取消", "AbortError");
      await this.ctx.resume();
      controller.signal.throwIfAborted();
      if (this.dead || generation !== this.revision)
        throw new DOMException("已取消", "AbortError");
      this.graph = (this.deps.graph ?? ((...a) => new ReferenceGraph(...a)))(
        this.ctx,
        this.ctx.destination,
        this.spec,
        this.pcm,
        variant,
        this.ctx.currentTime + 0.12,
      );
      this.last = 0;
      this.status =
        variant === "original" ? "正在试听原渐混" : "正在试听参考交接";
    } catch (e) {
      if (generation === this.revision) {
        this.error = (e as Error).message;
        this.graph?.stop();
        this.graph = null;
        void this.ctx?.suspend();
        this.status = "试听未启动，可重试或返回普通播放";
      }
      throw e;
    } finally {
      if (generation === this.revision) this.busy = false;
      this.changed();
    }
  }
  private observe() {
    if (!this.graph || this.ctx?.state !== "running") return;
    const end = this.graph.position;
    if (end > this.last) {
      const ranges = this.intervals[this.variant];
      ranges.push([this.last, end]);
      ranges.sort((a, b) => a[0] - b[0]);
      const merged: Range[] = [];
      for (const r of ranges) {
        const prev = merged.at(-1);
        if (prev && r[0] <= prev[1] + 0.001) prev[1] = Math.max(prev[1], r[1]);
        else merged.push([...r]);
      }
      this.intervals[this.variant] = merged;
      this.last = end;
    }
  }
  tick() {
    this.observe();
    if (this.graph?.finished) {
      this.graph.stop();
      this.graph = null;
      void this.ctx?.suspend();
      this.status = "试听完成，可以选择偏好或重听";
    }
    this.changed();
  }
  async pause(reason = "user") {
    this.observe();
    this.revision++;
    if (this.busy) {
      this.controller?.abort();
      this.busy = false;
      this.status = "准备已暂停，请重新试听";
    }
    if (this.ctx) await this.ctx.suspend();
    if (this.graph)
      this.status = reason === "user" ? "已暂停" : "已暂停，回到前台后手动继续";
    this.changed();
  }
  async resume() {
    if (!this.graph || !this.ctx) throw Error("请先选择一个版本试听");
    if (this.host && !this.host.requestFocus()) throw Error("请回到前台后继续");
    const generation = this.revision;
    await this.ctx.resume();
    if (this.dead || generation !== this.revision) {
      await this.ctx.suspend();
      return;
    }
    this.status = "正在继续试听";
    this.changed();
  }
  stop() {
    this.observe();
    this.revision++;
    this.controller?.abort();
    this.controller = null;
    this.graph?.stop();
    this.graph = null;
    this.busy = false;
    void this.ctx?.suspend();
    this.status = "已停止，可重新试听";
    this.changed();
  }
  snapshot() {
    const duration = this.spec
      ? this.spec.lead + this.spec.duration + this.spec.tail
      : 0;
    return {
      case: this.spec
        ? {
            id: this.spec.id,
            title: this.spec.title,
            fromTitle: this.spec.fromTitle,
            toTitle: this.spec.toTitle,
            bpm: this.spec.bpm,
            duration: this.spec.duration,
            lead: this.spec.lead,
            tail: this.spec.tail,
            sources: this.spec.sources,
            reference: this.spec.reference,
          }
        : null,
      variant: this.variant,
      playing: !!this.graph && this.ctx?.state === "running",
      paused: !!this.graph && this.ctx?.state === "suspended",
      busy: this.busy,
      position: this.graph?.position ?? 0,
      duration,
      status: this.status,
      error: this.error,
      coverage: Object.fromEntries(
        (["original", "reference"] as const).map((v) => {
          const ranges = this.intervals[v],
            seconds = ranges.reduce((n, [a, b]) => n + b - a, 0);
          return [
            v,
            {
              intervals: ranges.map((r) => [...r]),
              seconds,
              fraction: duration ? Math.min(1, seconds / duration) : 0,
            },
          ];
        }),
      ) as Record<
        Variant,
        {
          intervals: Range[];
          seconds: number;
          fraction: number;
        }
      >,
    };
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.stop();
    this.pcm = null;
    this.spec = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
