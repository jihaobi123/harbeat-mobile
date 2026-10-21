param(
    [switch]$DiagnosticsOnly,
    [string]$AndroidSdk = '',
    [string]$Jdk = ''
)
# This script prepares and verifies source/assets. It never invokes an APK build.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $repository

function Find-Tool([string[]]$Names) {
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    throw "Missing command: $($Names -join ' / '). Install it and reopen PowerShell."
}
function Run-Checked([string]$Program, [string[]]$Arguments) {
    Write-Host ("`n> " + $Program + ' ' + ($Arguments -join ' '))
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Program" }
}

$flutter = Find-Tool @('flutter.bat', 'flutter')
$node = Find-Tool @('node.exe', 'node')
$npm = Find-Tool @('npm.cmd', 'npm')
$python = Find-Tool @('python.exe', 'python3', 'python')
$flutterVersion = (& $flutter --version --machine | Out-String | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Flutter SDK' }
if ($flutterVersion.frameworkVersion -ne '3.41.6') {
    throw "Use Flutter 3.41.6 (Dart 3.11.4) for this checkout; found $($flutterVersion.frameworkVersion)."
}
$nodeVersion = (& $node --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') { throw "Use Node.js 22 LTS; found $nodeVersion" }
Run-Checked $python @('-c', 'import sys; print(sys.version); sys.exit(0 if sys.version_info >= (3, 9) else 1)')

if (!$AndroidSdk) {
    foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android/Sdk'))) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { $AndroidSdk = $candidate; break }
    }
}
if (!$AndroidSdk -or !(Test-Path -LiteralPath $AndroidSdk)) { throw 'Android SDK missing. Install it in Android Studio or pass -AndroidSdk <path>.' }
foreach ($component in @('platform-tools/adb.exe', 'platforms/android-36/android.jar', 'build-tools/36.0.0/aapt.exe', 'ndk/28.2.13676358/source.properties')) {
    if (!(Test-Path -LiteralPath (Join-Path $AndroidSdk $component))) { throw "Android SDK component missing: $component. Install it with Android Studio SDK Manager." }
}
if (!(Get-ChildItem -Path (Join-Path $AndroidSdk 'cmake/*/bin/cmake.exe') -ErrorAction SilentlyContinue)) { throw 'CMake missing. Install CMake in Android Studio SDK Manager.' }
if (!$Jdk) {
    foreach ($candidate in @($env:JAVA_HOME, (Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'))) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'bin/java.exe'))) { $Jdk = $candidate; break }
    }
}
if (!$Jdk -or !(Test-Path -LiteralPath (Join-Path $Jdk 'bin/java.exe'))) { throw 'JDK missing. Pass -Jdk <Android Studio jbr directory> or configure JAVA_HOME.' }
$javaVersion = (& (Join-Path $Jdk 'bin/java.exe') --version | Out-String)
if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch '(?m)^(?:openjdk|java)\s+(\d+)') { throw 'Could not inspect JDK (JDK 17+ required)' }
if ([int]$Matches[1] -lt 17) { throw 'Android Gradle Plugin requires JDK 17 or newer.' }
Write-Host "Flutter $($flutterVersion.frameworkVersion); Node $nodeVersion; Android SDK $AndroidSdk; JDK $Jdk"
if ($DiagnosticsOnly) { Write-Host 'Diagnostics complete. No assets prepared and no APK created.'; exit 0 }

# Make Flutter use the same SDK/JDK that was checked above.
Run-Checked $flutter @('config', '--android-sdk', $AndroidSdk, '--jdk-dir', $Jdk)
Run-Checked $flutter @('doctor', '-v')
Run-Checked $flutter @('pub', 'get', '--enforce-lockfile')
# --download uses npm ci (package-lock.json), verifies every legacy asset SHA,
# and copies the complete local executor/worklet bundle into Android assets.
Run-Checked $python @('tools/build_realtime.py', '--download')
Run-Checked $python @('tools/build_activity_planner.py')
Run-Checked $python @('tools/verify_android_bundle.py')
Run-Checked $python @('-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_engine_build.py')
Run-Checked $python @('-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_android_bridge.py')
Run-Checked $flutter @('analyze', '--no-pub')
Run-Checked $flutter @('test', '--no-pub', '--concurrency=2')
Push-Location -LiteralPath (Join-Path $repository 'vendor/realtime-v3')
try { Run-Checked $npm @('test', '--', '--reporter=dot') } finally { Pop-Location }
Run-Checked $flutter @('build', 'web', '--no-pub', '--release', '--no-web-resources-cdn', '--no-wasm-dry-run', '--dart-define=HARBEAT_NAS_BASE_URL=http://127.0.0.1:8766')
Run-Checked $python @('tools/build_metric_web.py')
New-Item -ItemType Directory -Force -Path 'build/preflight' | Out-Null
@{ schema='harbeat.windows-preflight.v1'; completedAt=(Get-Date).ToUniversalTime().ToString('o'); flutter=$flutterVersion.frameworkVersion; node=$nodeVersion; apkBuilt=$false; deviceAudioValidated=$false } |
    ConvertTo-Json | Set-Content -LiteralPath 'build/preflight/windows.json' -Encoding UTF8
Write-Host "`nPre-APK checks complete. No APK created. Preview: python tools/serve_preview.py --port 8766"
Write-Host 'When ready, run: flutter build apk --release --target-platform android-arm64'
