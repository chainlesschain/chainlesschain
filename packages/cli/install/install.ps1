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

function Write-DurableJsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Assert-RegularFileOrMissing $LiteralPath $Label
  $Directory = Split-Path -Parent $LiteralPath
  $StagingPath = Join-Path $Directory (".chainlesschain.json-" + [guid]::NewGuid().ToString("N"))
  $ReplacedPath = Join-Path $Directory (".chainlesschain.json-previous-" + [guid]::NewGuid().ToString("N"))
  try {
    $Payload = $Value | ConvertTo-Json -Compress -Depth 8
    [IO.File]::WriteAllText($StagingPath, $Payload + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Sync-FileToDisk $StagingPath
    if ([IO.File]::Exists($LiteralPath)) {
      [IO.File]::Replace($StagingPath, $LiteralPath, $ReplacedPath, $true)
      Remove-RegularFileIfPresent $ReplacedPath
    } else {
      [IO.File]::Move($StagingPath, $LiteralPath)
    }
    Sync-FileToDisk $LiteralPath
  } finally {
    Remove-RegularFileIfPresent $StagingPath
    Remove-RegularFileIfPresent $ReplacedPath
  }
}

function Write-InstallTransactionJournal {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)]$Journal
  )
  $Journal.updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
  Write-DurableJsonFile $LiteralPath $Journal "Native install transaction journal"
}

function Read-InstallTransactionJournal {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  Assert-RegularFileOrMissing $LiteralPath "Native install transaction journal"
  try {
    $Journal = Get-Content -Raw -LiteralPath $LiteralPath | ConvertFrom-Json
  } catch {
    throw "Native install transaction journal is corrupt and requires manual recovery"
  }
  $ParsedTransactionId = [guid]::Empty
  $HashPattern = '^[a-f0-9]{64}$'
  $Valid = (
    [string]$Journal.schema -eq "chainlesschain.native-install-transaction.v1" -and
    [guid]::TryParse([string]$Journal.transactionId, [ref]$ParsedTransactionId) -and
    [string]$Journal.operation -eq "install" -and
    @("prepared", "target-committed", "alias-committed", "verified", "committed") -contains [string]$Journal.phase -and
    @("rollback", "commit") -contains [string]$Journal.decision -and
    ([string]$Journal.expectedSha256 -match $HashPattern) -and
    ($Journal.hadTarget -is [bool]) -and
    ($Journal.hadAlias -is [bool]) -and
    ($Journal.hadBackup -is [bool]) -and
    ($Journal.hadLineage -is [bool]) -and
    ((-not $Journal.hadTarget -and $null -eq $Journal.targetBeforeSha256) -or ($Journal.hadTarget -and [string]$Journal.targetBeforeSha256 -match $HashPattern)) -and
    ((-not $Journal.hadAlias -and $null -eq $Journal.aliasBeforeSha256) -or ($Journal.hadAlias -and [string]$Journal.aliasBeforeSha256 -match $HashPattern)) -and
    ((-not $Journal.hadBackup -and $null -eq $Journal.backupBeforeSha256) -or ($Journal.hadBackup -and [string]$Journal.backupBeforeSha256 -match $HashPattern)) -and
    ((-not $Journal.hadLineage -and $null -eq $Journal.lineageBeforeSha256) -or ($Journal.hadLineage -and [string]$Journal.lineageBeforeSha256 -match $HashPattern)) -and
    (([string]$Journal.phase -eq "committed" -and [string]$Journal.decision -eq "commit") -or ([string]$Journal.phase -ne "committed" -and [string]$Journal.decision -eq "rollback"))
  )
  if (-not $Valid) {
    throw "Native install transaction journal failed schema validation and requires manual recovery"
  }
  return $Journal
}

