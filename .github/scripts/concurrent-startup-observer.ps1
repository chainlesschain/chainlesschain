# One passive process, no child launches, Add-Type, command lines or paths in output.
$ErrorActionPreference = 'Stop'
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput())
$owned = @()
try {
  $manifest = $reader.ReadLine() | ConvertFrom-Json
  if (@($manifest).Count -gt 20) { exit 2 }
  foreach ($entry in $manifest) {
    if ($entry.agentIndex -lt 0 -or $entry.agentIndex -ge 20 -or $entry.pid -le 0) { exit 2 }
    $process = $null
    try {
      $process = [System.Diagnostics.Process]::GetProcessById([int]$entry.pid)
      # Hold the native handle; do not reacquire this PID after process exit.
      $null = $process.Handle
      $created = [DateTimeOffset]::new($process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
      if ($created -lt $entry.beforeMs -or $created -gt $entry.afterMs) {
        $process.Dispose()
        $process = $null
      }
    } catch { if ($null -ne $process) { $process.Dispose() }; $process = $null }
    $owned += @{ agentIndex = [int]$entry.agentIndex; process = $process; retired = ($null -eq $process) }
  }
  [Console]::Out.WriteLine('{"kind":"ready"}')
  $stop = $reader.ReadLineAsync()
  for ($sample = 0; $sample -lt 131 -and $clock.ElapsedMilliseconds -lt 130000; $sample++) {
    if ($stop.IsCompleted) { break }
    foreach ($entry in $owned) {
      $available = $false
      $cpu = $null
      $rss = $null
      if (-not $entry.retired) {
        try {
          if ($entry.process.HasExited) { $entry.retired = $true }
          else {
            $entry.process.Refresh()
            $cpu = $entry.process.TotalProcessorTime.TotalMilliseconds
            $rss = $entry.process.WorkingSet64
            $available = $true
          }
        } catch { $entry.retired = $true }
      }
      $row = @{ kind = 'sample'; agentIndex = $entry.agentIndex; observerMs = $clock.ElapsedMilliseconds; available = $available; cpuMs = $cpu; rssBytes = $rss }
      [Console]::Out.WriteLine(($row | ConvertTo-Json -Compress))
    }
    # EOF/stop wakes promptly; no additional process or asynchronous script block.
    if ($stop.Wait(1000)) { break }
  }
} catch {
  [Console]::Out.WriteLine('{"kind":"unavailable"}')
  exit 1
} finally {
  foreach ($entry in $owned) { if ($null -ne $entry.process) { $entry.process.Dispose() } }
  $reader.Dispose()
}
