# Windows transport for deploy-docs-snapshot.sh. Git Bash prepares the archives;
# PowerShell launches the SSH client in the same context used for key authentication.
param(
    [string]$Server = 'root@47.111.5.128'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bash = 'C:\Program Files\Git\bin\bash.exe'
$ssh = 'C:\Program Files\Git\usr\bin\ssh.exe'
$scp = 'C:\Program Files\Git\usr\bin\scp.exe'
$cygpath = 'C:\Program Files\Git\usr\bin\cygpath.exe'
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no')

foreach ($tool in @($bash, $ssh, $scp, $cygpath)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing tool: $tool" }
}

Push-Location $repoRoot
try {
    $env:DOCS_DEPLOY_PREPARE_ONLY = '1'
    $prepareOutput = & $bash 'scripts/deploy-docs-snapshot.sh' 2>&1
    $prepareExitCode = $LASTEXITCODE
    Remove-Item Env:DOCS_DEPLOY_PREPARE_ONLY -ErrorAction SilentlyContinue
    $prepareOutput | ForEach-Object { Write-Host $_ }
    if ($prepareExitCode -ne 0) { throw "Archive preparation failed: $prepareExitCode" }

    $joined = $prepareOutput -join "`n"
    $stamp = [regex]::Match($joined, 'Deployment stamp: ([a-zA-Z0-9-]+)').Groups[1].Value
    $workUnix = [regex]::Match($joined, 'Local evidence: (/[^\r\n]+)').Groups[1].Value
    if (-not $stamp -or -not $workUnix) { throw 'Missing archive preparation metadata' }
    $workDir = (& $cygpath -w $workUnix).Trim()
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $workDir -PathType Container)) {
        throw "Cannot resolve prepared archives: $workUnix"
    }
    $sourceHead = [regex]::Match($joined, 'Source commit: ([0-9a-f]{40})').Groups[1].Value
    if ($sourceHead -notmatch '^[0-9a-f]{40}$') { throw 'Invalid prepared source commit' }
    $currentHead = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $currentHead -ne $sourceHead -or (& git status --porcelain)) {
        throw 'Source commit or worktree changed after archive preparation'
    }

    $localScript = Join-Path $PSScriptRoot 'deploy-docs-snapshot.sh'
    $lines = [System.IO.File]::ReadAllLines($localScript)
    $start = -1
    $end = -1
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($start -lt 0 -and $lines[$i].Contains("<<'REMOTE'")) { $start = $i + 1; continue }
        if ($start -ge 0 -and $lines[$i] -eq 'REMOTE') { $end = $i; break }
    }
    if ($start -lt 0 -or $end -le $start) { throw 'Remote deployment script not found' }
    $remoteBody = ($lines[$start..($end - 1)] -join "`n") + "`n"
    $remoteScriptLocal = Join-Path $workDir 'deploy-remote.sh'
    [System.IO.File]::WriteAllText($remoteScriptLocal, $remoteBody, (New-Object System.Text.UTF8Encoding($false)))

    $prefix = "/tmp/chainlesschain-docs-$stamp"
    $remoteScript = "$prefix-remote.sh"
    $remotePaths = @("$prefix-manifest.tsv", "$prefix-docs.tar.gz", "$prefix-design.tar.gz", "$prefix-www.tar.gz", $remoteScript)
    $preflight = ($remotePaths | ForEach-Object { "test ! -e '$_' && test ! -L '$_'" }) -join ' && '
    & $ssh @sshOptions $Server $preflight
    if ($LASTEXITCODE -ne 0) { throw 'Remote upload paths already exist or SSH authentication failed' }

    $upload = @(
        @('manifest.tsv', "$prefix-manifest.tsv"),
        @('docs.tar.gz', "$prefix-docs.tar.gz"),
        @('design.tar.gz', "$prefix-design.tar.gz"),
        @('www.tar.gz', "$prefix-www.tar.gz"),
        @('deploy-remote.sh', $remoteScript)
    )
    foreach ($pair in $upload) {
        $localPath = Join-Path $workDir $pair[0]
        if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) { throw "Missing archive: $localPath" }
        & $scp @sshOptions -q $localPath "${Server}:$($pair[1])"
        if ($LASTEXITCODE -ne 0) { throw "Upload failed: $($pair[0])" }
        Write-Host "Uploaded $($pair[0])"
    }

    & $ssh @sshOptions $Server "bash '$remoteScript' '$stamp' '$sourceHead'"
    if ($LASTEXITCODE -ne 0) { throw "Remote deployment failed; inspect rollback output and $workDir" }
    Write-Host "Deployment complete: $stamp"
    Write-Host "Local evidence: $workDir"
} finally {
    Remove-Item Env:DOCS_DEPLOY_PREPARE_ONLY -ErrorAction SilentlyContinue
    Pop-Location
}
