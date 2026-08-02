Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-PathItemIfPresent {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  try {
    return Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
  } catch [System.Management.Automation.ItemNotFoundException] {
    return $null
  } catch [System.Management.Automation.DriveNotFoundException] {
    return $null
  }
}

function Assert-NoReparsePointInPath {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $FullPath = [IO.Path]::GetFullPath($LiteralPath)
  $Cursor = $FullPath
  while ($Cursor) {
    $Item = Get-PathItemIfPresent $Cursor
    if ($null -ne $Item) {
      if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing install path containing a reparse point: $Cursor"
      }
      if ($Cursor -eq $FullPath -and -not $Item.PSIsContainer) {
        throw "Install path is not a directory: $FullPath"
      }
    }
    $Parent = Split-Path -Parent $Cursor
    if (-not $Parent -or $Parent -eq $Cursor) { break }
    $Cursor = $Parent
  }
}

function Assert-RegularFileOrMissing {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $Item = Get-PathItemIfPresent $LiteralPath
  if ($null -eq $Item) { return }
  if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $Item.PSIsContainer) {
    throw "$Label must be a regular file or absent: $LiteralPath"
  }
}

function Get-Sha256File {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $Stream = $null
  $Hasher = $null
  try {
    $Stream = [IO.File]::Open(
      $LiteralPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::Read
    )
    $Hasher = [Security.Cryptography.SHA256]::Create()
    $HashBytes = $Hasher.ComputeHash($Stream)
    return [BitConverter]::ToString($HashBytes).Replace("-", "").ToLowerInvariant()
  } finally {
    if ($null -ne $Hasher) { $Hasher.Dispose() }
    if ($null -ne $Stream) { $Stream.Dispose() }
  }
}

function Sync-FileToDisk {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $Stream = [IO.File]::Open(
    $LiteralPath,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read
  )
  try {
    $Stream.Flush($true)
  } finally {
    $Stream.Dispose()
  }
}

function Invoke-BinaryStartupCheck {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $Process = $null
  try {
    $StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $LiteralPath
    $StartInfo.Arguments = "--version"
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $Process = [Diagnostics.Process]::new()
    $Process.StartInfo = $StartInfo
    if (-not $Process.Start()) {
      throw "process did not start"
    }
    if (-not $Process.WaitForExit(30000)) {
      $Killed = $false
      try {
        $Process.Kill()
        $Killed = $true
      } catch { }
      if ($Killed) {
        try { [void]$Process.WaitForExit(5000) } catch { }
      }
      throw "process timed out after 30 seconds"
    }
    if ($Process.ExitCode -ne 0) {
      throw "process exited with code $($Process.ExitCode)"
    }
  } catch {
    throw "Binary startup check failed for ${LiteralPath}: $($_.Exception.Message)"
  } finally {
    if ($null -ne $Process) { $Process.Dispose() }
  }
}

function New-ExclusiveInstallLock {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  Assert-RegularFileOrMissing $LiteralPath "Installer lock"
  try {
    $Stream = [IO.File]::Open(
      $LiteralPath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None
    )
  } catch [IO.IOException] {
    throw "Another ChainlessChain CLI install/update is already in progress: $LiteralPath"
  }

  $Token = "${PID}:$([guid]::NewGuid().ToString('N'))"
  try {
    $Bytes = [Text.Encoding]::UTF8.GetBytes($Token)
    $Stream.Write($Bytes, 0, $Bytes.Length)
    $Stream.Flush($true)
  } catch {
    $Stream.Dispose()
    try { [IO.File]::Delete($LiteralPath) } catch { }
    throw
  }
  return [pscustomobject]@{ Stream = $Stream; Path = $LiteralPath; Token = $Token }
}

function Remove-RegularFileIfPresent {
  param([string]$LiteralPath)
  if (-not $LiteralPath) { return }
  try {
    $Item = Get-PathItemIfPresent $LiteralPath
    if ($null -ne $Item -and
        -not $Item.PSIsContainer -and
        ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
      [IO.File]::Delete($LiteralPath)
    }
  } catch { }
}

