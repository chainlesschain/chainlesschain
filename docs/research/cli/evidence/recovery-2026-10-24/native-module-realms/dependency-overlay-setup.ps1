$ErrorActionPreference = 'Stop'
$sourceRoot = 'C:\code\chainlesschain\.work\cc118-native-ports'
$originalPath = [IO.Path]::GetFullPath((Join-Path $sourceRoot 'packages\cli\node_modules'))
$overlayRoot = [IO.Path]::GetFullPath('C:\code\chainlesschain\.work\cc118-runtime-dependency-overlay')
$backupPath = [IO.Path]::GetFullPath((Join-Path $overlayRoot 'original-cli-node-modules-junction'))
$sharedTarget = 'C:\code\chainlesschain\packages\cli\node_modules'
$nativeSqlite = 'C:\code\chainlesschain\node_modules\better-sqlite3'
if ($originalPath -ne 'C:\code\chainlesschain\.work\cc118-native-ports\packages\cli\node_modules') { throw 'Unexpected source path' }
if (-not $backupPath.StartsWith($overlayRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup escapes overlay directory' }
$item = Get-Item -LiteralPath $originalPath -Force
if ($item.LinkType -ne 'Junction' -or [string]$item.Target -ne $sharedTarget) { throw 'Original path is not the expected shared junction' }
if (Test-Path -LiteralPath $backupPath) { throw 'Inspect existing dependency backup before proceeding' }
$sqlitePackage = Get-Content -LiteralPath (Join-Path $nativeSqlite 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($sqlitePackage.version -ne '12.11.1') { throw 'Unexpected SQLite dependency version' }
if (-not (Test-Path -LiteralPath (Join-Path $nativeSqlite 'build\Release\better_sqlite3.node'))) { throw 'Missing real native SQLite module' }
New-Item -ItemType Directory -Path $overlayRoot -Force | Out-Null
$receiptPath = Join-Path $overlayRoot 'receipt.json'
$receipt = [ordered]@{sourceRoot=$sourceRoot; originalPath=$originalPath; sharedTarget=$sharedTarget; backupPath=$backupPath; sqliteTarget=$nativeSqlite; sqliteVersion='12.11.1'; sharedTargetsModified=$false; movedOriginalJunction=$false; overlayCreated=$false; links=@(); at=[DateTime]::UtcNow.ToString('o')}
function Save-Receipt { $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8 }
Save-Receipt
# Move only the checked junction itself; never traverse or move its shared target.
Move-Item -LiteralPath $originalPath -Destination $backupPath
$receipt.movedOriginalJunction = $true
Save-Receipt
New-Item -ItemType Directory -Path $originalPath | Out-Null
$receipt.overlayCreated = $true
Save-Receipt
foreach ($child in Get-ChildItem -LiteralPath $sharedTarget -Force) {
    $destination = Join-Path $originalPath $child.Name
    if ($child.PSIsContainer) {
        $target = if ($child.Name -eq 'better-sqlite3') { $nativeSqlite } else { $child.FullName }
        New-Item -ItemType Junction -Path $destination -Target $target | Out-Null
        $receipt.links += [ordered]@{path=$destination; target=$target; kind='junction'}
    } else {
        Copy-Item -LiteralPath $child.FullName -Destination $destination
        $receipt.links += [ordered]@{path=$destination; source=$child.FullName; kind='isolated-copy'}
    }
}
Save-Receipt
$receipt | ConvertTo-Json -Depth 8
