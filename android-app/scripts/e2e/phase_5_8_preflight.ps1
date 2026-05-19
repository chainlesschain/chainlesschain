# Phase 5.8 真机 E2E Preflight + Monitoring Helper
#
# Usage:
#   .\phase_5_8_preflight.ps1                  # preflight checks only
#   .\phase_5_8_preflight.ps1 -StartLogcat     # also start logcat in this window
#   .\phase_5_8_preflight.ps1 -CheckResidual   # one-shot residual scan
#
# Companion SOP: docs/design/Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md
# Checklist: docs/design/Android_AI_Chat_CC_Exec_Phase_5_8_Checklist.md

param(
    [switch]$StartLogcat,
    [switch]$CheckResidual
)

$ErrorActionPreference = "Stop"
$PKG = "com.chainlesschain.android"
$EXPECTED_MODEL = "24115RA8EC"
$MIN_CC_VERSION = "0.162.0"

function Section($title) {
    Write-Host ""
    Write-Host "═══ $title ═══" -ForegroundColor Cyan
}

function Pass($msg) { Write-Host "  PASS  " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Fail($msg) { Write-Host "  FAIL  " -ForegroundColor Red -NoNewline; Write-Host $msg }
function Warn($msg) { Write-Host "  WARN  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }

# ---- 0. adb sanity ----
Section "0. adb / device sanity"
$devices = adb devices 2>&1
$onlineCount = ($devices | Select-String -Pattern "^\S+\s+device$" -ErrorAction SilentlyContinue).Count
if ($onlineCount -eq 0) {
    Fail "adb devices reports no online devices"
    Write-Host "  Hint: replug USB, accept the trust dialog, rerun this script"
    exit 2
}
Pass "$onlineCount device(s) online"

$model = (adb shell getprop ro.product.model).Trim()
if ($model -ne $EXPECTED_MODEL) {
    Warn "device model is '$model' (expected $EXPECTED_MODEL — Xiaomi). Continuing anyway."
} else {
    Pass "model = $model"
}

# ---- 1. Phase 2.5 cc bundle health ----
Section "1. Phase 2.5 cc bundle health"
$ccJsPath = "files/usr/lib/node_modules/chainlesschain/bin/chainlesschain.js"
$ccJsCheck = adb shell "run-as $PKG ls $ccJsPath" 2>&1
if ($LASTEXITCODE -ne 0 -or $ccJsCheck -match "No such") {
    Fail "cc CLI snapshot missing at $ccJsPath"
    Write-Host "  Hint: open the app's Local Terminal tab once to trigger bootstrap"
    exit 3
}
Pass "cc.js present"

$ccVersion = (adb shell "run-as $PKG ./files/usr/bin/node ./$ccJsPath -v" 2>&1).Trim()
if ($ccVersion -notmatch "^[\d.]+") {
    Fail "cc --version returned: $ccVersion"
    exit 4
}
Pass "cc version = $ccVersion"

# Reuse the v1 minimum-version compare logic (semver-major.minor.patch)
function VersionAtLeast([string]$actual, [string]$min) {
    $a = ($actual -replace '^v', '' -split '[-+]')[0] -split '\.' | ForEach-Object { [int]$_ }
    $m = $min -split '\.' | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt [Math]::Max($a.Length, $m.Length); $i++) {
        $av = if ($i -lt $a.Length) { $a[$i] } else { 0 }
        $mv = if ($i -lt $m.Length) { $m[$i] } else { 0 }
        if ($av -ne $mv) { return $av -gt $mv }
    }
    return $true
}
if (-not (VersionAtLeast $ccVersion $MIN_CC_VERSION)) {
    Fail "cc version $ccVersion < required $MIN_CC_VERSION"
    exit 5
}
Pass "cc version >= $MIN_CC_VERSION"

# ---- 2. APK installation status ----
Section "2. APK install state"
$pmCheck = (adb shell "pm list packages $PKG" 2>&1).Trim()
if (-not $pmCheck) {
    Fail "package $PKG not installed"
    Write-Host "  Hint: run from android-app/:"
    Write-Host "    ./gradlew :app:assembleDebug"
    Write-Host "    adb install -r app/build/outputs/apk/debug/app-debug.apk"
    exit 6
}
Pass "package installed: $pmCheck"

# ---- 3. residual scan (manual gate after each E* scenario) ----
if ($CheckResidual) {
    Section "Residual scan (after-scenario gate)"
    $residual = adb shell "run-as $PKG ps -A 2>/dev/null" 2>&1 |
                Select-String -Pattern "node|chainlesschain"
    if ($residual) {
        Fail "RESIDUAL PROCESSES FOUND — this is a Blocker for E5 / E7:"
        $residual | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host "  Decision: do NOT mark this scenario as Pass."
    } else {
        Pass "0 residual node/chainlesschain processes"
    }
    exit 0
}

# ---- 4. logcat filter (Window A in SOP §3) ----
if ($StartLogcat) {
    Section "Logcat (Ctrl+C to stop)"
    Write-Host "Filter: CcChatViewModel|CcChatOrchestrator|CcExecService|CcToolCallDispatcher|CcAllowlist|FATAL|ANR|tombstone"
    Write-Host ""
    adb logcat -c
    # PS doesn't pipe-grep adb logcat nicely; use Select-String on lines as they stream.
    adb logcat | Select-String -Pattern 'CcChat|CcExec|CcTool|CcAllowlist|FATAL|ANR|crash|tombstone'
    exit 0
}

# ---- 5. summary + next steps ----
Section "Preflight summary"
Pass "All preflight checks GREEN — ready to run the 9 E2E scenarios"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1) Open 3 PowerShell windows."
Write-Host "  2) Window A: .\$($MyInvocation.MyCommand.Name) -StartLogcat"
Write-Host "  3) Window B: after each E* scenario, run"
Write-Host "       .\$($MyInvocation.MyCommand.Name) -CheckResidual"
Write-Host "  4) Window C: adb shell (for ad-hoc fs queries)"
Write-Host "  5) Walk through Phase 5.8 checklist E1-E9 in the app."
Write-Host "  6) Record results on the printable checklist:"
Write-Host "       docs/design/Android_AI_Chat_CC_Exec_Phase_5_8_Checklist.md"