function Release-ExclusiveInstallLock {
  param($Lock)
  if ($null -eq $Lock) { return }
  try { $Lock.Stream.Dispose() } catch { }
  try {
    $Item = Get-PathItemIfPresent $Lock.Path
    if ($null -ne $Item -and
        -not $Item.PSIsContainer -and
        ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
        [IO.File]::ReadAllText($Lock.Path) -eq $Lock.Token) {
      [IO.File]::Delete($Lock.Path)
    }
  } catch { }
}

function Write-NativeUpdateLineage {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)][string]$TransactionId,
    [Parameter(Mandatory = $true)][string]$Operation,
    [Parameter(Mandatory = $true)][string]$CurrentSha256,
    [AllowNull()][string]$PreviousSha256
  )
  Assert-RegularFileOrMissing $LiteralPath "Native update lineage"
  $Directory = Split-Path -Parent $LiteralPath
  $StagingPath = Join-Path $Directory (".chainlesschain.lineage-" + [guid]::NewGuid().ToString("N"))
  $ReplacedPath = Join-Path $Directory (".chainlesschain.lineage-previous-" + [guid]::NewGuid().ToString("N"))
  $Payload = [ordered]@{
    schema = "chainlesschain.native-update-lineage.v1"
    transactionId = $TransactionId
    operation = $Operation
    currentSha256 = $CurrentSha256.ToLowerInvariant()
    previousSha256 = if ($PreviousSha256) { $PreviousSha256.ToLowerInvariant() } else { $null }
    updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
  } | ConvertTo-Json -Compress
  try {
    [IO.File]::WriteAllText($StagingPath, $Payload + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Sync-FileToDisk $StagingPath
    if ([IO.File]::Exists($LiteralPath)) {
      [IO.File]::Replace($StagingPath, $LiteralPath, $ReplacedPath, $true)
      Remove-RegularFileIfPresent $ReplacedPath
    } else {
      [IO.File]::Move($StagingPath, $LiteralPath)
    }
  } finally {
    Remove-RegularFileIfPresent $StagingPath
    Remove-RegularFileIfPresent $ReplacedPath
  }
}

function Move-StaleStateToQuarantine {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)][string]$TransactionId
  )
  $Item = Get-PathItemIfPresent $LiteralPath
  if ($null -eq $Item) { return $null }
  Assert-RegularFileOrMissing $LiteralPath "Stale native update state"
  $QuarantinePath = "$LiteralPath.orphaned-$TransactionId"
  Assert-RegularFileOrMissing $QuarantinePath "Quarantined native update state"
  [IO.File]::Move($LiteralPath, $QuarantinePath)
  return $QuarantinePath
}

