$ErrorActionPreference = "Stop"

$Repository = if ($env:CC_CLI_REPOSITORY) { $env:CC_CLI_REPOSITORY } else { "chainlesschain/chainlesschain" }
$BaseUrl = if ($env:CC_CLI_RELEASE_BASE_URL) { $env:CC_CLI_RELEASE_BASE_URL.TrimEnd('/') } else { "https://github.com/$Repository/releases/latest/download" }
$InstallDir = if ($env:CC_CLI_INSTALL_DIR) { $env:CC_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "ChainlessChain\bin" }
$Identity = "^https://github.com/$Repository/.github/workflows/cli-native-release.yml@refs/tags/cli-v"

if (-not (Get-Command cosign -ErrorAction SilentlyContinue)) {
  throw "cosign is required to verify the signed CLI release"
}
$Arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  "X64" { "x64" }
  "Arm64" { "arm64" }
  default { throw "Unsupported architecture: $_" }
}
$Target = "node20-win-$Arch"
$Staging = Join-Path ([IO.Path]::GetTempPath()) ("chainlesschain-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Staging | Out-Null
try {
  $ManifestPath = Join-Path $Staging "manifest.json"
  $ManifestBundle = Join-Path $Staging "manifest.sigstore.json"
  Invoke-WebRequest "$BaseUrl/chainlesschain-update.json" -OutFile $ManifestPath
  Invoke-WebRequest "$BaseUrl/chainlesschain-update.json.sigstore.json" -OutFile $ManifestBundle
  & cosign verify-blob --bundle $ManifestBundle --certificate-identity-regexp $Identity --certificate-oidc-issuer "https://token.actions.githubusercontent.com" $ManifestPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Update manifest signature verification failed" }

  $Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
  $Entry = $Manifest.latest.artifacts | Where-Object { $_.target -eq $Target } | Select-Object -First 1
  if (-not $Entry) { throw "Release has no artifact for $Target" }
  $Artifact = Join-Path $Staging "chainlesschain.exe"
  $ArtifactBundle = Join-Path $Staging "artifact.sigstore.json"
  Invoke-WebRequest $Entry.url -OutFile $Artifact
  Invoke-WebRequest $Entry.signature -OutFile $ArtifactBundle
  $ActualHash = (Get-FileHash -Algorithm SHA256 $Artifact).Hash.ToLowerInvariant()
  if ($ActualHash -ne $Entry.sha256.ToLowerInvariant()) { throw "Artifact SHA-256 mismatch" }
  & cosign verify-blob --bundle $ArtifactBundle --certificate-identity-regexp $Identity --certificate-oidc-issuer "https://token.actions.githubusercontent.com" $Artifact | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Artifact signature verification failed" }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $TargetPath = Join-Path $InstallDir "chainlesschain.exe"
  $BackupPath = "$TargetPath.previous"
  if (Test-Path $TargetPath) { Copy-Item -Force $TargetPath $BackupPath }
  Move-Item -Force $Artifact $TargetPath
  & $TargetPath --version | Out-Null
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $BackupPath) {
      Copy-Item -Force $BackupPath $TargetPath
    } else {
      Remove-Item -Force $TargetPath -ErrorAction SilentlyContinue
    }
    throw "Installed binary failed verification; the previous version was restored"
  }
  Copy-Item -Force $TargetPath (Join-Path $InstallDir "cc.exe")
  Write-Host "Installed ChainlessChain CLI at $TargetPath"
} finally {
  Remove-Item -Recurse -Force $Staging -ErrorAction SilentlyContinue
}
