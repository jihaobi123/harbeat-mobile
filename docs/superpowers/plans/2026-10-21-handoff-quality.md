# Handoff Quality Restoration Implementation Plan

> **For agentic workers:** Execute in this session with red-first regressions and independent code review.

**Goal:** Restore the accepted continuous player's entry-material quality for live Next.

**Architecture:** Use existing planContinuous over all eligible B windows to freeze entry identity. Select future A points inside that anchor, retain it through local input loading, and exclude full-duration double vocals for ordinary-master fallback.

**Tech Stack:** Existing TypeScript/Vitest engine, real metadata fixtures, Flutter host and browser QA.

- [x] Add real-fixture regressions: Straight→Make It Right at source123.7285668934 chooses w16-4 near125.628; full dual vocals Make It Right→아무노래 at90.388770975 rejects ordinary fallback; reference Attention→HIPHOP preserves legacy selected material at59.554648526.
- [x] Run tests and inspect actual failures before edits. Replace per-window baseline selection with the existing formal planner over bounded validated windows. Freeze B material before choosing A and preserve its identity through cold load/retries.
- [x] Keep source, tempo, continuous beats, original EQ, signal cancellation and candidate expiry gates. Update superseded earliest-window tests to enforce proximity within accepted material and prevent a return to milliseconds-over-quality.
- [x] Compare same-plan legacy/new rendering and prepare original vs repaired same-pair audio previews with shared level. Run TypeScript/typecheck, build engine and verify real UI Next without audio-thread lateness.
- [x] Independent review, address findings, document limitations and measured results, commit verified changes. Leave the original reference browser paused and preserve user direction preferences.