$Repository = if ($env:CC_CLI_REPOSITORY) { $env:CC_CLI_REPOSITORY } else { "chainlesschain/chainlesschain" }
$BaseUrl = if ($env:CC_CLI_RELEASE_BASE_URL) { $env:CC_CLI_RELEASE_BASE_URL.TrimEnd('/') } else { "https://github.com/$Repository/releases/download/cli-stable" }
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
$InstallLock = $null
$CandidatePath = $null
$RollbackTempPath = $null
$AliasCandidatePath = $null
$AliasBackupPath = $null
$AliasRollbackPath = $null
$PreserveRecovery = $false
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
  $ExpectedHash = ([string]$Entry.sha256).ToLowerInvariant()
  $ActualHash = Get-Sha256File $Artifact
  if ($ActualHash -ne $ExpectedHash) { throw "Artifact SHA-256 mismatch" }
  & cosign verify-blob --bundle $ArtifactBundle --certificate-identity-regexp $Identity --certificate-oidc-issuer "https://token.actions.githubusercontent.com" $Artifact | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Artifact signature verification failed" }

  # Download staging may live on another volume. Commit only from a verified
  # candidate created beside the target, while an exclusive lock is held.
  Assert-NoReparsePointInPath $InstallDir
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Assert-NoReparsePointInPath $InstallDir
  $InstallDir = [IO.Path]::GetFullPath($InstallDir)

  $TargetPath = Join-Path $InstallDir "chainlesschain.exe"
  $BackupPath = "$TargetPath.previous"
  $AliasPath = Join-Path $InstallDir "cc.exe"
  $LockPath = "$TargetPath.update.lock"
  $LineagePath = "$TargetPath.update-lineage.json"
  $ResultPath = "$TargetPath.update-result.json"
  $LastResultPath = "$TargetPath.update-result.last.json"
  Assert-RegularFileOrMissing $TargetPath "Install target"
  Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
  Assert-RegularFileOrMissing $AliasPath "CLI alias"
  Assert-RegularFileOrMissing $LockPath "Installer lock"
  Assert-RegularFileOrMissing $LineagePath "Native update lineage"
  Assert-RegularFileOrMissing $ResultPath "Native update result"
  Assert-RegularFileOrMissing $LastResultPath "Last consumed native update result"

  $InstallLock = New-ExclusiveInstallLock $LockPath
  Assert-NoReparsePointInPath $InstallDir
  Assert-RegularFileOrMissing $TargetPath "Install target"
  Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
  Assert-RegularFileOrMissing $AliasPath "CLI alias"
  Assert-RegularFileOrMissing $LineagePath "Native update lineage"
  Assert-RegularFileOrMissing $ResultPath "Native update result"
  Assert-RegularFileOrMissing $LastResultPath "Last consumed native update result"
  if ([IO.File]::Exists($ResultPath)) {
    throw "An unconsumed native update result must be handled before installing"
  }
  if ([IO.File]::Exists($LastResultPath)) {
    $LastResult = Get-Content -Raw -LiteralPath $LastResultPath | ConvertFrom-Json
    $LastStatus = [string]$LastResult.status
    $LastExitCode = $LastResult.exitCode
    $ParsedTransactionId = [guid]::Empty
    $ValidLastResult = (
      [string]$LastResult.schema -eq "chainlesschain.native-update-result.v1" -and
      [guid]::TryParse([string]$LastResult.transactionId, [ref]$ParsedTransactionId) -and
      @("install", "update", "rescue") -contains [string]$LastResult.operation -and
      $LastStatus -match '^[a-z0-9]+(?:-[a-z0-9]+)*$' -and
      ($LastExitCode -is [int] -or $LastExitCode -is [long]) -and
      $LastExitCode -in @(0, 1) -and
      (($LastStatus -eq "success") -eq ($LastExitCode -eq 0))
    )
    if (-not $ValidLastResult) {
      throw "Last consumed native update result is invalid and requires manual recovery"
    }
    if ($LastStatus.EndsWith("rollback-failed")) {
      throw "The previous native update requires manual recovery before installing"
    }
  }

  $TransactionId = [guid]::NewGuid().ToString()
  $HadTarget = [IO.File]::Exists($TargetPath)
  $HadAlias = [IO.File]::Exists($AliasPath)
  if (-not $HadTarget) {
    Move-StaleStateToQuarantine $BackupPath $TransactionId | Out-Null
    Move-StaleStateToQuarantine $LineagePath $TransactionId | Out-Null
  }

  # PowerShell resolves native commands by extension. Keep the verified
  # same-directory candidate executable so the pre-commit startup check runs
  # the binary instead of treating it as a document in a pipeline.
  $CandidatePath = Join-Path $InstallDir (".chainlesschain.new-" + [guid]::NewGuid().ToString("N") + ".exe")
  [IO.File]::Copy($Artifact, $CandidatePath, $false)
  if ((Get-Sha256File $CandidatePath) -ne $ExpectedHash) {
    throw "Same-filesystem staging copy failed SHA-256 verification"
  }
  Sync-FileToDisk $CandidatePath
  if ((Get-Sha256File $CandidatePath) -ne $ExpectedHash) {
    throw "Same-filesystem candidate changed before pre-install startup check"
  }
  Invoke-BinaryStartupCheck $CandidatePath

  $AliasCandidatePath = Join-Path $InstallDir (".cc.new-" + [guid]::NewGuid().ToString("N") + ".exe")
  [IO.File]::Copy($CandidatePath, $AliasCandidatePath, $false)
  if ((Get-Sha256File $AliasCandidatePath) -ne $ExpectedHash) {
    throw "Alias staging copy failed SHA-256 verification"
  }
  Sync-FileToDisk $AliasCandidatePath

  $TargetBeforeHash = if ($HadTarget) { Get-Sha256File $TargetPath } else { $null }
  $AliasBeforeHash = if ($HadAlias) { Get-Sha256File $AliasPath } else { $null }
  $Swapped = $false
  $AliasSwapped = $false
  $Committed = $false
  try {
    # Re-check the manifest-bound candidate after all staging and immediately
    # before the first commit point.
    Assert-NoReparsePointInPath $InstallDir
    Assert-RegularFileOrMissing $TargetPath "Install target"
    Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
    Assert-RegularFileOrMissing $AliasPath "CLI alias"
    Assert-RegularFileOrMissing $LineagePath "Native update lineage"
    Assert-RegularFileOrMissing $ResultPath "Native update result"
    Assert-RegularFileOrMissing $LastResultPath "Last consumed native update result"
    if ($HadTarget -and (Get-Sha256File $TargetPath) -ne $TargetBeforeHash) {
      throw "Install target changed while the transaction was staged"
    }
    if ($HadAlias -and (Get-Sha256File $AliasPath) -ne $AliasBeforeHash) {
      throw "CLI alias changed while the transaction was staged"
    }
    if ((Get-Sha256File $CandidatePath) -ne $ExpectedHash) {
      throw "Canonical candidate changed before commit"
    }
    if ((Get-Sha256File $AliasCandidatePath) -ne $ExpectedHash) {
      throw "CLI alias candidate changed before commit"
    }
    if ($HadTarget) {
      # File.Replace performs one same-volume replacement and persists the old
      # destination at BackupPath without an unlink/copy gap.
      [IO.File]::Replace($CandidatePath, $TargetPath, $BackupPath, $true)
    } else {
      [IO.File]::Move($CandidatePath, $TargetPath)
    }
    $CandidatePath = $null
    $Swapped = $true
    Sync-FileToDisk $TargetPath
    if ($HadTarget) { Sync-FileToDisk $BackupPath }

    # Canonical and cc.exe are committed and verified as one transaction.
    Assert-RegularFileOrMissing $AliasPath "CLI alias"
    if ($HadAlias) {
      $AliasBackupPath = Join-Path $InstallDir (".cc.previous-" + [guid]::NewGuid().ToString("N") + ".exe")
      [IO.File]::Replace($AliasCandidatePath, $AliasPath, $AliasBackupPath, $true)
    } else {
      [IO.File]::Move($AliasCandidatePath, $AliasPath)
    }
    $AliasCandidatePath = $null
    $AliasSwapped = $true
    if ((Get-Sha256File $TargetPath) -ne $ExpectedHash -or
        (Get-Sha256File $AliasPath) -ne $ExpectedHash) {
      throw "Canonical/alias hash parity verification failed"
    }
    if ((Get-Sha256File $TargetPath) -ne $ExpectedHash) {
      throw "Canonical target changed before startup check"
    }
    Invoke-BinaryStartupCheck $TargetPath
    if ((Get-Sha256File $AliasPath) -ne $ExpectedHash) {
      throw "CLI alias changed before startup check"
    }
    Invoke-BinaryStartupCheck $AliasPath
    Write-NativeUpdateLineage $LineagePath $TransactionId "install" $ExpectedHash $TargetBeforeHash
    $Committed = $true
    Remove-RegularFileIfPresent $AliasBackupPath
    $AliasBackupPath = $null
  } catch {
    $TransactionError = $_.Exception.Message
    if ($Swapped -and -not $Committed) {
      $RollbackErrors = [Collections.Generic.List[string]]::new()
      if ($AliasSwapped) {
        try {
          if ($HadAlias) {
            if (-not [IO.File]::Exists($AliasBackupPath)) { throw "CLI alias backup disappeared" }
            if ((Get-Sha256File $AliasBackupPath) -ne $AliasBeforeHash) {
              throw "CLI alias backup changed before rollback"
            }
            $AliasRollbackPath = Join-Path $InstallDir (".cc.rollback-" + [guid]::NewGuid().ToString("N") + ".exe")
            [IO.File]::Copy($AliasBackupPath, $AliasRollbackPath, $false)
            if ((Get-Sha256File $AliasRollbackPath) -ne $AliasBeforeHash) {
              throw "CLI alias rollback staging failed SHA-256 verification"
            }
            $FailedAliasPath = "$AliasPath.failed-$([guid]::NewGuid().ToString('N'))"
            [IO.File]::Replace($AliasRollbackPath, $AliasPath, $FailedAliasPath, $true)
            $AliasRollbackPath = $null
            if ((Get-Sha256File $AliasPath) -ne $AliasBeforeHash) {
              throw "Restored CLI alias failed SHA-256 verification"
            }
          } elseif ([IO.File]::Exists($AliasPath)) {
            [IO.File]::Delete($AliasPath)
            if ([IO.File]::Exists($AliasPath)) { throw "Fresh CLI alias could not be removed" }
          }
        } catch {
          $RollbackErrors.Add("alias: $($_.Exception.Message)")
        }
      }
      try {
        if ($HadTarget) {
          Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
          if (-not [IO.File]::Exists($BackupPath)) {
            throw "Last-known-good backup disappeared"
          }
          if ((Get-Sha256File $BackupPath) -ne $TargetBeforeHash) {
            throw "Last-known-good backup changed before rollback"
          }
          $RollbackTempPath = Join-Path $InstallDir (".chainlesschain.rollback-" + [guid]::NewGuid().ToString("N"))
          [IO.File]::Copy($BackupPath, $RollbackTempPath, $false)
          if ((Get-Sha256File $RollbackTempPath) -ne $TargetBeforeHash) {
            throw "Rollback staging copy failed SHA-256 verification"
          }
          Sync-FileToDisk $RollbackTempPath
          $FailedPath = "$TargetPath.failed-$([guid]::NewGuid().ToString('N'))"
          [IO.File]::Replace($RollbackTempPath, $TargetPath, $FailedPath, $true)
          $RollbackTempPath = $null
          Sync-FileToDisk $TargetPath
          if ((Get-Sha256File $TargetPath) -ne $TargetBeforeHash) {
            throw "Restored install target failed SHA-256 verification"
          }
          Write-NativeUpdateLineage $LineagePath $TransactionId "rolled-back" $TargetBeforeHash $TargetBeforeHash
        } else {
          Assert-RegularFileOrMissing $TargetPath "Failed install target"
          if ([IO.File]::Exists($TargetPath)) { [IO.File]::Delete($TargetPath) }
          if ([IO.File]::Exists($TargetPath)) { throw "Fresh install target could not be removed" }
          Remove-RegularFileIfPresent $LineagePath
        }
      } catch {
        $RollbackErrors.Add("canonical: $($_.Exception.Message)")
      }
      if ($RollbackErrors.Count -gt 0) {
        $PreserveRecovery = $true
        throw "Install transaction failed ($TransactionError) and rollback also failed: $($RollbackErrors -join '; ')"
      }
      if ($HadTarget) {
        throw "Install transaction failed; the previous version was restored. $TransactionError"
      }
      throw "Install transaction failed; the partial installation was removed. $TransactionError"
    }
    throw
  }
  Write-Host "Installed ChainlessChain CLI at $TargetPath"
} finally {
  Remove-RegularFileIfPresent $CandidatePath
  Remove-RegularFileIfPresent $AliasCandidatePath
  if (-not $PreserveRecovery) {
    Remove-RegularFileIfPresent $RollbackTempPath
    Remove-RegularFileIfPresent $AliasBackupPath
    Remove-RegularFileIfPresent $AliasRollbackPath
  } else {
    if ($RollbackTempPath) { Write-Warning "Rollback candidate preserved at $RollbackTempPath" }
    if ($AliasBackupPath) { Write-Warning "CLI alias recovery snapshot preserved at $AliasBackupPath" }
    if ($AliasRollbackPath) { Write-Warning "CLI alias rollback candidate preserved at $AliasRollbackPath" }
  }
  if ($PreserveRecovery -and $null -ne $InstallLock) {
    try { $InstallLock.Stream.Dispose() } catch { }
    Write-Warning "Native update lock retained for manual recovery at $($InstallLock.Path)"
  } else {
    Release-ExclusiveInstallLock $InstallLock
  }
  Remove-Item -Recurse -Force -LiteralPath $Staging -ErrorAction SilentlyContinue
}
