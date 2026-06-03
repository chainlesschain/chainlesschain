<#
.SYNOPSIS
    Time-measure Setup.exe install + uninstall on Windows for the B4 asar
    surgery benchmark (issue #8).

.DESCRIPTION
    Runs the silent install (`Setup.exe /S`), times wall-clock from launch to
    process-exit, prints elapsed seconds + summary. Optionally runs the silent
    uninstall and times that too. Emits a JSON line at the end so a CI runner
    can parse the result.

    Baseline reference: ~1201 s (~20 min) on `asar: false` Win10 (Defender on,
    HDD), per issue #8 problem statement. Target with B4 surgery: <360 s (5 min).

.PARAMETER InstallerPath
    Path to ChainlessChain-Setup-<version>.exe. Defaults to the only matching
    exe found in the current directory.

.PARAMETER Uninstall
    If set, also runs the uninstaller after install and times it.

.PARAMETER Json
    If set, emits a single JSON line with the timing fields at the end.
    Useful for CI consumption.

.EXAMPLE
    PS> .\install-benchmark.ps1
    Install completed in 287.4 s

.EXAMPLE
    PS> .\install-benchmark.ps1 -InstallerPath D:\dl\ChainlessChain-Setup-5.0.3.39.exe -Uninstall -Json
    {"installer":"...","installSeconds":287.4,"uninstallSeconds":42.1,"version":"5.0.3.39"}

.NOTES
    - MUST run on a clean VM (no prior install of this app).
    - Must NOT have Defender exclusions for the install dir or app dir.
    - Run as admin if the installer asks for elevation; the elevation prompt
      blocks the timer, so consider switching the installer to perMachine: false
      OR pre-clicking through UAC.
    - Per-machine installers (`perMachine: true` in electron-builder.yml) write
      to %ProgramFiles%; per-user write to %LocalAppData%\Programs\.
#>

[CmdletBinding()]
param(
    [string]$InstallerPath,
    [switch]$Uninstall,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

# 1. Locate the installer if not supplied.
if (-not $InstallerPath) {
    $candidates = Get-ChildItem -Path '.' -Filter 'ChainlessChain-Setup-*.exe' -File -ErrorAction SilentlyContinue
    if ($candidates.Count -eq 0) {
        throw 'Cannot find ChainlessChain-Setup-*.exe in current dir. Pass -InstallerPath.'
    }
    if ($candidates.Count -gt 1) {
        throw "Multiple Setup-*.exe found ($($candidates.Count)) — pass -InstallerPath explicitly."
    }
    $InstallerPath = $candidates[0].FullName
}

if (-not (Test-Path $InstallerPath)) {
    throw "Installer not found: $InstallerPath"
}

$exe = (Resolve-Path $InstallerPath).Path
$installerSize = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "Installer    : $exe"
Write-Host "Size         : $installerSize MB"

# 2. Extract version from the filename (best effort).
$version = if ($exe -match 'ChainlessChain-Setup-([\d.]+)\.exe') { $Matches[1] } else { 'unknown' }
Write-Host "Version      : $version"
Write-Host ''

# 3. Time the install.
Write-Host '=== Installing (silent) ==='
$installStart = Get-Date

# `/S` = NSIS silent install. Start-Process -Wait waits for the installer
# process AND any spawned uninstaller helper to exit. The Out-Null discards
# the (empty) Start-Process output but doesn't suppress writes to the same
# console handle, which the installer may still produce — that's fine.
Start-Process -FilePath $exe -ArgumentList '/S' -Wait -NoNewWindow

$installSeconds = [math]::Round(((Get-Date) - $installStart).TotalSeconds, 1)
Write-Host ''
Write-Host "Install completed in $installSeconds s"

# 4. Optional uninstall.
$uninstallSeconds = $null
if ($Uninstall) {
    # NSIS perMachine installers register Uninstall info under
    # HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\<AppId>.
    # The `UninstallString` field is the path we invoke. Discover it
    # dynamically since per-machine vs per-user differs.
    $uninstallEntries = @()
    $uninstallRoots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $uninstallRoots) {
        if (Test-Path $root) {
            $uninstallEntries += Get-ChildItem $root -ErrorAction SilentlyContinue |
                Get-ItemProperty -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -eq 'ChainlessChain' -or $_.DisplayName -like 'ChainlessChain*' }
        }
    }

    if ($uninstallEntries.Count -eq 0) {
        Write-Warning 'ChainlessChain not found in registry — install may have failed silently. Skipping uninstall.'
    } else {
        $entry = $uninstallEntries[0]
        $uninstallString = $entry.UninstallString
        # NSIS UninstallString is `"C:\path\Uninstall <name>.exe"` — strip
        # outer quotes and pass `/S` for silent.
        $uninstallExe = $uninstallString -replace '^"' -replace '"$'

        Write-Host ''
        Write-Host '=== Uninstalling (silent) ==='
        Write-Host "Found: $($entry.DisplayName) at $uninstallExe"
        $uninstallStart = Get-Date
        Start-Process -FilePath $uninstallExe -ArgumentList '/S' -Wait -NoNewWindow
        $uninstallSeconds = [math]::Round(((Get-Date) - $uninstallStart).TotalSeconds, 1)
        Write-Host "Uninstall completed in $uninstallSeconds s"
    }
}

# 5. Summary line for CI.
Write-Host ''
Write-Host '=== Summary ==='
Write-Host "version          : $version"
Write-Host "installer_size_mb: $installerSize"
Write-Host "install_seconds  : $installSeconds"
if ($null -ne $uninstallSeconds) {
    Write-Host "uninstall_seconds: $uninstallSeconds"
}

# 6. Issue #8 gate check.
$gate = 360.0
if ($installSeconds -le $gate) {
    Write-Host ''
    Write-Host "PASS: install $installSeconds s <= $gate s gate (issue #8)" -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host "FAIL: install $installSeconds s > $gate s gate (issue #8 baseline ~1201 s)" -ForegroundColor Red
}

if ($Json) {
    $obj = [pscustomobject]@{
        installer        = $exe
        version          = $version
        installer_size_mb = $installerSize
        install_seconds  = $installSeconds
        uninstall_seconds = $uninstallSeconds
        gate_seconds     = $gate
        gate_pass        = ($installSeconds -le $gate)
        timestamp_utc    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    Write-Host ''
    Write-Host ($obj | ConvertTo-Json -Compress)
}
