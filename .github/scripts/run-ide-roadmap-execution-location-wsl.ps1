param(
  [Parameter(Mandatory = $true)][string]$ReleaseCommit,
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$ArtifactName
)

$ErrorActionPreference = "Stop"
$distro = "cc-location-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
$runRoot = Join-Path $env:RUNNER_TEMP $distro
$installRoot = Join-Path $runRoot "rootfs"
$stateRoot = Join-Path $runRoot "state"
$sourceHome = Join-Path $runRoot "source-home"
$sourceSecurityHome = Join-Path $runRoot "source-security"
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

function Invoke-Matrix([string]$Mode, [string[]]$Extra = @()) {
  $arguments = @(
    "packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs",
    "--mode", $Mode,
    "--transport", "wsl",
    "--release-commit", $ReleaseCommit,
    "--artifact-dir", $ArtifactDirectory,
    "--artifact-name", $ArtifactName,
    "--state-dir", $stateRoot,
    "--source-home", $sourceHome,
    "--source-security-home", $sourceSecurityHome,
    "--target-cwd", "/opt/cc-target-repo",
    "--target-cli", "/opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh",
    "--distro", $distro
  ) + $Extra
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "matrix mode $Mode failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Force -Path $runRoot, $installRoot, $stateRoot, $sourceHome, $sourceSecurityHome, $ArtifactDirectory | Out-Null
$imported = $false
try {
  Invoke-Matrix "initialize"
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
  if (-not $workspace -or -not $wslNodeArchive) { throw "WSL path projection failed" }

  $setup = "set -euo pipefail; mkdir -p /opt/node-22.12.0 /opt/cc-target-repo /var/lib/cc-location/target-home /var/lib/cc-location/target-security; tar -xzf '$wslNodeArchive' --strip-components=1 -C /opt/node-22.12.0; cd '$workspace'; tar --exclude=node_modules --exclude=build -cf - . | tar -C /opt/cc-target-repo -xf -; cd /opt/cc-target-repo/packages/cli; /opt/node-22.12.0/bin/npm install --omit=optional --ignore-scripts --no-package-lock; printf '%s\n' 'CC_IDE_TARGET_NODE=/opt/node-22.12.0/bin/node' 'CC_IDE_TARGET_ENTRY=/opt/cc-target-repo/packages/cli/src/index.js' 'CC_IDE_TARGET_HOME=/var/lib/cc-location/target-home' 'CC_IDE_TARGET_SECURITY_HOME=/var/lib/cc-location/target-security' > /tmp/cc-ide-roadmap-target.env; chmod 600 /tmp/cc-ide-roadmap-target.env; chmod +x /opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh"
  Invoke-Wsl @("--distribution", $distro, "--exec", "bash", "-lc", $setup)

  Invoke-Matrix "prepare-reconnect"
  Invoke-Wsl @("--distribution", $distro, "--exec", "mv", "/opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh", "/opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh.offline")
  Invoke-Wsl @("--terminate", $distro)
  Invoke-Matrix "probe-unavailable"
  Invoke-Wsl @("--distribution", $distro, "--exec", "mv", "/opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh.offline", "/opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh")
  Invoke-Matrix "complete-reconnect"
  Invoke-Matrix "campaign" @("--iterations", "99")
  Invoke-Matrix "finalize"
} catch {
  $failure = [ordered]@{
    schema = "chainlesschain.execution-location-bootstrap-failure.v1"
    transport = "wsl"
    releaseCommit = $ReleaseCommit
    diagnosticDigest = "sha256:" + [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))).ToLowerInvariant()
    contentEmitted = $false
  } | ConvertTo-Json -Compress
  Set-Content -LiteralPath (Join-Path $ArtifactDirectory "bootstrap-failure.json") -Value $failure -Encoding utf8
  throw
} finally {
  if ($imported) {
    & wsl.exe --terminate $distro 2>$null
    & wsl.exe --unregister $distro 2>$null
  }
}
