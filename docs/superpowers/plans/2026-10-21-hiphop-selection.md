# Hip-Hop Selection Implementation Plan

> **For agentic workers:** Use executing-plans to implement the tasks in this session; request an independent review before completion.

**Goal:** Restore valid Hip-Hop recommendations while keeping audio and safety gates unchanged.

**Architecture:** Candidate pools separate fresh and recent tracks, load in batches, and rank a complete stage together. Energy is a measured transition preference. Selection diagnostics travel with the existing metric snapshot and export.

**Tech Stack:** TypeScript/Vitest metric engine; Flutter/Dart interface; existing Python local preview.

- [x] Add failing smart-selection tests for parent-style matching and steady energy at high preference; preserve real-coverage and beat/speed rejection tests. Run `npm test -- src/mobile/smart-selection.test.ts` in vendor/realtime-v3.
- [x] Add candidate stages in smart-selection.ts and retain shortlist as first-stage/first-batch compatibility wrapper. Update energy rejection to retain only the existing ±6dB continuity bound; leave ranking target unchanged. Run the focused tests.
- [x] Add integration regressions in smart-auto.test.ts: invalid fresh metadata cannot hide valid recent track; >8 candidates are fully checked; recent tracks are not read when fresh succeeds; obsolete requests cannot adopt a fallback. Run `npm test -- src/mobile/smart-auto.test.ts` and inspect expected failures before implementation.
- [x] Integrate stage loading and ranking in metric.ts, reading at most two metadata files concurrently. Keep signal and source validation after every read; attach selection diagnostics to recommendation/snapshot/export and useful no-match messages. Preserve preferred recommendation, exclusions, nearby fallback and cloud arm behavior.
- [x] Update the existing energy tests to express preference, not hard monotonic direction; test an actual >6dB discontinuity for honest no-match. Add a Flutter regression for actual selected-method display. Update phone_screens.dart with the visible energy explanation and selection summary; build no new controls.
- [x] Run the TypeScript suite and typecheck plus Flutter analyze/test. Re-run the actual corpus audit and store compact before/after evidence under outputs, avoiding raw music or enormous snapshots in git.
- [x] Independently review changes, fix findings, build web and stage metric engine. Use the actual current browser tab to verify direct Next, energy/style selection and automatic behavior. Save exported playback evidence; restore preferences and stop playback.
- [x] Update unified-playback docs with final semantics, checks and limits. Commit the concrete verified changes on the existing codex branch.
