# Client execution and preprocessing implementation plan

> **For agentic workers:** Use executing-plans to implement the following tasks, with separate owners for the audio executor, preprocessing, and Android build preparation.

**Goal:** Make source-bound local mixing available to the mobile web engine, add reusable preprocessing evidence, and publish reproducible source for Windows APK packaging.

**Architecture:** Jetson exports immutable per-track profiles and source/stem assets. A validated data-only plan selects existing cues and vocal constraints; the App schedules the transition on its audio clock. Existing renderer outputs remain reference evidence during migration.

**Tech Stack:** Flutter, TypeScript/Web Audio, pitch-preserving DSP, Python/librosa/NumPy, FastAPI, Android WebView, PowerShell.

## 1. Preprocessing and source manifest

- [x] Add versioned per-stem energy/activity/transient, drum onset/subdivision, local harmonic and beat/phrase evidence in the backend repository.
- [x] Add synthetic signal tests that distinguish onset patterns from downbeat-count ratios and preserve unknown evidence.
- [x] Export source-bound manifests and hashes without mutating published reports; reject mismatched report provenance.
- [x] Run the exporter on actual NAS material and record coverage and package versions.

## 2. Local execution

- [x] Add a separate validated local strategy/asset protocol outside pinned upstream sources.
- [x] Implement pitch-preserving tempo preparation on the device, shared source mapping, live master plus signed stem corrections, and bounded cache/decode.
- [x] Preserve existing selected cues, vocal checks, explicit nearest-cue requests and automatic later-cue behavior.
- [x] Test stale assets, pause/resume/seek/cancel, source mapping, and method control curves.
- [x] Verify a warmed transition completes without submitting a remote per-pair rendering job (HIPHOP → Make It Right, bass_filter, zero cloud render requests).

## 3. Distribution and reservations

- [x] Serve hashed public device manifests/assets through fixed routes; add preview and Android allowlists.
- [x] Prepare reusable source/stem assets for reservation sets and retain compatibility with saved sets.
- [x] Expose readiness honestly: downloadable assets, decoded assets, and validated strategies are distinct states.

## 4. Windows preparation and verification

- [x] Add Windows PowerShell preflight for Flutter, Android SDK/JDK, Node, Python, locked dependency installation and audio-engine asset build.
- [x] Run TypeScript tests/build, Flutter tests/analyze, Python tests, fingerprint checks, and browser playback checks.
- [x] Document remaining Windows/device-only validation; do not generate an APK in this request.
- [x] Review tracked diff and secret/generated-file exclusions; commit and push both source repositories.

## Acceptance

The default web engine must use the local path when its required assets are verified and ready. Missing evidence must not be reported as a successful stem transition. Existing original fallback may continue playback, with the actual method recorded. GitHub source must contain all build inputs and Windows commands; actual Android audio performance remains a separate device check.
