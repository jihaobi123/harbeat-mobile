import { it, expect } from "vitest";
import { ReferenceRun } from "./session";
import { fixture } from "./fixture";
it("a different approved case discards the previous PCM and listening coverage", async () => {
  let current = fixture();
  let preparations = 0;
  const run = new ReferenceRun(
    new URL("https://x.test/"),
    () => {},
    undefined,
    {
      read: async () => current,
      create: ctx,
      prepare: async () => {
        preparations++;
        return {} as any;
      },
      graph: () => ({ position: 2, finished: false, stop() {} }) as any,
    },
  );
  await run.prepare();
  await run.play("original");
  run.tick();
  expect(run.snapshot().coverage.original.seconds).toBe(2);
  current = { ...fixture(), id: "b".repeat(64) };
  await run.prepare();
  expect(run.snapshot().coverage.original.seconds).toBe(0);
  await run.play("reference");
  expect(preparations).toBe(2);
  run.dispose();
});
const ctx = () =>
  ({
    state: "suspended",
    currentTime: 0,
    resume: async function () {
      this.state = "running";
    },
    suspend: async function () {
      this.state = "suspended";
    },
    close: async function () {
      this.state = "closed";
    },
    destination: {},
  }) as any;
it("cancelled preparation cannot start after focus loss and explicit resume is required", async () => {
  let release: (v: any) => void = () => {};
  const c = ctx(),
    spec = fixture();
  let stopped = 0;
  const run = new ReferenceRun(
    new URL("https://appassets.androidplatform.net/assets/realtime/"),
    () => {},
    { requestFocus: () => true },
    {
      read: async () => spec,
      create: () => c,
      prepare: () => new Promise((resolve) => (release = resolve)),
      graph: () =>
        ({ position: 0, finished: false, stop: () => stopped++ }) as any,
    },
  );
  await run.prepare();
  const pending = run.play("reference");
  await Promise.resolve();
  await run.pause("host-inactive");
  release({});
  await expect(pending).rejects.toThrow();
  expect(run.snapshot().playing).toBe(false);
  run.dispose();
  expect(stopped).toBe(0);
});
it("records coverage for each variant and keeps it through pause, replay and stop", async () => {
  const c = ctx(),
    run = new ReferenceRun(
      new URL("https://x.test/"),
      () => {},
      { requestFocus: () => true },
      {
        read: async () => fixture(),
        create: () => c,
        prepare: async () => ({}) as any,
        graph: () =>
          ({
            get position() {
              return c.currentTime;
            },
            finished: false,
            stop() {},
          }) as any,
      },
    );
  await run.prepare();
  await run.play("original");
  c.currentTime = 2;
  run.tick();
  await run.pause();
  expect(run.snapshot().coverage.original.seconds).toBe(2);
  await run.resume();
  c.currentTime = 3;
  run.stop();
  expect(run.snapshot().coverage.original.seconds).toBe(3);
  expect(run.snapshot().coverage.reference.seconds).toBe(0);
  run.dispose();
});
it("a focus loss racing an awaited resume cannot restart background audio", async () => {
  const c = ctx();
  let release: () => void = () => {};
  const run = new ReferenceRun(
    new URL("https://x.test/"),
    () => {},
    { requestFocus: () => true },
    {
      read: async () => fixture(),
      create: () => c,
      prepare: async () => ({}) as any,
      graph: () => ({ position: 1, finished: false, stop() {} }) as any,
    },
  );
  await run.prepare();
  await run.play("original");
  await run.pause();
  c.resume = () =>
    new Promise<void>((resolve) => {
      release = () => {
        c.state = "running";
        resolve();
      };
    });
  const resuming = run.resume();
  await run.pause("host-inactive");
  release();
  await resuming;
  expect(c.state).toBe("suspended");
  expect(run.snapshot().playing).toBe(false);
  run.dispose();
});
