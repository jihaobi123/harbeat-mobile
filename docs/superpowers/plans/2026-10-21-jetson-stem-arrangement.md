# Jetson stem judgment and device arrangement implementation plan

> **For agentic workers:** Use executing-plans task by task, with independent review. The user approved the design and execution; no further design gate is pending.

**Goal:** Move musical suitability decisions to Jetson, retain device scheduling and bounded preparation, and deliver six controlled drum-prelude auditions.

**Architecture:** A source-bound JSON plan is calculated on Jetson using the existing cue, shared WSOLA and FFT definitions. The cloud queues and relays plans. The phone verifies each exact approval, prepares source PCM and executes curves; the new drum prelude remains audition-only until listening feedback.

**Tech Stack:** Existing Python/NumPy/SoundFile, bundled Node/TypeScript/SoundTouch, Web Audio and Flutter bridge.

## 1. Shared judgment and approval wire format

Files: create `vendor/realtime-v3/src/mobile/decision-core.ts`, `jetson-contract.ts` and tests; create `tools/jetson_plan.ts` and bundle builder.

- [ ] Test exact current metric/curve decisions with synthetic stereo fixtures, unknown values and source-bound real plans before extracting production functions.
- [ ] Build the pure decision function with existing definitions, including 125 ms RMS overlap, observed-window FFT and vocal tail rules.
- [ ] Test source/geometry/version/hash mutation rejection before adding the approval validator.

```ts
type JetsonDecision = {
 schema:'harbeat.jetson-mix-plan.v1'; id:string; status:'ready'; producer:'jetson';
 analysisVersion:'jetson-decision-v1'; algorithmSha256:string;
 plan:Prepared['plan']; sourceProof:{a:SourceBinding;b:SourceBinding};
 controls:Controls; metrics:Prepared['metrics']; decision:Prepared['decision'];
 eq:Plan['v30Eq']; restore:number; requiredStems:string[]; analysisSha256:string;
}
// Verify source identities, all geometry, bounded controls and canonical SHA.
verifyJetsonDecision(value:unknown,a:Track,b:Track,plan:Plan):Promise<JetsonDecision>
```

- [ ] CLI reads fixed-format local f32le files; reconstructs the exact requested plan with current source-bound TS planner; rejects unqualified geometry.
- [ ] CLI runs shared WSOLA and judgment, emits JSON only, and optionally writes same-mapping audition PCM and technical prelude evidence.

## 2. Jetson job runner and cloud queue

Backend files: create `analysis_platform/jetson_plan.py`, `metric_mix/plan_gateway.py`; mount routes in `metric_mix/gateway.py`; add runner/gateway tests.

- [ ] Write failing tests for stale NAS sources, path escape, bad geometry, bounded queue, version mismatch and sanitized remote failure.
- [ ] Resolve trusted library records on cloud. Remote runner verifies NAS source assets, profile bindings and exact PCM coverage before invoking fixed Node bundle.
- [ ] Add `POST /plans {from,to,windowId,start}` and `GET /plans/{id}` under the existing smart API. Existing render jobs remain compatible.
- [ ] Cache by source and planner version; ready state is the unmodified Node decision. Never return private source paths or credentials.
- [ ] Publish the Node bundle and Python runner on Jetson, queue bridge on cloud, and verify real jobs without restarting GPU/download services.

## 3. Device consumption

Files: create `src/mobile/jetson-client.ts` and tests; modify `device-prepare.ts`, `metric.ts`; verify Android and preview URL forwarding.

- [ ] Test ready, pending, expiry, subscriber abort, source change and invalid decision before client implementation.
- [ ] Require a verified Jetson approval before preparing a result. Keep decoding and shared source WSOLA on device.
- [ ] Remove live metric/VAD/method-selection calls. A cold stem capability failure can use only an approved original fallback.
- [ ] Preserve pool keys, cue expiry, cancellation and the submitted audio graph. Retain automatic/manual common preparation.
- [ ] Add booking precomputation/embedding of approved strategies and preserve legacy set upgrade behavior.

## 4. Drum prelude executor and listening page

Files: `device-execution.ts`, `device-graph.ts`, new audition wrapper/tests and an independent HTML audition page.

- [ ] Test baseline graph equivalence, continuous B drum correction, approval tampering, missing PCM and total window/memory limits.
- [ ] Extend the graph with shared pre-roll source time. Main cue, other curves, EQ and voice gates remain frozen.
- [ ] Implement one-bar 0→0.25 B drum entry, two-bar hold, then `max(0.25,gb)` during the unchanged main window.
- [ ] Verify audition-only authority, source fingerprints and proof before enabling the layer.
- [ ] Provide three randomized versions per group, immediate voting, persistent notes and export; no completed-listening requirement.

## 5. Real evidence and delivery

- [ ] Select six previously benefited pairs from saved feedback. Reject inadequate prefix material or rhythm/headroom evidence without moving the main cue.
- [ ] Compare migrated judgments against current reference; record algorithm/input differences explicitly.
- [ ] Generate all three versions from the same source mapping; verify beat, vocal, phase continuity and zero remote final-render dependency.
- [ ] Actually play the page and check saved votes, pause/resume and boundaries. Publish the listening page with clear experimental status.
- [ ] Run TS, Python, Flutter, protected-source and Android asset checks; do not compile APK.
- [ ] Independent review, commit and push both repositories. Keep new prelude out of automatic playback pending listening results.
