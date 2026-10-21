# Reservation candidate preparation

`tools/activity_set_plan.ts` uses the same automatic and nearby cue planners as
live playback. It samples eight chronological regions per selected source song,
retains up to three distinct next-song alternatives in each region, and preserves
the automatic quality planner's late-song choice. Final dynamic EQ is checked for
every saved alternative, alongside the existing beat, complete-bar, vocal overlap,
speed and measured energy rules. The thresholds are unchanged.

The result is bounded to 24 edges per source and 288 edges for a 12-song set.
`candidate_coverage_gaps:<trackId>` reports empty cue regions. Region counts describe
prepared candidate locations; they do not promise an eligible transition after
every possible click or for directions outside the reserved set. A nearby click
continues the current song until a valid future musical cue.

The outer manifest remains `harbeat.activity-set.v1`. New source-execution packs
contain `execution.schema = harbeat.activity-execution.v2`, `energy`, reusable
`tracks`, source-bound `edges` and `coverage`. Each edge retains the original plan
ID and complete cue geometry, selection kind, region and both tracks' report,
run, master, report and vocal identities. The device reconstructs and revalidates
the plan against its current catalog before preparing it. No unverified saved
timestamp can override live beat or vocal checks. Legacy v1 packs remain readable.

Each source song is prepared once. Additional edges are strategy metadata rather
than separate render jobs. New v2 packs require the reusable execution asset
publisher; an installation configured only for the legacy pair-render service
fails explicitly instead of enqueuing hundreds of WAV renders.

The candidate pool skips sources explicitly listed as unavailable by the current
execution publisher, so a failed source cannot make the entire selected set fail.
Pending sources remain eligible and enter the CPU preparation queue. If a repaired
manifest has appeared while its index still lists an earlier failure, normal
source and asset validation takes precedence over that stale exclusion.
If a source becomes excluded while a set is queued or waiting for publication,
the worker replans that pending set from the remaining pool.

Existing ready v1 reservations remain usable. Their “prepare more cues” action
explicitly queues a v2 replan; reading or reusing the old set does not rewrite it.
Preparing an already valid v2 set reuses its candidates and source assets.
An explicit replan preserves the available saved song IDs, their actual count
and the initial song when it remains available. Updated analysis refreshes the
evidence for those same IDs. Missing or publisher-excluded songs may be replaced
from the current style pool, with `retained_track_unavailable:<id>` and
`retained_track_replacement:<id>` warnings. This preference applies only to that
replan; fresh reservations still select from the full bounded pool.
Saved IDs remain eligible when only their style labels change; they must still
pass playback, mix and execution availability checks. Replacement songs continue
to match the reservation's requested style.

Regenerate the bundled planner after changing its TypeScript dependencies:

```sh
python tools/build_activity_planner.py
```

The build script supports macOS, Windows and Linux after installing the vendored
Node dependencies. The cloud planner remains compatible with Node 12.
