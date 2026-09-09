param(
  [Parameter(Mandatory = $true)]
  [string]$PipeName,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1024, 1048576)]
  [int]$MaxFrameBytes
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ($PipeName -notmatch '^cc-evolution-attestor-trust-(approval|ops)-[a-f0-9]{16,64}$') {
  throw "secure pipe broker endpoint is invalid"
}

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class ChainlessChainNamedPipePeer
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(
        SafePipeHandle pipe,
        out uint clientProcessId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(
        IntPtr processHandle,
        uint desiredAccess,
        out IntPtr tokenHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private const uint TokenQuery = 0x0008;

    public static uint GetClientProcessId(SafePipeHandle pipe)
    {
        uint processId;
        if (!GetNamedPipeClientProcessId(pipe, out processId) || processId == 0)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return processId;
    }

    public static string GetProcessUserSid(uint processId)
    {
        using (Process process = Process.GetProcessById(checked((int)processId)))
        {
            IntPtr token;
            if (!OpenProcessToken(process.Handle, TokenQuery, out token))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                using (WindowsIdentity identity = new WindowsIdentity(token))
                {
                    if (identity.User == null)
                        throw new InvalidOperationException("client process has no user SID");
                    return identity.User.Value;
                }
            }
            finally
            {
                CloseHandle(token);
            }
        }
    }
}
'@

function Write-JsonLine([object]$Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 12))
  [Console]::Out.Flush()
}

function Write-PipeJsonLine([System.IO.StreamWriter]$Writer, [object]$Value) {
  $Writer.WriteLine(($Value | ConvertTo-Json -Compress -Depth 12))
  $Writer.Flush()
}

function Get-Sha256([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return "sha256:" + (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
  }
  finally {
    $sha.Dispose()
  }
}

function Read-BoundedUtf8Line(
  [System.IO.Stream]$Stream,
  [int]$MaximumBytes,
  [int]$TimeoutMilliseconds
) {
  $body = New-Object System.IO.MemoryStream
  $buffer = New-Object byte[] 4096
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  try {
    while ($true) {
      $remaining = [int][Math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds)
      if ($remaining -le 0) {
        throw "request_timeout"
      }
      $read = $Stream.ReadAsync($buffer, 0, $buffer.Length)
      if (-not $read.Wait($remaining)) {
        throw "request_timeout"
      }
      $count = $read.Result
      if ($count -eq 0) {
        throw "secure pipe client closed before completing a frame"
      }
      $newline = -1
      for ($index = 0; $index -lt $count; $index += 1) {
        if ($buffer[$index] -eq 10) {
          $newline = $index
          break
        }
      }
      $writeCount = if ($newline -ge 0) { $newline } else { $count }
      $body.Write($buffer, 0, $writeCount)
      if ($body.Length -gt $MaximumBytes) {
        throw "request_too_large"
      }
      if ($newline -ge 0) {
        for ($index = $newline + 1; $index -lt $count; $index += 1) {
          if ($buffer[$index] -notin @(9, 10, 13, 32)) {
            throw "invalid_frame"
          }
        }
        break
      }
    }
    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $value = $strictUtf8.GetString($body.ToArray())
    if ($value.EndsWith("`r")) {
      return $value.Substring(0, $value.Length - 1)
    }
    return $value
  }
  finally {
    $body.Dispose()
  }
}

function New-SecurePipeServer(
  [string]$Name,
  [System.IO.Pipes.PipeSecurity]$PipeSecurity
) {
  return New-Object System.IO.Pipes.NamedPipeServerStream(
    $Name,
    [System.IO.Pipes.PipeDirection]::InOut,
    2,
    [System.IO.Pipes.PipeTransmissionMode]::Byte,
    [System.IO.Pipes.PipeOptions]::None,
    4096,
    4096,
    $PipeSecurity
  )
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User
$networkSid = New-Object System.Security.Principal.SecurityIdentifier(
  [System.Security.Principal.WellKnownSidType]::NetworkSid,
  $null
)
$security = New-Object System.IO.Pipes.PipeSecurity
$security.SetOwner($userSid)
$security.SetAccessRuleProtection($true, $false)
$security.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule(
  $networkSid,
  [System.IO.Pipes.PipeAccessRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Deny
)))
$security.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule(
  $userSid,
  [System.IO.Pipes.PipeAccessRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Allow
)))

