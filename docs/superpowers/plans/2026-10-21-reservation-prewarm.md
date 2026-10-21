# Reservation candidates and rolling device preparation

> **For agentic workers:** Use executing-plans task by task. The user approved multiple qualified cues, several candidate songs and shared device preparation; existing cue, phrase and vocal gates remain authoritative.

**Goal:** Prepare reusable choices before a manual or automatic handoff, without making a button press cut across a musical boundary.

**Architecture:** Cloud reservations hold a bounded source-bound index of qualified candidate plans across the song. The device verifies those candidates against current source evidence and prepares a small rolling pool of real PCM, pitch-preserving source windows and method metrics. Automatic and manual planning retain their established ranking and consume the same exact-key prepared results.

**Tech stack:** TypeScript/Web Audio, Python reservation service, Flutter, existing SoundTouch worker and source-bound manifests.

## Candidate generation

Files: `src/mobile/activity-plan.ts`, `activity_sets/worker.py`, `activity_sets/execution.py`, `tools/build_activity_planner.py`.

- [x] Test multiple chronological qualified cues, distinct next-track options and honest coverage gaps using `qualityTrack` fixtures.
- [x] Export `harbeat.activity-execution.v2`: at most 24 edges/source and 288/set, full cue geometry, original plan ID and source identities.
- [x] Preserve legacy packs; prepare each track asset once, not each edge as a mixed WAV.
- [x] Reject forged source bindings, energy/tempo/geometry and capacity violations in Python tests.

## Candidate verification

Files: `src/mobile/activity-session.ts`, `activity-session.test.ts`.

- [x] Add tests that open v2 packs with real planning fixtures, return multiple future candidates, skip elapsed cues and reject changed vocal evidence or forged geometry.
- [x] Reconstruct saved plans with the existing beat/vocal planner, dynamic EQ and energy check; retain bound planning evidence for candidates.
- [x] Expose `candidateCount`, coverage and `candidates(a, position, energy)`; retain old v1 and rendered-set compatibility.

## Rolling shared preparation

Files: `src/mobile/prepared-pool.ts`, `device-prepare.ts`, `metric.ts` and their tests.

- [x] Test serial coalescing, independently cancellable subscribers, memory eviction and pins before integration.
- [x] Warm nearby choices while playing and use identical preparation keys for automatic, manual and background calls.
- [x] Cancel superseded work on seek/direction/session changes; protect a committed audio plan and never select an expired cached cue.
- [x] Expose actual future decoded readiness and failures, not just successful encoded downloads.
- [x] Verify a warmed manual and automatic handoff reuse prior prepared results, with no remote pair-render request.

## UI, build and delivery

Files: `lib/src/activity_repository.dart`, `activity_screens.dart`, `phone_screens.dart`, related Flutter tests and readiness documentation.

- [x] Distinguish cloud candidate preparation, encoded download and rolling local-ready candidates.
- [x] Run TS, Flutter, Python, fingerprint, Android asset and browser real-song checks; do not compile APK.
- [x] Deploy updated reservation planner/service and web executor, retaining previous releases.
- [x] Review, commit and push the mobile branch; document coverage gaps and target-device limits.
