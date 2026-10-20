# Direct Next Handoff Implementation Plan

> Execution stays in the current isolated mobile checkout. The user supplied the interaction design; implement it inline and request an independent code review before publishing the result.

**Goal:** Right-side Next and live direction changes schedule a nearby handoff; inactivity retains the existing automatic best-cue handoff.

**Architecture:** Add a pending user intent to MetricRun. Reuse the metadata shortlist and existing measured energy gates, then choose a nearby plan and call mixNearby with the same energy acceptance predicate on every retry. Keep the existing automatic branch and single transport.

**Tech Stack:** TypeScript/Vitest, Flutter/Dart, Web Audio.

### 1. Selection and request regressions

Files: vendor/realtime-v3/src/mobile/{smart-auto.test,smart-selection.test,nearby.test}.ts.

- [ ] Add tests that requestNext()+tick() arms a cue before 15 seconds without a cloud job, even with automatic disabled.
- [ ] Add live style and energy changes, latest direction replacing stalled metadata, paused direction, failed energy gates, and accepted plan filtering on retries.
- [ ] Run `npm test -- src/mobile/smart-auto.test.ts src/mobile/smart-selection.test.ts src/mobile/nearby.test.ts` and observe expected failures before source edits.

### 2. Implement single-player intent handling

Files: vendor/realtime-v3/src/mobile/{metric,smart-selection,nearby}.ts.

- [ ] Extract the existing source-bound four-block energy calculation as choiceForPlan; preserve the original numerical thresholds and default rankChoices order.
- [ ] Add rankNearbyChoices using nearbyPlan with a plan acceptance predicate, sorting by nearest start and then existing quality/energy score.
- [ ] Extend mixNearby to accept the predicate and a candidate callback so retries and displayed recommendation describe the actual scheduled cue.
- [ ] Queue a pending next/direction intent in MetricRun; prioritize it before the automatic flag/result branch in tick. Share existing cancellation, source validation, cloud result reuse and local rendering.
- [ ] Clear pending intent on explicit interruption and preserve committed transitions.
- [ ] Re-run the failing tests, then the complete TypeScript suite and typecheck.

### 3. Main controls

Files: lib/src/{phone_screens,smart_controller}.dart; test/metric_player_test.dart.

- [ ] Change the right control to 下一首, dispatching the existing recommend command. Keep the automatic preference unchanged by manual Next.
- [ ] Replace the redundant main left cut button with an automatic status indicator; retain existing legacy controls.
- [ ] Update widget expectations and supporting user-facing descriptions to the direct action behavior.
- [ ] Run `flutter analyze --no-pub` and `flutter test --no-pub --reporter expanded`.

### 4. Deliver and verify

- [ ] Build Flutter web using the existing loopback NAS preview base, then run `python3 tools/build_metric_web.py` to verify pinned sources and stage the engine.
- [ ] Independently review cancellation, energy at actual nearby cues, inactive automatic behavior and UI semantics. Resolve important findings.
- [ ] Refresh the existing user tab at 127.0.0.1:8766, verify Next and each direction input, export observed playback records and save a screenshot.
- [ ] Pause test playback, document measured results and APK limitations, commit the scoped changes and push the existing mobile branch.