function Resolve-StaleInstallLock {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $Item = Get-PathItemIfPresent $LiteralPath
  if ($null -eq $Item) { return $null }
  Assert-RegularFileOrMissing $LiteralPath "Installer lock"
  $Stream = $null
  try {
    $Stream = [IO.File]::Open(
      $LiteralPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None
    )
    if ($Stream.Length -lt 3 -or $Stream.Length -gt 128) {
      throw "Stale installer lock token is invalid"
    }
    $Bytes = [byte[]]::new([int]$Stream.Length)
    [void]$Stream.Read($Bytes, 0, $Bytes.Length)
    $Token = [Text.Encoding]::UTF8.GetString($Bytes)
  } catch [IO.IOException] {
    throw "Another ChainlessChain CLI install/update is already in progress: $LiteralPath"
  } finally {
    if ($null -ne $Stream) { $Stream.Dispose() }
  }
  if ($Token -notmatch '^(?<pid>[1-9][0-9]*):(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$') {
    throw "Stale installer lock token is invalid and requires manual recovery"
  }
  $OwnerPid = [int64]$Matches.pid
  if ($OwnerPid -le [int]::MaxValue -and $null -ne (Get-Process -Id ([int]$OwnerPid) -ErrorAction SilentlyContinue)) {
    throw "Installer lock owner PID $OwnerPid is still live; refusing stale-lock takeover"
  }
  $QuarantinePath = "$LiteralPath.orphaned-$([guid]::NewGuid().ToString('N'))"
  Assert-RegularFileOrMissing $QuarantinePath "Quarantined installer lock"
  [IO.File]::Move($LiteralPath, $QuarantinePath)
  return $QuarantinePath
}

function Restore-InstallFileGeneration {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$TransactionId,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Assert-RegularFileOrMissing $SourcePath "$Label recovery source"
  Assert-RegularFileOrMissing $DestinationPath "$Label destination"
  if (-not [IO.File]::Exists($SourcePath) -or (Get-Sha256File $SourcePath) -ne $ExpectedSha256) {
    throw "$Label recovery source is missing or changed"
  }
  $RestorePath = "$DestinationPath.recovery-$TransactionId"
  $RejectedPath = "$DestinationPath.rejected-$TransactionId"
  Assert-RegularFileOrMissing $RestorePath "$Label recovery staging"
  Assert-RegularFileOrMissing $RejectedPath "$Label rejected generation"
  [IO.File]::Copy($SourcePath, $RestorePath, $false)
  try {
    Sync-FileToDisk $RestorePath
    if ((Get-Sha256File $RestorePath) -ne $ExpectedSha256) {
      throw "$Label recovery staging failed SHA-256 verification"
    }
    if ([IO.File]::Exists($DestinationPath)) {
      [IO.File]::Replace($RestorePath, $DestinationPath, $RejectedPath, $true)
      Remove-RegularFileIfPresent $RejectedPath
    } else {
      [IO.File]::Move($RestorePath, $DestinationPath)
    }
    Sync-FileToDisk $DestinationPath
    if ((Get-Sha256File $DestinationPath) -ne $ExpectedSha256) {
      throw "$Label restored generation failed SHA-256 verification"
    }
  } finally {
    Remove-RegularFileIfPresent $RestorePath
  }
}

function Invoke-InstallCrashFixture {
  param([Parameter(Mandatory = $true)][string]$Phase)
  if ([string]$env:CC_CLI_INSTALL_CRASH_AFTER_PHASE -eq $Phase) {
    [Environment]::FailFast("CLI installer crash fixture after $Phase")
  }
}

