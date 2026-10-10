$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GapFixtureAwake {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint SetThreadExecutionState(uint flags);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
}
'@
$gapStartedAt = [DateTime]::UtcNow.ToString('o')
$gapThread = [GapFixtureAwake]::GetCurrentThreadId()
$gapAcquire = [GapFixtureAwake]::SetThreadExecutionState([uint32]2147483649)
if ($gapAcquire -eq 0) { throw 'Temporary execution request failed' }
$gapExit = 1
try {
  & node .work/gap-controls-native-run-20261010.mjs fixture-baseline fixture-full-baseline-20261010-b all
  $gapExit = $LASTEXITCODE
} finally {
  $gapRelease = [GapFixtureAwake]::SetThreadExecutionState([uint32]2147483648)
  $gapEndThread = [GapFixtureAwake]::GetCurrentThreadId()
  $gapReceipt = @{ startedAt = $gapStartedAt; finishedAt = [DateTime]::UtcNow.ToString('o'); threadId = $gapThread; finalThreadId = $gapEndThread; acquiredPreviousState = $gapAcquire; releasePreviousState = $gapRelease; acquisitionFlags = 2147483649; releaseFlags = 2147483648; nativeExit = $gapExit; nativeInvocation = 'fixture-baseline fixture-full-baseline-20261010-b all'; scope = 'Temporary per-thread idle-sleep prevention for local verification; no deadline, production runtime or persistent power-plan change'; scriptDigest = 'sha256:' + (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() }
  $gapFile = 'C:\code\chainlesschain\docs\research\cli\evidence\gap-2026-10-05\fixture-settings-2026-10-10\awake-retry.json'
  if (Test-Path -LiteralPath $gapFile) { throw 'Refuse execution receipt overwrite' }
  [IO.File]::WriteAllText($gapFile, ($gapReceipt | ConvertTo-Json -Depth 6) + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
  $gapReceipt | ConvertTo-Json -Depth 6
}
if ($gapRelease -eq 0 -or $gapThread -ne $gapEndThread) { throw 'Execution request release unconfirmed' }
exit $gapExit
