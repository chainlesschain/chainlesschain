param(
  [Parameter(Mandatory = $true)][string]$ReleaseCommit,
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$ArtifactName
)

$ErrorActionPreference = "Stop"
$distro = "cc-roadmap-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
$runRoot = Join-Path $env:RUNNER_TEMP $distro
$installRoot = Join-Path $runRoot "rootfs"
$rootfs = Join-Path $runRoot "ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz"
$nodeArchive = Join-Path $runRoot "node-v22.12.0-linux-x64.tar.gz"
$rootfsUrl = "https://cloud-images.ubuntu.com/wsl/releases/noble/20240423/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz"
$rootfsSha256 = "2a790896740b14d637dbdc583cce1ba081ac53b9e9cdb46dc09a2f73abbd9934"
$nodeUrl = "https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.gz"
$nodeSha256 = "e05a4d65232ae2b27b3d77da2e368522fb46b923335b8e0d5f77624c32484044"

function Assert-Sha256([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) { throw "SHA-256 mismatch for $([IO.Path]::GetFileName($Path))" }
}

function Invoke-Wsl([string[]]$Arguments) {
  & wsl.exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "wsl.exe failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Force -Path $runRoot, $installRoot, $ArtifactDirectory | Out-Null
$imported = $false
try {
  curl.exe --fail --location --silent --show-error $rootfsUrl --output $rootfs
  if ($LASTEXITCODE -ne 0) { throw "Ubuntu WSL rootfs download failed" }
  Assert-Sha256 $rootfs $rootfsSha256
  curl.exe --fail --location --silent --show-error $nodeUrl --output $nodeArchive
  if ($LASTEXITCODE -ne 0) { throw "Node.js archive download failed" }
  Assert-Sha256 $nodeArchive $nodeSha256

  Invoke-Wsl @("--import", $distro, $installRoot, $rootfs, "--version", "1")
  $imported = $true
  $workspace = ([string](& wsl.exe --distribution $distro --exec wslpath -a $env:GITHUB_WORKSPACE)).Trim()
  $wslNodeArchive = ([string](& wsl.exe --distribution $distro --exec wslpath -a $nodeArchive)).Trim()
  $wslArtifactDirectory = ([string](& wsl.exe --distribution $distro --exec wslpath -a $ArtifactDirectory)).Trim()
  if (-not $workspace -or -not $wslNodeArchive -or -not $wslArtifactDirectory) {
    throw "WSL path projection failed"
  }
  Invoke-Wsl @(
    "--distribution", $distro,
    "--exec", "bash", "-lc",
    "set -euo pipefail; mkdir -p /opt/node-22.12.0; tar -xzf '$wslNodeArchive' --strip-components=1 -C /opt/node-22.12.0; cd '$workspace'; GITHUB_REPOSITORY='$env:GITHUB_REPOSITORY' GITHUB_WORKFLOW_REF='$env:GITHUB_WORKFLOW_REF' GITHUB_WORKFLOW_SHA='$env:GITHUB_WORKFLOW_SHA' GITHUB_RUN_ID='$env:GITHUB_RUN_ID' GITHUB_RUN_ATTEMPT='$env:GITHUB_RUN_ATTEMPT' GITHUB_JOB='$env:GITHUB_JOB' GITHUB_EVENT_NAME='$env:GITHUB_EVENT_NAME' CC_RELEASE_COMMIT='$ReleaseCommit' /opt/node-22.12.0/bin/node packages/vscode-extension/test/host-recovery-matrix/run.cjs --release-commit '$ReleaseCommit' --transport wsl --environment-check wsl --artifact-dir '$wslArtifactDirectory' --artifact-name '$ArtifactName'"
  )
} catch {
  $failure = [ordered]@{
    schema = "chainlesschain.ide-host-recovery-bootstrap-failure.v1"
    transport = "wsl"
    releaseCommit = $ReleaseCommit
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
  Set-Content -LiteralPath (Join-Path $ArtifactDirectory "bootstrap-failure.json") -Value $failure -Encoding utf8
  throw
} finally {
  if ($imported) {
    & wsl.exe --terminate $distro 2>$null
    & wsl.exe --unregister $distro 2>$null
  }
}