function Invoke-InterruptedInstallRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [Parameter(Mandatory = $true)][string]$AliasPath,
    [Parameter(Mandatory = $true)][string]$LineagePath,
    [Parameter(Mandatory = $true)][string]$JournalPath
  )
  if (-not [IO.File]::Exists($JournalPath)) { return $null }
  $Journal = Read-InstallTransactionJournal $JournalPath
  $TransactionId = [string]$Journal.transactionId
  $ExpectedHash = ([string]$Journal.expectedSha256).ToLowerInvariant()
  $TargetBeforeHash = if ($Journal.hadTarget) { ([string]$Journal.targetBeforeSha256).ToLowerInvariant() } else { $null }
  $AliasBeforeHash = if ($Journal.hadAlias) { ([string]$Journal.aliasBeforeSha256).ToLowerInvariant() } else { $null }
  $BackupBeforeHash = if ($Journal.hadBackup) { ([string]$Journal.backupBeforeSha256).ToLowerInvariant() } else { $null }
  $LineageBeforeHash = if ($Journal.hadLineage) { ([string]$Journal.lineageBeforeSha256).ToLowerInvariant() } else { $null }
  $CandidatePath = Join-Path $InstallDirectory (".chainlesschain.new-$TransactionId.exe")
  $AliasCandidatePath = Join-Path $InstallDirectory (".cc.new-$TransactionId.exe")
  $AliasBackupPath = Join-Path $InstallDirectory (".cc.previous-$TransactionId.exe")
  $BackupSnapshotPath = Join-Path $InstallDirectory (".chainlesschain.backup-prior-$TransactionId.exe")
  $LineageSnapshotPath = Join-Path $InstallDirectory (".chainlesschain.lineage-prior-$TransactionId.json")

  Assert-RegularFileOrMissing $TargetPath "Install target"
  Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
  Assert-RegularFileOrMissing $AliasPath "CLI alias"
  Assert-RegularFileOrMissing $LineagePath "Native update lineage"
  Assert-RegularFileOrMissing $CandidatePath "Canonical candidate"
  Assert-RegularFileOrMissing $AliasCandidatePath "Alias candidate"
  Assert-RegularFileOrMissing $AliasBackupPath "Alias recovery snapshot"
  Assert-RegularFileOrMissing $BackupSnapshotPath "Backup recovery snapshot"
  Assert-RegularFileOrMissing $LineageSnapshotPath "Lineage recovery snapshot"

  if ([string]$Journal.decision -eq "commit") {
    if (-not [IO.File]::Exists($TargetPath) -or (Get-Sha256File $TargetPath) -ne $ExpectedHash) {
      throw "Committed install target does not match its durable decision"
    }
    if (-not [IO.File]::Exists($AliasPath) -or (Get-Sha256File $AliasPath) -ne $ExpectedHash) {
      throw "Committed CLI alias does not match its durable decision"
    }
    if (-not [IO.File]::Exists($LineagePath)) {
      throw "Committed native update lineage is missing"
    }
    $Lineage = Get-Content -Raw -LiteralPath $LineagePath | ConvertFrom-Json
    if ([string]$Lineage.schema -ne "chainlesschain.native-update-lineage.v1" -or
        [string]$Lineage.transactionId -ne $TransactionId -or
        ([string]$Lineage.currentSha256).ToLowerInvariant() -ne $ExpectedHash) {
      throw "Committed native update lineage does not match its durable decision"
    }
    Remove-RegularFileIfPresent $CandidatePath
    Remove-RegularFileIfPresent $AliasCandidatePath
    Remove-RegularFileIfPresent $AliasBackupPath
    Remove-RegularFileIfPresent $BackupSnapshotPath
    Remove-RegularFileIfPresent $LineageSnapshotPath
    Remove-RegularFileIfPresent $JournalPath
    return "committed"
  }

  $CurrentTargetHash = if ([IO.File]::Exists($TargetPath)) { Get-Sha256File $TargetPath } else { $null }
  if ($Journal.hadTarget) {
    if ($CurrentTargetHash -ne $TargetBeforeHash) {
      if ($CurrentTargetHash -ne $ExpectedHash) {
        throw "Interrupted install target has an unknown generation"
      }
      Restore-InstallFileGeneration $BackupPath $TargetPath $TargetBeforeHash $TransactionId "Install target"
    }
  } elseif ($null -ne $CurrentTargetHash) {
    if ($CurrentTargetHash -ne $ExpectedHash) {
      throw "Interrupted fresh install target has an unknown generation"
    }
    [IO.File]::Delete($TargetPath)
  }

  $CurrentBackupHash = if ([IO.File]::Exists($BackupPath)) { Get-Sha256File $BackupPath } else { $null }
  if ($Journal.hadBackup) {
    if ($CurrentBackupHash -ne $BackupBeforeHash) {
      if ($CurrentBackupHash -ne $TargetBeforeHash) {
        throw "Interrupted last-known-good backup has an unknown generation"
      }
      Restore-InstallFileGeneration $BackupSnapshotPath $BackupPath $BackupBeforeHash $TransactionId "Last-known-good backup"
    }
  } elseif ($null -ne $CurrentBackupHash) {
    if (-not $Journal.hadTarget -or $CurrentBackupHash -ne $TargetBeforeHash) {
      throw "Interrupted install created an unknown last-known-good backup"
    }
    [IO.File]::Delete($BackupPath)
  }

  $CurrentAliasHash = if ([IO.File]::Exists($AliasPath)) { Get-Sha256File $AliasPath } else { $null }
  if ($Journal.hadAlias) {
    if ($CurrentAliasHash -ne $AliasBeforeHash) {
      if ($CurrentAliasHash -ne $ExpectedHash) {
        throw "Interrupted CLI alias has an unknown generation"
      }
      Restore-InstallFileGeneration $AliasBackupPath $AliasPath $AliasBeforeHash $TransactionId "CLI alias"
    }
  } elseif ($null -ne $CurrentAliasHash) {
    if ($CurrentAliasHash -ne $ExpectedHash) {
      throw "Interrupted fresh CLI alias has an unknown generation"
    }
    [IO.File]::Delete($AliasPath)
  }

  if ($Journal.hadLineage) {
    if (-not [IO.File]::Exists($LineageSnapshotPath)) {
      throw "Interrupted install lineage recovery snapshot is missing"
    }
    if (-not [IO.File]::Exists($LineagePath) -or (Get-Sha256File $LineagePath) -ne $LineageBeforeHash) {
      Restore-InstallFileGeneration $LineageSnapshotPath $LineagePath $LineageBeforeHash $TransactionId "Native update lineage"
    }
  } elseif ([IO.File]::Exists($LineagePath)) {
    $Lineage = Get-Content -Raw -LiteralPath $LineagePath | ConvertFrom-Json
    if ([string]$Lineage.schema -ne "chainlesschain.native-update-lineage.v1" -or
        [string]$Lineage.transactionId -ne $TransactionId) {
      throw "Interrupted install lineage has an unknown generation"
    }
    [IO.File]::Delete($LineagePath)
  }

  Remove-RegularFileIfPresent $CandidatePath
  Remove-RegularFileIfPresent $AliasCandidatePath
  Remove-RegularFileIfPresent $AliasBackupPath
  Remove-RegularFileIfPresent $BackupSnapshotPath
  Remove-RegularFileIfPresent $LineageSnapshotPath
  Remove-RegularFileIfPresent $JournalPath
  return "rolled-back"
}

$Repository = if ($env:CC_CLI_REPOSITORY) { $env:CC_CLI_REPOSITORY } else { "chainlesschain/chainlesschain" }
$BaseUrl = if ($env:CC_CLI_RELEASE_BASE_URL) { $env:CC_CLI_RELEASE_BASE_URL.TrimEnd('/') } else { "https://github.com/$Repository/releases/download/cli-stable" }
$InstallDir = if ($env:CC_CLI_INSTALL_DIR) { $env:CC_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "ChainlessChain\bin" }
$Identity = "^https://github.com/$Repository/.github/workflows/cli-native-release.yml@refs/tags/cli-v"

# Recover a prior durable decision before checking release tooling or touching
# the network. A machine that lost power mid-commit must be able to restore its
# last known generation while completely offline.
Assert-NoReparsePointInPath $InstallDir
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Assert-NoReparsePointInPath $InstallDir
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$TargetPath = Join-Path $InstallDir "chainlesschain.exe"
$BackupPath = "$TargetPath.previous"
$AliasPath = Join-Path $InstallDir "cc.exe"
$LockPath = "$TargetPath.update.lock"
$LineagePath = "$TargetPath.update-lineage.json"
$JournalPath = "$TargetPath.update-transaction.json"
$ResultPath = "$TargetPath.update-result.json"
$LastResultPath = "$TargetPath.update-result.last.json"
$RecoveredTransaction = $null
$RecoveryLock = $null
$StaleLockPath = Resolve-StaleInstallLock $LockPath
if ($StaleLockPath) {
  Write-Warning "Quarantined a stale native update lock at $StaleLockPath"
}
if ([IO.File]::Exists($JournalPath)) {
  try {
    $RecoveryLock = New-ExclusiveInstallLock $LockPath
    $RecoveredTransaction = Invoke-InterruptedInstallRecovery `
      $InstallDir $TargetPath $BackupPath $AliasPath $LineagePath $JournalPath
    Release-ExclusiveInstallLock $RecoveryLock
    $RecoveryLock = $null
  } catch {
    if ($null -ne $RecoveryLock) {
      try { $RecoveryLock.Stream.Dispose() } catch { }
      Write-Warning "Native update lock retained for recovery at $($RecoveryLock.Path)"
    }
    throw
  }
  Write-Warning "Recovered interrupted native install transaction ($RecoveredTransaction)"
}
if ([string]$env:CC_CLI_INSTALL_RECOVERY_ONLY -eq "1") {
  if (-not $RecoveredTransaction) {
    throw "Recovery-only mode found no interrupted native install transaction"
  }
  return
}

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
$LineageSnapshotPath = $null
$BackupSnapshotPath = $null
$TransactionJournal = $null
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
  Assert-RegularFileOrMissing $TargetPath "Install target"
  Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
  Assert-RegularFileOrMissing $AliasPath "CLI alias"
  Assert-RegularFileOrMissing $LockPath "Installer lock"
  Assert-RegularFileOrMissing $LineagePath "Native update lineage"
  Assert-RegularFileOrMissing $JournalPath "Native install transaction journal"
  Assert-RegularFileOrMissing $ResultPath "Native update result"
  Assert-RegularFileOrMissing $LastResultPath "Last consumed native update result"

  $StaleLockPath = Resolve-StaleInstallLock $LockPath
  if ($StaleLockPath) {
    Write-Warning "Quarantined a stale native update lock at $StaleLockPath"
  }
  $InstallLock = New-ExclusiveInstallLock $LockPath
  Assert-NoReparsePointInPath $InstallDir
  Assert-RegularFileOrMissing $TargetPath "Install target"
  Assert-RegularFileOrMissing $BackupPath "Last-known-good backup"
  Assert-RegularFileOrMissing $AliasPath "CLI alias"
  Assert-RegularFileOrMissing $LineagePath "Native update lineage"
  Assert-RegularFileOrMissing $JournalPath "Native install transaction journal"
  Assert-RegularFileOrMissing $ResultPath "Native update result"
  Assert-RegularFileOrMissing $LastResultPath "Last consumed native update result"
  try {
    $RecoveredTransaction = Invoke-InterruptedInstallRecovery `
      $InstallDir $TargetPath $BackupPath $AliasPath $LineagePath $JournalPath
  } catch {
    $PreserveRecovery = $true
    throw
  }
  if ($RecoveredTransaction) {
    Write-Warning "Recovered interrupted native install transaction ($RecoveredTransaction)"
  }
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
  $CandidatePath = Join-Path $InstallDir (".chainlesschain.new-$TransactionId.exe")
  [IO.File]::Copy($Artifact, $CandidatePath, $false)
  if ((Get-Sha256File $CandidatePath) -ne $ExpectedHash) {
    throw "Same-filesystem staging copy failed SHA-256 verification"
  }
  Sync-FileToDisk $CandidatePath
  if ((Get-Sha256File $CandidatePath) -ne $ExpectedHash) {
    throw "Same-filesystem candidate changed before pre-install startup check"
  }
  Invoke-BinaryStartupCheck $CandidatePath

  $AliasCandidatePath = Join-Path $InstallDir (".cc.new-$TransactionId.exe")
  [IO.File]::Copy($CandidatePath, $AliasCandidatePath, $false)
  if ((Get-Sha256File $AliasCandidatePath) -ne $ExpectedHash) {
    throw "Alias staging copy failed SHA-256 verification"
  }
  Sync-FileToDisk $AliasCandidatePath

  $TargetBeforeHash = if ($HadTarget) { Get-Sha256File $TargetPath } else { $null }
  $AliasBeforeHash = if ($HadAlias) { Get-Sha256File $AliasPath } else { $null }
  $HadBackup = [IO.File]::Exists($BackupPath)
  $BackupBeforeHash = if ($HadBackup) { Get-Sha256File $BackupPath } else { $null }
  $BackupSnapshotPath = Join-Path $InstallDir (".chainlesschain.backup-prior-$TransactionId.exe")
  if ($HadBackup) {
    [IO.File]::Copy($BackupPath, $BackupSnapshotPath, $false)
    Sync-FileToDisk $BackupSnapshotPath
    if ((Get-Sha256File $BackupSnapshotPath) -ne $BackupBeforeHash) {
      throw "Last-known-good backup recovery snapshot changed while staging"
    }
  }
  $HadLineage = [IO.File]::Exists($LineagePath)
  $LineageBeforeHash = if ($HadLineage) { Get-Sha256File $LineagePath } else { $null }
  $LineageSnapshotPath = Join-Path $InstallDir (".chainlesschain.lineage-prior-$TransactionId.json")
  if ($HadLineage) {
    [IO.File]::Copy($LineagePath, $LineageSnapshotPath, $false)
    Sync-FileToDisk $LineageSnapshotPath
    if ((Get-Sha256File $LineageSnapshotPath) -ne $LineageBeforeHash) {
      throw "Native update lineage recovery snapshot changed while staging"
    }
  }
  $AliasBackupPath = Join-Path $InstallDir (".cc.previous-$TransactionId.exe")
  $TransactionJournal = [ordered]@{
    schema = "chainlesschain.native-install-transaction.v1"
    transactionId = $TransactionId
    operation = "install"
    phase = "prepared"
    decision = "rollback"
    expectedSha256 = $ExpectedHash
    hadTarget = $HadTarget
    targetBeforeSha256 = $TargetBeforeHash
    hadAlias = $HadAlias
    aliasBeforeSha256 = $AliasBeforeHash
    hadBackup = $HadBackup
    backupBeforeSha256 = $BackupBeforeHash
    hadLineage = $HadLineage
    lineageBeforeSha256 = $LineageBeforeHash
    updatedAt = $null
  }
  Write-InstallTransactionJournal $JournalPath $TransactionJournal
  Invoke-InstallCrashFixture "prepared"
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
    $TransactionJournal.phase = "target-committed"
    Write-InstallTransactionJournal $JournalPath $TransactionJournal
    Invoke-InstallCrashFixture "target-committed"

    # Canonical and cc.exe are committed and verified as one transaction.
    Assert-RegularFileOrMissing $AliasPath "CLI alias"
    if ($HadAlias) {
      [IO.File]::Replace($AliasCandidatePath, $AliasPath, $AliasBackupPath, $true)
    } else {
      [IO.File]::Move($AliasCandidatePath, $AliasPath)
    }
    $AliasCandidatePath = $null
    $AliasSwapped = $true
    $TransactionJournal.phase = "alias-committed"
    Write-InstallTransactionJournal $JournalPath $TransactionJournal
    Invoke-InstallCrashFixture "alias-committed"
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
    $TransactionJournal.phase = "verified"
    Write-InstallTransactionJournal $JournalPath $TransactionJournal
    Invoke-InstallCrashFixture "verified"
    Write-NativeUpdateLineage $LineagePath $TransactionId "install" $ExpectedHash $TargetBeforeHash
    $TransactionJournal.phase = "committed"
    $TransactionJournal.decision = "commit"
    Write-InstallTransactionJournal $JournalPath $TransactionJournal
    Invoke-InstallCrashFixture "committed"
    $Committed = $true
    Remove-RegularFileIfPresent $AliasBackupPath
    $AliasBackupPath = $null
    Remove-RegularFileIfPresent $BackupSnapshotPath
    $BackupSnapshotPath = $null
    Remove-RegularFileIfPresent $LineageSnapshotPath
    $LineageSnapshotPath = $null
    Remove-RegularFileIfPresent $JournalPath
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
        } else {
          Assert-RegularFileOrMissing $TargetPath "Failed install target"
          if ([IO.File]::Exists($TargetPath)) { [IO.File]::Delete($TargetPath) }
          if ([IO.File]::Exists($TargetPath)) { throw "Fresh install target could not be removed" }
        }
      } catch {
        $RollbackErrors.Add("canonical: $($_.Exception.Message)")
      }
      try {
        if ($HadBackup) {
          Restore-InstallFileGeneration $BackupSnapshotPath $BackupPath $BackupBeforeHash $TransactionId "Last-known-good backup"
        } elseif ([IO.File]::Exists($BackupPath)) {
          if (-not $HadTarget -or (Get-Sha256File $BackupPath) -ne $TargetBeforeHash) {
            throw "Last-known-good backup changed before rollback"
          }
          [IO.File]::Delete($BackupPath)
        }
      } catch {
        $RollbackErrors.Add("backup: $($_.Exception.Message)")
      }
      try {
        if ($HadLineage) {
          Restore-InstallFileGeneration $LineageSnapshotPath $LineagePath $LineageBeforeHash $TransactionId "Native update lineage"
        } else {
          if ([IO.File]::Exists($LineagePath)) {
            $CurrentLineage = Get-Content -Raw -LiteralPath $LineagePath | ConvertFrom-Json
            if ([string]$CurrentLineage.transactionId -ne $TransactionId) {
              throw "Native update lineage changed before rollback"
            }
            [IO.File]::Delete($LineagePath)
          }
        }
      } catch {
        $RollbackErrors.Add("lineage: $($_.Exception.Message)")
      }
      if ($RollbackErrors.Count -gt 0) {
        $PreserveRecovery = $true
        throw "Install transaction failed ($TransactionError) and rollback also failed: $($RollbackErrors -join '; ')"
      }
      Remove-RegularFileIfPresent $LineageSnapshotPath
      $LineageSnapshotPath = $null
      Remove-RegularFileIfPresent $BackupSnapshotPath
      $BackupSnapshotPath = $null
      Remove-RegularFileIfPresent $JournalPath
      if ($HadTarget) {
        throw "Install transaction failed; the previous version was restored. $TransactionError"
      }
      throw "Install transaction failed; the partial installation was removed. $TransactionError"
    }
    if (-not $Swapped -and $JournalPath -and [IO.File]::Exists($JournalPath)) {
      try {
        [void](Invoke-InterruptedInstallRecovery `
          $InstallDir $TargetPath $BackupPath $AliasPath $LineagePath $JournalPath)
        $LineageSnapshotPath = $null
      } catch {
        $PreserveRecovery = $true
        throw "Install transaction failed ($TransactionError) and pre-commit recovery failed: $($_.Exception.Message)"
      }
    }
    throw
  }
  Write-Host "Installed ChainlessChain CLI at $TargetPath"
} finally {
  Remove-RegularFileIfPresent $CandidatePath
  Remove-RegularFileIfPresent $AliasCandidatePath
  if ($JournalPath -and [IO.File]::Exists($JournalPath)) {
    $PreserveRecovery = $true
  }
  if (-not $PreserveRecovery) {
    Remove-RegularFileIfPresent $RollbackTempPath
    Remove-RegularFileIfPresent $AliasBackupPath
    Remove-RegularFileIfPresent $AliasRollbackPath
    Remove-RegularFileIfPresent $BackupSnapshotPath
    Remove-RegularFileIfPresent $LineageSnapshotPath
  } else {
    if ($RollbackTempPath) { Write-Warning "Rollback candidate preserved at $RollbackTempPath" }
    if ($AliasBackupPath) { Write-Warning "CLI alias recovery snapshot preserved at $AliasBackupPath" }
    if ($AliasRollbackPath) { Write-Warning "CLI alias rollback candidate preserved at $AliasRollbackPath" }
    if ($LineageSnapshotPath) { Write-Warning "Lineage recovery snapshot preserved at $LineageSnapshotPath" }
    if ($BackupSnapshotPath) { Write-Warning "Backup recovery snapshot preserved at $BackupSnapshotPath" }
    if ($JournalPath) { Write-Warning "Native install transaction journal preserved at $JournalPath" }
  }
  if ($PreserveRecovery -and $null -ne $InstallLock) {
    try { $InstallLock.Stream.Dispose() } catch { }
    Write-Warning "Native update lock retained for manual recovery at $($InstallLock.Path)"
  } else {
    Release-ExclusiveInstallLock $InstallLock
  }
  Remove-Item -Recurse -Force -LiteralPath $Staging -ErrorAction SilentlyContinue
}
