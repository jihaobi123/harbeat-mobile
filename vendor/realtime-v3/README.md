# HarBeat V3 mobile bundle

Pinned upstream: `jihaobi123/harbeat-client` commit
`279b65da50d436586c220fb38befdb03f6571099` (audio-stack branch).

`upstream.json` records byte-level SHA256 for the copied planner, decision audit,
transport, cache, AudioWorklet limiter, their tests, dependency lock and upstream
documentation. These files are unchanged. `.gitattributes` preserves their bytes.
`src/mobile` adds the Android lifecycle/focus adapter. `engine.ts` exposes a small
command/state protocol to the existing Flutter play page; `main.tsx` retains the
earlier standalone UI as a reference, with no Android navigation entry.

The catalog contains six songs and 218 SHA-bound single-song audio assets,
282,540,060 bytes. The six native excerpts and 212 tempo-adjusted entry clips are
bundled, not pre-mixed transitions. Selection, EQ, fading, summing and output
limiting run in the phone WebView's Web Audio engine. This is not a Kotlin/C++ DSP
port, nor is it sample-identical to the offline FFmpeg algorithm.

## Rebuild

From the Flutter repository root, with Node, npm and Python installed:

```text
python tools/build_realtime.py --download
cd vendor/realtime-v3
npm test -- --maxWorkers=2 --minWorkers=1
cd ../..
flutter build apk --release --target-platform android-arm64
```

For an already prepared local environment use `python tools/build_realtime.py`.
If the npm registry is unavailable, a registry mirror can be selected through
`npm_config_registry`; npm still verifies the upstream lockfile integrity.
No dependency lock or source hash needs to be changed for that.

The build verifies source bytes and every media SHA, compiles TypeScript/Vite,
and stages the generated Android assets with `mobile-build.json`. Generated
media, node_modules and bundle output are ignored by Git. Run the preparation
step before an APK build; Gradle intentionally does not download music.

## Android host

`RealtimeMixEngine`, owned by MainActivity, serves APK content at the secure virtual origin
`https://appassets.androidplatform.net/assets/realtime/`. It blocks direct WebView network access,
external navigation, file/content access and frames. AndroidX WebViewAssetLoader
provides the secure origin required for AudioWorklet and SHA256. The only bridge
operations are audio focus, local V3 log save/export, command replies and state.
No additional Android activity is opened. A one-pixel WebView hosts only the audio
engine; all visible controls, progress, mini-player and candidate selection remain
Flutter widgets. `harbeat/realtime` and `harbeat/realtime/state` carry commands and
snapshots. Flutter stops its other player before enabling V3, ignores inactive
player events, and requires a successful V3 stop before standard playback.

Switching Flutter tabs keeps the same session. Background, focus loss and unplugging headphones suspend the audio clock; new
preparation is invalidated. Returning does not automatically resume. This release
does not offer lock-screen/background mixing or BLE control of this V3 engine.
Log exports use Android MediaStore Downloads/HarBeat (API 29+). A best-effort local
last-session snapshot is kept under the app's external files/mix-logs directory.
No logs or account credentials are sent to a server.

The 0.1.6 dance-set extension loads style/time-selected NAS tracks through
`src/mobile/dance.ts`, without changing the pinned planner or DSP. Only paths
matching `/dance-assets/<SHA256>.flac` can use the native fixed-host HTTPS asset
proxy. Every downloaded file is SHA-verified and bounded to 64 MB, and the disk
cache is capped at 600 MB. The existing 192 MB decoded-PCM limit still applies.
Set timing accounts for the body remaining after each entry window; pausing
freezes the shared clock. See `docs/dance-set-20260921.md` at the Flutter root.

## iOS

The TypeScript engine and phone UI can be reused in WKWebView, but this checkout
only adds an Android host. iOS still uses the existing external web preview;
it requires a Mac/Xcode build, WKWebView asset routing/AudioWorklet checks,
AVAudioSession interruption handling and device verification before shipment.
Do not claim native iOS or background support from this Android build.

References:
- https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader
