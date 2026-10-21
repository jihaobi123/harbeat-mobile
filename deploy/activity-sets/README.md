# Activity set service

This service stores private reservation records and prepares retained sets through the existing metric gateway. Reservation end times never delete a pack. Rebooking points at the same pack and does not enqueue another render.

The SQLite database contains credential hashes, reservation records, source identities, planner output, job IDs, errors and pinned results. A single worker prepares packs by their earliest reservation start time. It checkpoints each accepted job before polling and each verified result before moving on. Restarting the process resumes that job. The gateway's deterministic job IDs also cover a crash between submission and checkpointing.

## HTTP API

Nginx exposes loopback port 8792 at `/listen/set-api/`. All endpoints below, except workspace creation and health, require `Authorization: Bearer <token>`. Tokens have 256 bits of randomness, are returned once, and are stored only as SHA-256 hashes on the server. Keep the token in device secure storage; private workspace backup uses that same token. There is no shared default workspace or account login.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/workspaces` | empty | `201 {token}` |
| GET | `/health` | none | `{status:"ok",schema:"harbeat.activity-set.v1"}` |
| GET | `/reservations` | none | `{reservations:[Reservation]}` |
| POST | `/reservations` | Create | `201 Reservation` |
| GET | `/reservations/{id}` | none | `Reservation` |
| POST | `/reservations/{id}/reuse` | Reuse | `201 Reservation`, same `packId` |
| POST | `/reservations/{id}/prepare` | empty | `Reservation`, retry failed/corrupt tasks |
| GET | `/packs/{id}/manifest` | none | `Manifest` |

Create fields:

```json
{
  "name": "Test activity",
  "styles": ["Hip-Hop"],
  "startsAt": "2026-10-22T18:00:00+08:00",
  "durationMinutes": 60,
  "energy": 3,
  "trackLimit": 8
}
```

`startsAt` must include a timezone and fall between 60 seconds ago and 366 days ahead. `durationMinutes` is an integer from 15 through 480, `energy` from 1 through 5, and optional `trackLimit` from 4 through 12 (default 8). The name has 1–100 characters after trimming. Styles contains 1–8 labels of at most 80 characters each. Unknown fields are rejected. Reuse accepts only `startsAt`, `durationMinutes`, and optional `name`.

Reservation fields are `id`, `packId`, `name`, `styles`, `startsAt`, `endsAt`, `durationMinutes`, `energy`, `trackLimit`, `createdAt`, and `pack`. Dates are UTC ISO strings. `id` and `packId` are generated 32-character lowercase hex IDs. `pack` contains `id`, `state`, `prepared`, `total`, `failed`, `warnings`, `error`, `trackIds`, and `initialTrackId`.

Manifest fields are `schema:"harbeat.activity-set.v1"`, `packId`, `createdAt`, `state`, `prepared`, `total`, `failed`, `trackIds`, `initialTrackId`, `tracks`, `sourceFingerprints`, `warnings`, `error`, and `results`. Track summaries come from the existing planner. Each source fingerprint records `id`, `duration`, `detailUrl`, `detailSha256`, `reportId`, `provenance`, `native`, and `audioSegments`. The current library index resolves each track ID to its current detail path. The saved detail path and digest are audit records; source/report hashes, run ID, report ID and native/segment content identities determine staleness. Adding unrelated variants or changing a title does not invalidate an old set.

`results` contains verified `harbeat.metric-mix-result.v1` Prepared objects. It preserves the full decision, metrics, plan and source proof. Assets contains only the recommended method and `original`, with unchanged hashes and byte lengths. URLs become `/listen/set-media/<packId>/<jobId>/<method>.wav`. A pack is `ready` only when every planned edge succeeded; `partial` means some edges failed or no qualified edges exist, and `failed` means preparation could not start or all edges failed. `queued` and `preparing` are resumable. A current source/report revision produces `stale` on reads while preserving the old media and identity record. Create a fresh reservation to prepare a fresh pack for changed sources.

`prepare` retries failed jobs and damaged pinned assets. It preserves valid successful tasks. It cannot replace an old pack's source identity. A `ready` pack with intact assets is returned as-is. There is no delete endpoint.

Bad credentials receive 401; another workspace's IDs receive 404. Input validation returns 422. Limits return 429: five new workspaces per client IP per minute, 60 globally per hour, 50 reservations per workspace, three active packs per workspace and 20 active packs globally. Each request body is limited to 8 KiB. The candidate pool is at most 64 published, mix-ready tracks in the selected style family; the existing TS planner selects at most `trackLimit` tracks and two outgoing edges per track, with 24 edges total.

## Install

Run these steps on the existing listening host after reviewing the code and the Nginx server configuration. Use the host's Python 3.9+ executable and installed Node path.

1. Create `/srv/harbeat-listen/activity-sets/code`, `/srv/harbeat-listen/activity-sets/media`, and a dedicated venv at `/srv/harbeat-listen/activity-sets/venv`. The root and media directories must be traversable by Nginx (0755); database files remain private.
2. Copy `activity_sets/` into `code/activity_sets/`, and the built `tools/activity_set_plan.cjs` into `code/set-plan.cjs`. Copy this directory's requirements file and install it with the new venv's pip. Do not use an npm install on the host; the planner bundle includes its existing selection dependencies.
3. Install `harbeat-activity-sets.service` in `/etc/systemd/system/`. This matches the existing metric gateway's root-owned deployment and restricts writes to the set service directory. Verify `/usr/bin/node` and adjust `ACTIVITY_NODE` if needed. The gateway continues on port 8791.
4. Add `nginx-locations.conf` inside the existing HTTPS server. Place the set-media regex before broader regex locations. Keep the default fallback location after it. Nginx must overwrite `X-Real-IP`; the app accepts that header only from loopback. Preserve the existing smart API/media and listening routes.
5. Run `systemctl daemon-reload`, `systemctl enable --now harbeat-activity-sets`, `nginx -t`, then reload Nginx only if its configuration check succeeds.
6. Verify loopback `/health`, public `/listen/set-api/health`, unauthenticated 401 on `/reservations`, workspace isolation, and a clearly named test reservation. Record actual progress and counts, reload the page, then rebook the same pack. Never put workspace tokens in command arguments, logs or evidence receipts.

Planner input omits unused preprocessing report fields and keeps the exact source-bound vocal evidence read by the existing planner. An equivalence fixture produces the same eight automatic/nearby edges from full and compact inputs (168,401 to 23,457 JSON bytes). Media hashes and current source identities are cached against device/inode/size/mtime/ctime, so listing unchanged reservations does not reread WAVs. Writes, replacements and hardlink changes invalidate those entries.

The worker uses a lifetime filesystem lock to guard against accidental extra processes. Run one Uvicorn worker. Outbound requests use only `http://127.0.0.1:8791/jobs`, with the existing required Origin. No user-controlled network address or filesystem path is accepted. The Node command is fixed by deployment configuration and receives JSON on stdin.

Metric output files are verified by size and SHA-256, then hardlinked into the set's own media directory. A cross-filesystem layout or nonpublic source mode uses an atomic verified copy. Gateway cache cleanup can unlink its copy without removing pinned media. Files, symlinks and URLs outside the allowed identity paths are rejected. Filesystem or space failures remain failed checkpoints; the service never deletes an older set to make room.

## Verify and roll back

From the repository root, run:

```sh
python3 -m unittest discover -s tests_activity_sets -v
```

Tests use temporary SQLite databases and real files, plus a deterministic injected gateway/planner seam and a real Node planner equivalence fixture. The latter uses the repository’s installed esbuild and the built planner bundle. They cover workspace isolation, hashed credentials, schedule validation, concurrent queue limits, reuse and restart, source revision behavior, strict result/source checks, corruption detection, retry, and retained hardlinks. Install `requirements-test.txt` if FastAPI TestClient's httpx dependency is missing. Real cloud render and Nginx checks are deployment acceptance steps; the fixture bytes are not evidence of playable audio.

For rollback, stop/disable `harbeat-activity-sets`, remove only the two new API/media locations and the media fallback, validate and reload Nginx, then restore the previous frontend. Leave `/srv/harbeat-listen/activity-sets/` intact, including SQLite WAL files, pinned media and source records. The existing gateway and ordinary playback continue independently. Back up a running database with SQLite's backup API, or stop the service before copying its database and WAL files.

## Separate phone frontend

`nginx-app.conf` serves a Flutter build at `/listen/app/` from `/srv/harbeat-listen/mobile-current/`. Build with `--base-href=/listen/app/` and the production NAS address. Include the existing metric engine assets in the build. API requests keep using `/listen/set-api/`; the original listening release and import publisher keep their own `/srv/harbeat-listen/current` link.

Upload each finished build into a new `/srv/harbeat-listen/mobile-releases/<release>/` directory. Verify the index base href and engine assets before replacing `mobile-current` with a temporary symlink plus `os.replace`. Add the app snippet to the HTTPS server, run `nginx -t`, and reload only on success. The app location includes the host MIME table and adds WebAssembly and font types explicitly; CanvasKit requires `application/wasm`. Verify actual WASM, JavaScript, JSON and font response headers before browser acceptance. Save the old link target and SSL configuration before changing them. Rollback restores that target and removes only the new app snippet include; retain set API data and media.

An isolated loopback Nginx probe on the deployed host verified the exact alias/try_files configuration: app index, main JavaScript, a nested JSON asset and a deep navigation path all returned 200 with the expected body and MIME type. The probe did not change the public route. Its receipt is under `/srv/harbeat-listen/activity-sets/deploy/app-route-probe-20261021T050643Z/receipt.json`.

The deployment receipt records static entry and MIME checks, including every WASM file and the actual Material Icons OTF. This build contains no WOFF2 file. For a real prepared pack, bundle `tests_activity_sets/check_manifest.ts` and pass `{manifest,tracks}` on stdin, using current tracks fetched through the current public library index. This runs the actual ActivitySession validator; its input and output contain no bearer token.

The first browser acceptance caught a WebAssembly MIME mismatch that plain JS/HTML checks missed. Adding the WASM type alone left old browser entries revalidating with 304 and their cached `application/octet-stream` metadata. The deployed WASM mtimes were advanced with byte hashes unchanged. Checks using the old ETag, old Last-Modified date, and both now receive 200 `application/wasm`. Keep conditional requests in deployment acceptance when correcting response metadata; a fresh uncached 200 is insufficient evidence. The before/after headers are saved in `wasm-cache-before.json` and `wasm-cache-after.json`.

The real acceptance pack completed all six planned edges for four tracks, with no failures or warnings. `deployment-receipt.json` records that the actual TypeScript `ActivitySession.open` accepted the complete server manifest against freshly fetched current library tracks. The test workspace credential remains solely in local `ops/private` storage and is excluded from Git and frontend uploads.
