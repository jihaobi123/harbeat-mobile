# Nearby Stem Reuse Implementation Plan

> Execute inline in the current worktree with red-first regressions and independent code review.

**Goal:** Let the new UI use the existing six-method decision at the selected live cue when playable in time.

**Architecture:** A small preparation coordinator races approved cloud assets against a bounded cue budget while preparing the unchanged local fade. MetricRun supplies the existing cloud validation, cache, original renderer and cancellation signals. No planner or DSP changes.

**Tech Stack:** TypeScript, Vitest, existing metric cloud/Jetson renderer and Flutter Web host.

- [x] Add red-first coordinator cases for playable non-original result, slow generation, slow asset load, cancellation and identity mismatch. Run and inspect expected failures.
- [x] Implement `mobile/nearby-result.ts` with a maximum two-second window and one-second scheduling reserve, strict plan identity and cancellation of losing preparation.
- [x] Wire both live request entry points to the coordinator, at most one cloud attempt per explicit request; leave existing ready-result reuse and automatic planner unchanged. Add MetricRun integration regressions.
- [x] Add bounded stage diagnostics to existing cloud requests. Measure worker stages and a public asset transfer, saving evidence without credentials or source audio.
- [x] Run full engine tests, typecheck, source fingerprint validation and build. Review changes independently, address findings, verify real UI handoff/export and preserve user preferences. Document method inventory and limitations, commit verified changes.
