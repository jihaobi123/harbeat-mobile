# Activity Sets Implementation Plan

> Execute inline with red-first tests and independent review at backend and playback integration checkpoints.

**Goal:** Persistent cloud-prepared reservations in My, playable reusable sets, and an audited Hip-Hop library expansion.

**Architecture:** Separate authenticated workspace/store/worker service; bundled existing TS planner; Flutter repository/controller/screens; small metric adapter for prepared set results. Existing DSP and planner files remain pinned.

**Tech Stack:** Python/FastAPI/SQLite, TypeScript/Vitest/Node bundle, Dart/Flutter, existing NAS/Jetson gateway.

- [ ] Audit music playlist/import/discovery stages and restore source-bound failed publication. Save actual counts and status receipts; collect additional eligible Hip-Hop inputs through existing tools.
- [ ] Write backend tests for private workspace isolation, durable reservation/set records, reuse, lifecycle and immutable media pinning. Implement bounded service and worker under `activity_sets/`, with no account or arbitrary network proxy shortcuts.
- [ ] Add `tools/activity_set_plan.ts` using unchanged existing selection code, test bounded style pool and scalar plans, bundle for installed Node. Worker creates checkpoints, submits one metric job at a time, persists progress and retains pinned results.
- [ ] Add TypeScript set manifest validation, source checks, pool restriction, same-cue prepared reuse and cancellable local download with red-first tests. Wire commands through existing bridge; preserve regular playback.
- [ ] Add Dart activity repository, secure workspace store, controller state and My reservation screens with repository/widget tests. Persist local summaries and provide explicit private backup migration. Detail enters actual playback and rebooking references retained pack.
- [ ] Run backend/TS/Flutter checks, independent reviews and deploy isolated loopback service/routes with rollback. Build current localhost frontend and test real create/prepare/open/reload/reuse on a phone-width page. Report real prepared/partial counts, never mock ready.
- [ ] Finish Hip-Hop publication/analysis audit, count new usable versus NAS-only/failed/pending, document source and remaining constraints. Commit verified code and evidence.