$sddl = $security.GetSecurityDescriptorSddlForm(
  [System.Security.AccessControl.AccessControlSections]::Access -bor
  [System.Security.AccessControl.AccessControlSections]::Owner
)
$securityDescriptor = [ordered]@{
  acl = "protected-current-user-dacl"
  aclDigest = Get-Sha256 $sddl
  peerIdentity = "client-process-token-user-sid"
  principalDigest = Get-Sha256 $userSid.Value
  remoteClients = $false
}
$server = New-SecurePipeServer $PipeName $security
Write-JsonLine ([ordered]@{
  schema = "chainlesschain.windows-secure-pipe-broker-ready/v1"
  ok = $true
  security = $securityDescriptor
})

$utf8 = New-Object System.Text.UTF8Encoding($false)
while ($true) {
  if ($null -eq $server) {
    $server = New-SecurePipeServer $PipeName $security
  }
  $nextServer = $null
  try {
    $server.WaitForConnection()
    $nextServer = New-SecurePipeServer $PipeName $security
    $writer = New-Object System.IO.StreamWriter($server, $utf8, 4096, $true)
    $writer.NewLine = "`n"
    try {
      $clientProcessId = [ChainlessChainNamedPipePeer]::GetClientProcessId($server.SafePipeHandle)
      $clientUserSid = [ChainlessChainNamedPipePeer]::GetProcessUserSid($clientProcessId)
      if ($clientUserSid -ne $userSid.Value) {
        Write-PipeJsonLine $writer ([ordered]@{
          ok = $false
          requestId = $null
          code = "peer_identity_denied"
        })
        continue
      }

      try {
        $frame = Read-BoundedUtf8Line $server $MaxFrameBytes 30000
      }
      catch {
        Write-PipeJsonLine $writer ([ordered]@{
          ok = $false
          requestId = $null
          code = if ($_.Exception.Message -eq "request_too_large") { "request_too_large" } else { "invalid_frame" }
        })
        continue
      }

      try {
        $request = $frame | ConvertFrom-Json
        $claimedProcessId = [uint32]$request.clientProcessId
      }
      catch {
        Write-PipeJsonLine $writer ([ordered]@{
          ok = $false
          requestId = $null
          code = "peer_identity_denied"
        })
        continue
      }
      if ($claimedProcessId -ne $clientProcessId) {
        Write-PipeJsonLine $writer ([ordered]@{
          ok = $false
          requestId = if ($request.requestId -is [string]) { $request.requestId } else { $null }
          code = "peer_identity_denied"
        })
        continue
      }

      $connectionId = [Guid]::NewGuid().ToString("N")
      Write-JsonLine ([ordered]@{
        schema = "chainlesschain.windows-secure-pipe-broker-request/v1"
        connectionId = $connectionId
        clientProcessId = [int64]$clientProcessId
        clientPrincipalDigest = Get-Sha256 $clientUserSid
        frame = $frame
      })

      $responseLine = [Console]::In.ReadLine()
      if ($null -eq $responseLine) {
        throw "secure pipe broker control channel closed"
      }
      $response = $responseLine | ConvertFrom-Json
      if (
        $response.schema -ne "chainlesschain.windows-secure-pipe-broker-response/v1" -or
        $response.connectionId -ne $connectionId -or
        $response.frame -isnot [string] -or
        [System.Text.Encoding]::UTF8.GetByteCount($response.frame) -gt $MaxFrameBytes
      ) {
        throw "secure pipe broker received an invalid service response"
      }
      $writer.Write($response.frame)
      $writer.Flush()
    }
    finally {
      if ($null -ne $writer) { $writer.Dispose() }
    }
  }
  finally {
    if ($null -eq $nextServer) {
      $nextServer = New-SecurePipeServer $PipeName $security
    }
    $server.Dispose()
    $server = $nextServer
  }
}
