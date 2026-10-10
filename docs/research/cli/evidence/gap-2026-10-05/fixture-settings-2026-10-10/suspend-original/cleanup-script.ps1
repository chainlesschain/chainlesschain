$ErrorActionPreference = 'Stop'
$gapOutput = 'C:\code\chainlesschain\docs\research\cli\evidence\gap-2026-10-05\fixture-settings-2026-10-10\suspend-original'
[IO.Directory]::CreateDirectory($gapOutput) | Out-Null
$gapUtf8 = New-Object Text.UTF8Encoding($false)
$gapCaptured = @()
$gapEvents = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1,42,107; StartTime = [datetime]'2026-10-10T17:40:00'; EndTime = [datetime]'2026-10-10T19:51:00' } | Where-Object { $_.ProviderName -in @('Microsoft-Windows-Kernel-Power','Microsoft-Windows-Power-Troubleshooter') }
foreach ($gapEvent in $gapEvents) {
  $gapName = 'event-' + $gapEvent.RecordId + '.xml'
  $gapFile = Join-Path $gapOutput $gapName
  if (Test-Path -LiteralPath $gapFile) { throw 'Refuse evidence overwrite' }
  [IO.File]::WriteAllText($gapFile, $gapEvent.ToXml(), $gapUtf8)
  $gapCaptured += @{ file = $gapName; bytes = (Get-Item -LiteralPath $gapFile).Length; digest = 'sha256:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $gapFile).Hash.ToLowerInvariant() }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GapFixtureProfileCleanup {
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)]
  public static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)]
  public static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")]
  public static extern IntPtr FreeSid(IntPtr sid);
}
'@
$gapRoot = (Resolve-Path -LiteralPath 'C:\Users\longfa\AppData\Local\Temp\cc-private-v4-skuHBX').ProviderPath
if ($gapRoot -cne 'C:\Users\longfa\AppData\Local\Temp\cc-private-v4-skuHBX') { throw 'Exact timeout capsule required' }
$gapSid = 'S-1-15-2-3607293011-3894750309-2682347069-1517443381-3804853974-3517777664-2634433053'
$gapAclSids = @((Get-Acl -LiteralPath $gapRoot).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } | Where-Object { $_.StartsWith('S-1-15-2-') })
if ($gapAclSids.Count -ne 1 -or $gapAclSids[0] -cne $gapSid) { throw 'Capsule AppContainer SID differs' }
$gapMapping = 'Registry::HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Mappings\' + $gapSid
$gapProfile = Get-ItemProperty -LiteralPath $gapMapping
$gapName = $gapProfile.Moniker
if ($gapName -cne $gapProfile.DisplayName -or $gapName -cnotmatch '^cc\.private\.v4\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') { throw 'Exact diagnostic profile moniker required' }
$gapPointer = [IntPtr]::Zero
$gapDerived = [GapFixtureProfileCleanup]::DeriveAppContainerSidFromAppContainerName($gapName, [ref]$gapPointer)
if ($gapDerived -ne 0 -or $gapPointer -eq [IntPtr]::Zero) { throw 'Profile SID derivation failed' }
try { $gapDerivedSid = (New-Object Security.Principal.SecurityIdentifier($gapPointer)).Value } finally { [GapFixtureProfileCleanup]::FreeSid($gapPointer) | Out-Null }
if ($gapDerivedSid -cne $gapSid) { throw 'Derived profile SID differs from capsule ACL' }
$gapResult = [GapFixtureProfileCleanup]::DeleteAppContainerProfile($gapName)
$gapDeleted = $gapResult -eq 0 -and -not (Test-Path -LiteralPath $gapMapping)
$gapReceipt = @{ recordedAt = [DateTime]::UtcNow.ToString('o'); capsule = $gapRoot; appContainerSid = $gapSid; profileName = $gapName; aclAndDerivedSidMatched = $true; deleteHresult = $gapResult; profileDeleted = $gapDeleted; originalNativeSettlementConfirmed = $false; originalJobOrProcessHandlesRecovered = $false; scope = 'Independent exact profile-registration cleanup; does not replace missing original HANDLE/Job settlement'; eventEncoding = 'Windows Event.ToXml UTF-8 API response; not raw EVTX'; captures = $gapCaptured }
$gapReceiptFile = Join-Path $gapOutput 'cleanup.json'
if (Test-Path -LiteralPath $gapReceiptFile) { throw 'Refuse cleanup receipt overwrite' }
[IO.File]::WriteAllText($gapReceiptFile, ($gapReceipt | ConvertTo-Json -Depth 8) + [Environment]::NewLine, $gapUtf8)
$gapReceipt | ConvertTo-Json -Depth 8
if (-not $gapDeleted) { throw 'Profile deletion unconfirmed' }
