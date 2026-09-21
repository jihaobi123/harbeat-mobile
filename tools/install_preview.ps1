param(
    [Parameter(Mandatory=$true)][string]$Apk,
    [Parameter(Mandatory=$true)][string]$Serial,
    [ValidateSet('com.example.harbeat.preview','com.example.harbeat.nativeqa')]
    [string]$ExpectedPackage = 'com.example.harbeat.preview',
    [string]$AndroidSdk = "$env:LOCALAPPDATA/Android/Sdk"
)
$ErrorActionPreference = 'Stop'
$resolvedApk = (Resolve-Path -LiteralPath $Apk).Path
$adb = Join-Path $AndroidSdk 'platform-tools/adb.exe'
$aapt = Join-Path $AndroidSdk 'build-tools/36.0.0/aapt.exe'
$signer = Join-Path $AndroidSdk 'build-tools/36.0.0/apksigner.bat'
$badging = & $aapt dump badging $resolvedApk
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect APK' }
$packageLine = $badging | Select-Object -First 1
if ($packageLine -notmatch "^package: name='([^']+)'" -or $Matches[1] -ne $ExpectedPackage) {
    throw "Refusing unexpected application ID: $packageLine"
}
$newSignature = & $signer verify --print-certs $resolvedApk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
$newDigest = ($newSignature | Select-String '^Signer #1 certificate SHA-256 digest:').Line
$installedPath = & $adb -s $Serial shell pm path $ExpectedPackage
$installedPath = ($installedPath | Where-Object { $_ -match '^package:.*base\.apk$' } | Select-Object -First 1)
if ($installedPath) {
    $backupDir = Join-Path $PSScriptRoot '../outputs/install-backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $backupApk = Join-Path $backupDir ("$ExpectedPackage-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.apk')
    & $adb -s $Serial pull $installedPath.Substring(8).Trim() $backupApk
    if ($LASTEXITCODE -ne 0) { throw 'Could not back up installed preview APK' }
    $oldSignature = & $signer verify --print-certs $backupApk
    if ($LASTEXITCODE -ne 0) { throw 'Installed signature verification failed' }
    $oldDigest = ($oldSignature | Select-String '^Signer #1 certificate SHA-256 digest:').Line
    if (!$newDigest -or $newDigest -ne $oldDigest) { throw 'Signature mismatch; refusing installation. No uninstall will be attempted.' }
}
Write-Output "Verified $packageLine"
& $adb -s $Serial install -r $resolvedApk
if ($LASTEXITCODE -ne 0) { throw 'Installation failed. Existing application will not be uninstalled.' }
