/** Owner-only filesystem helpers for configuration, credentials and sessions. */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import {
  isAbsolute as isNativeAbsolute,
  parse,
  resolve,
  win32,
  posix,
} from "node:path";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

function samePath(left, right, caseInsensitive = false) {
  const trim = (value) => String(value).replace(/[\\/]+$/, "");
  const a = trim(left);
  const b = trim(right);
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Guard every ACL/chmod repair entry point, not just paths.js callers. */
export function assertSafeOwnerOnlyPath(target, platform = process.platform) {
  const value = String(target || "").trim();
  if (!value) throw new Error("Owner-only storage path must not be empty");
  const pathApi =
    platform === "win32"
      ? win32
      : platform === "darwin" || platform === "linux"
        ? posix
        : { isAbsolute: isNativeAbsolute, parse, resolve };
  const native = pathApi.resolve(value);
  const nativeRoot = pathApi.parse(native).root;
  const posixPath = posix.isAbsolute(value) ? posix.normalize(value) : null;
  const windowsPath = win32.isAbsolute(value) ? win32.normalize(value) : null;
  const isAbsolute = pathApi.isAbsolute(value);
  const windowsLiteral = value.replaceAll("/", "\\");
  const normalizedWindowsLiteral = String(windowsPath || windowsLiteral);
  const extendedWindowsRoot =
    /^\\\\\?\\[A-Za-z]:\\?$/.test(normalizedWindowsLiteral) ||
    /^\\\\\?\\UNC\\[^\\]+\\[^\\]+\\?$/.test(normalizedWindowsLiteral);
  const normalizedWindowsLower = normalizedWindowsLiteral.toLowerCase();
  const forbiddenWindowsDevice =
    normalizedWindowsLower.startsWith("\\\\?\\") ||
    normalizedWindowsLower.startsWith("\\\\.\\");
  const isRoot =
    samePath(native, nativeRoot, platform === "win32") ||
    (posixPath !== null && samePath(posixPath, posix.parse(posixPath).root)) ||
    (windowsPath !== null &&
      samePath(windowsPath, win32.parse(windowsPath).root, true)) ||
    /^[A-Za-z]:$/.test(value) ||
    extendedWindowsRoot ||
    forbiddenWindowsDevice;
  if (isRoot) {
    const error = new Error(
      `Refusing owner-only permission changes on a filesystem root: ${value}`,
    );
    error.code = "CONFIG_HOME_UNSAFE";
    throw error;
  }
  const caseInsensitive = ["win32", "darwin"].includes(platform);
  const protectedLocation = samePath(
    native,
    pathApi.resolve(homedir()),
    caseInsensitive,
  );
  if (protectedLocation || !isAbsolute) {
    const error = new Error(
      `Refusing owner-only permission changes on a broad protected directory: ${value}`,
    );
    error.code = "CONFIG_HOME_UNSAFE";
    throw error;
  }
  return target;
}

const TRUSTED_DARWIN_SYSTEM_ALIASES = new Map([["/var", "/private/var"]]);

/**
 * macOS exposes its real temporary-directory tree through the root-owned
 * `/var -> private/var` compatibility alias. Rejecting that immutable system
 * alias makes every `os.tmpdir()`-backed session fail, while accepting generic
 * links would re-open the chmod/DACL traversal attack this guard prevents.
 *
 * Keep the exception deliberately narrow: exact alias, exact canonical target,
 * root ownership on both entries, and a non-writable canonical directory.
 */
function isTrustedDarwinSystemAlias(current, entry, deps, platform) {
  if (platform !== "darwin") return false;
  const expected = TRUSTED_DARWIN_SYSTEM_ALIASES.get(current);
  if (!expected || Number(entry?.uid) !== 0) return false;
  try {
    const canonical = deps.realpathSync(current);
    if (!samePath(canonical, expected)) return false;
    const target = deps.lstatSync(canonical);
    const targetMode = Number(target.mode);
    return (
      !target.isSymbolicLink() &&
      target.isDirectory() &&
      Number(target.uid) === 0 &&
      Number.isInteger(targetMode) &&
      (targetMode & 0o022) === 0
    );
  } catch {
    return false;
  }
}

function readWindowsDirectoryEntry(target, deps) {
  if (typeof deps.readdirSync !== "function") return null;
  const parent = win32.dirname(target);
  if (!parent || samePath(parent, target, true)) return null;
  let entries;
  try {
    entries = deps.readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const name = win32.basename(target);
  const matches = entries.filter(
    (candidate) => String(candidate?.name || "") === name,
  );
  if (matches.length !== 1) return null;
  const [entry] = matches;
  if (
    typeof entry.isSymbolicLink !== "function" ||
    typeof entry.isDirectory !== "function" ||
    typeof entry.isFile !== "function"
  ) {
    return null;
  }
  try {
    const isSymbolicLink = Boolean(entry.isSymbolicLink());
    const isDirectory = Boolean(entry.isDirectory());
    const isFile = Boolean(entry.isFile());
    if (!isSymbolicLink && isDirectory === isFile) return null;
    return {
      exists: true,
      isDirectory,
      isFile,
      isSymbolicLink,
    };
  } catch {
    return null;
  }
}

function windowsUnreliablePathStatError(target, cause) {
  const error = new Error(
    `Windows path metadata could not reliably classify an existing path: ${target}`,
    cause ? { cause } : undefined,
  );
  error.code = "WINDOWS_PATH_STAT_UNRELIABLE";
  return error;
}

function assertNoLinkTraversal(
  target,
  deps = fs,
  checkedPaths = null,
  platform = process.platform,
) {
  // Dependency-injected cross-platform tests must walk the target platform's
  // path grammar, not the host running Vitest (for example `/var` on Windows).
  const pathApi =
    platform === "win32"
      ? win32
      : platform === "darwin" || platform === "linux"
        ? posix
        : { resolve, parse };
  const absolute = pathApi.resolve(String(target));
  const root = pathApi.parse(absolute).root;
  const segments = absolute
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = pathApi.resolve(current, segment);
    const cacheKey =
      process.platform === "win32" ? current.toLowerCase() : current;
    if (checkedPaths?.has(cacheKey)) continue;
    let entry;
    try {
      entry = deps.lstatSync(current);
    } catch (error) {
      if (
        platform === "win32" &&
        ["ENOENT", "EPERM", "EACCES"].includes(error?.code)
      ) {
        const directoryEntry = readWindowsDirectoryEntry(current, deps);
        if (directoryEntry) {
          if (directoryEntry.isSymbolicLink) {
            const unsafe = new Error(
              `Refusing owner-only permission changes through a symbolic link or junction: ${current}`,
            );
            unsafe.code = "CONFIG_HOME_UNSAFE";
            throw unsafe;
          }
          checkedPaths?.add(cacheKey);
          continue;
        }
        throw windowsUnreliablePathStatError(current, error);
      }
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (
      entry.isSymbolicLink() &&
      !isTrustedDarwinSystemAlias(current, entry, deps, platform)
    ) {
      const error = new Error(
        `Refusing owner-only permission changes through a symbolic link or junction: ${current}`,
      );
      error.code = "CONFIG_HOME_UNSAFE";
      throw error;
    }
    checkedPaths?.add(cacheKey);
  }
  return target;
}

const WINDOWS_ACL_SCRIPT = String.raw`
param([string]$target, [string]$operation)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$sections =
  [System.Security.AccessControl.AccessControlSections]::Access -bor
  [System.Security.AccessControl.AccessControlSections]::Owner
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$tokenOwner = $identity.Owner

function Assert-CcNoReparseTraversal([string]$path) {
  $cursor = [System.IO.Path]::GetFullPath($path)
  while (-not (Test-Path -LiteralPath $cursor)) {
    $parent = [System.IO.Directory]::GetParent($cursor)
    if ($null -eq $parent) { return }
    $cursor = $parent.FullName
  }
  $entry = Get-Item -LiteralPath $cursor -Force
  while ($null -ne $entry) {
    if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "symbolic links and reparse points are not allowed: $($entry.FullName)"
    }
    $entry = $entry.Parent
  }
}

Assert-CcNoReparseTraversal $target
$item = Get-Item -LiteralPath $target -Force

function Read-CcAcl([string]$path) {
  if ([System.IO.Directory]::Exists($path)) {
    return [System.Security.AccessControl.DirectorySecurity]::new($path, $sections)
  }
  return [System.Security.AccessControl.FileSecurity]::new($path, $sections)
}

function Write-CcOwnerOnlyAcl($item, [string]$path) {
  $security = Read-CcAcl $path
  $owner = $security.GetOwner([System.Security.Principal.SecurityIdentifier])
  if ($owner.Value -ne $sid.Value) {
    # Elevated/service tokens can create files whose owner is the token's
    # default owner group (for example BUILTIN\Administrators on hosted CI),
    # even though the token user created the object. Only that exact token-owned
    # case may converge to the narrower user SID; every unrelated owner remains
    # fail-closed.
    if ($null -eq $tokenOwner -or $owner.Value -ne $tokenOwner.Value) {
      throw "owner-only ACL repair refuses a path owned by another identity: $path"
    }
    $security.SetOwner($sid)
  }
  $security.SetAccessRuleProtection($true, $false)
  $existingRules = @($security.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
  foreach ($existingRule in $existingRules) {
    $security.RemoveAccessRuleAll($existingRule)
  }
  if ($item.PSIsContainer) {
    $inheritance =
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule) | Out-Null
    [System.IO.DirectoryInfo]::new($path).SetAccessControl($security)
  } else {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.InheritanceFlags]::None,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule) | Out-Null
    [System.IO.FileInfo]::new($path).SetAccessControl($security)
  }
}

if ($operation -eq 'repair') {
  Write-CcOwnerOnlyAcl $item $target
}

$acl = Read-CcAcl $target
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$protectionOk = -not $item.PSIsContainer -or $acl.AreAccessRulesProtected
$ownerOnly =
  $protectionOk -and
  $owner -eq $sid.Value -and
  $rules.Count -eq 1
if ($ownerOnly) {
  foreach ($rule in $rules) {
    $full = ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl
    if ($item.PSIsContainer) {
      $requiredInheritance =
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
      $inheritanceOk =
        ($rule.InheritanceFlags -band $requiredInheritance) -eq $requiredInheritance
    } else {
      $inheritanceOk =
        $rule.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None
    }
    $propagationOk =
      $rule.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None
    if ($rule.IdentityReference.Value -ne $sid.Value -or
        $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
        ($item.PSIsContainer -and $rule.IsInherited) -or
        -not $inheritanceOk -or
        -not $propagationOk -or
        -not $full) {
      $ownerOnly = $false
      break
    }
  }
}
[pscustomobject]@{
  ownerOnly = [bool]$ownerOnly
  isDirectory = [bool]$item.PSIsContainer
  ownerSid = $owner
  currentSid = $sid.Value
  tokenOwnerSid = if ($null -eq $tokenOwner) { $null } else { $tokenOwner.Value }
  protected = [bool]$acl.AreAccessRulesProtected
  aceCount = $rules.Count
} | ConvertTo-Json -Compress
if (-not $ownerOnly) { exit 4 }
`;

const WINDOWS_ACL_BATCH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$sections =
  [System.Security.AccessControl.AccessControlSections]::Access -bor
  [System.Security.AccessControl.AccessControlSections]::Owner
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$tokenOwner = $identity.Owner
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$operation = [string]$request.operation
$targets = @($request.targets)
$expectedKind = [string]$request.expectedKind
if ($operation -ne 'inspect' -and $operation -ne 'repair' -and $operation -ne 'preflight') {
  throw "unsupported ACL batch operation: $operation"
}
if ($expectedKind -ne '' -and $expectedKind -ne 'file' -and $expectedKind -ne 'directory') {
  throw "unsupported expected path kind: $expectedKind"
}

function Assert-CcNoReparseTraversal([string]$path) {
  $cursor = [System.IO.Path]::GetFullPath($path)
  while (-not (Test-Path -LiteralPath $cursor)) {
    $parent = [System.IO.Directory]::GetParent($cursor)
    if ($null -eq $parent) { return }
    $cursor = $parent.FullName
  }
  $entry = Get-Item -LiteralPath $cursor -Force
  while ($null -ne $entry) {
    if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "symbolic links and reparse points are not allowed: $($entry.FullName)"
    }
    $entry = $entry.Parent
  }
}

# A repair is all-or-nothing with respect to path safety. Preflight every
# existing target before the first SetAccessControl call so a junction root
# cannot fail after a regular-looking descendant has already been modified.
if ($operation -eq 'repair' -or $operation -eq 'preflight') {
  $preflightFailures = @()
  foreach ($target in $targets) {
    try {
      Assert-CcNoReparseTraversal $target
      $candidate = Get-Item -LiteralPath $target -Force
      $kindMismatch =
        ($expectedKind -eq 'file' -and $candidate.PSIsContainer) -or
        ($expectedKind -eq 'directory' -and -not $candidate.PSIsContainer)
      if ($kindMismatch) {
        $preflightFailures += [pscustomobject]@{
          target = [string]$target
          error = "expected $expectedKind but found $(if ($candidate.PSIsContainer) { 'directory' } else { 'file' })"
          errorCode = 'EXPECTED_KIND_MISMATCH'
        }
      }
    } catch {
      if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
        $preflightFailures += [pscustomobject]@{
          target = [string]$target
          error = $_.Exception.Message
          errorCode = 'PATH_PREFLIGHT_FAILED'
        }
      }
    }
  }
  if ($preflightFailures.Count -gt 0) {
    $firstFailure = $preflightFailures[0]
    $output = @($targets | ForEach-Object {
      [pscustomobject]@{
        target = [string]$_
        exists = [bool](Test-Path -LiteralPath $_)
        isDirectory = $null
        ok = $false
        error = "ACL batch preflight failed at $($firstFailure.target): $($firstFailure.error)"
        errorCode = $firstFailure.errorCode
      }
    })
    [Console]::Write((ConvertTo-Json -InputObject $output -Compress -Depth 4))
    exit 4
  }
  if ($operation -eq 'preflight') {
    $output = @($targets | ForEach-Object {
      $preflightTarget = [string]$_
      $nativeItem = $null
      try {
        $nativeItem = Get-Item -LiteralPath $preflightTarget -Force
      } catch {
        if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
          throw
        }
      }
      [pscustomobject]@{
        target = $preflightTarget
        exists = [bool]($null -ne $nativeItem)
        isDirectory = if ($null -eq $nativeItem) { $null } else { [bool]$nativeItem.PSIsContainer }
        ok = $true
        error = $null
      }
    })
    [Console]::Write((ConvertTo-Json -InputObject $output -Compress -Depth 4))
    exit 0
  }
}

function Read-CcAcl([string]$path) {
  if ([System.IO.Directory]::Exists($path)) {
    return [System.Security.AccessControl.DirectorySecurity]::new($path, $sections)
  }
  return [System.Security.AccessControl.FileSecurity]::new($path, $sections)
}

function Write-CcOwnerOnlyAcl($item, [string]$path) {
  $security = Read-CcAcl $path
  $owner = $security.GetOwner([System.Security.Principal.SecurityIdentifier])
  if ($owner.Value -ne $sid.Value) {
    if ($null -eq $tokenOwner -or $owner.Value -ne $tokenOwner.Value) {
      throw "owner-only ACL repair refuses a path owned by another identity: $path"
    }
    $security.SetOwner($sid)
  }
  $security.SetAccessRuleProtection($true, $false)
  $existingRules = @($security.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
  foreach ($existingRule in $existingRules) {
    $security.RemoveAccessRuleAll($existingRule)
  }
  if ($item.PSIsContainer) {
    $inheritance =
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule) | Out-Null
    [System.IO.DirectoryInfo]::new($path).SetAccessControl($security)
  } else {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.InheritanceFlags]::None,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule) | Out-Null
    [System.IO.FileInfo]::new($path).SetAccessControl($security)
  }
}

$results = foreach ($target in $targets) {
  $item = $null
  try {
    Assert-CcNoReparseTraversal $target
    $item = Get-Item -LiteralPath $target -Force
    $kindMismatch =
      ($expectedKind -eq 'file' -and $item.PSIsContainer) -or
      ($expectedKind -eq 'directory' -and -not $item.PSIsContainer)
    if ($kindMismatch) {
      [pscustomobject]@{
        target = [string]$target
        exists = $true
        isDirectory = [bool]$item.PSIsContainer
        ok = $false
        error = "expected $expectedKind but found $(if ($item.PSIsContainer) { 'directory' } else { 'file' })"
        errorCode = 'EXPECTED_KIND_MISMATCH'
      }
      continue
    }
    if ($operation -eq 'repair') {
      Write-CcOwnerOnlyAcl $item $target
    }

    $acl = Read-CcAcl $target
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $protectionOk = -not $item.PSIsContainer -or $acl.AreAccessRulesProtected
    $ownerOnly =
      $protectionOk -and
      $owner -eq $sid.Value -and
      $rules.Count -eq 1
    if ($ownerOnly) {
      foreach ($rule in $rules) {
        $full = ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl
        if ($item.PSIsContainer) {
          $requiredInheritance =
            [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
          $inheritanceOk =
            ($rule.InheritanceFlags -band $requiredInheritance) -eq $requiredInheritance
        } else {
          $inheritanceOk =
            $rule.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None
        }
        $propagationOk =
          $rule.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None
        if ($rule.IdentityReference.Value -ne $sid.Value -or
            $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            ($item.PSIsContainer -and $rule.IsInherited) -or
            -not $inheritanceOk -or
            -not $propagationOk -or
            -not $full) {
          $ownerOnly = $false
          break
        }
      }
    }
    [pscustomobject]@{
      target = [string]$target
      exists = $true
      isDirectory = [bool]$item.PSIsContainer
      ok = [bool]$ownerOnly
      ownerSid = $owner
      currentSid = $sid.Value
      tokenOwnerSid = if ($null -eq $tokenOwner) { $null } else { $tokenOwner.Value }
      protected = [bool]$acl.AreAccessRulesProtected
      aceCount = $rules.Count
      error = if ($ownerOnly) { $null } else { 'path is not owner-only' }
      errorCode = $null
    }
  } catch {
    [pscustomobject]@{
      target = [string]$target
      exists = [bool](($null -ne $item) -or (Test-Path -LiteralPath $target))
      isDirectory = $null
      ok = $false
      error = $_.Exception.Message
      errorCode = 'PATH_OPERATION_FAILED'
    }
  }
}
$output = [array]@($results)
[Console]::Write((ConvertTo-Json -InputObject $output -Compress -Depth 4))
if (@($output | Where-Object { -not $_.ok }).Count -gt 0) { exit 4 }
`;

export const _deps = {
  fs,
  spawnSync,
  platform: () => process.platform,
};

// ACL repair starts a short PowerShell process on Windows. Cache successful
// production repairs by path for this process; explicit injected-dependency
// tests and repairPrivatePath() always execute and verify the operation.
const securedWindowsPaths = new Set();
const WINDOWS_ACL_BATCH_SIZE = 500;
const WINDOWS_ACL_TIMEOUT_ENV = "CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS";
const MAX_WINDOWS_ACL_TIMEOUT_MS = 5 * 60_000;

// Windows hosted runners can need more than the normal 15/30 second allowance
// to cold-start PowerShell and load the access-control types. A trusted harness
// may raise (but never lower) that allowance; the cap prevents an inherited
// environment value from wedging owner-only storage initialization forever.
export function _resolveWindowsAclTimeout(
  defaultTimeoutMs,
  environment = process.env,
) {
  const fallback = Math.max(1, Math.floor(Number(defaultTimeoutMs) || 1));
  const configured = Number(environment?.[WINDOWS_ACL_TIMEOUT_ENV]);
  if (!Number.isFinite(configured) || configured <= 0) return fallback;
  return Math.min(
    Math.max(fallback, Math.floor(configured)),
    MAX_WINDOWS_ACL_TIMEOUT_MS,
  );
}

function repairWindowsAclOnce(target, deps, options) {
  const cacheable = !options.deps;
  if (cacheable && securedWindowsPaths.has(target)) {
    return { ok: true, platform: "win32", cached: true };
  }
  const result = windowsAcl(target, "repair", deps);
  if (result.ok && cacheable) securedWindowsPaths.add(target);
  return result;
}

function windowsAcl(target, operation, deps) {
  const result = deps.spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& { ${WINDOWS_ACL_SCRIPT} }`,
      target,
      operation,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: _resolveWindowsAclTimeout(15_000),
    },
  );
  let details = null;
  try {
    details = JSON.parse(String(result?.stdout || "").trim());
  } catch {
    details = null;
  }
  if (result?.error) {
    return { ok: false, platform: "win32", error: result.error.message };
  }
  if (result?.status !== 0 || details?.ownerOnly !== true) {
    return {
      ok: false,
      platform: "win32",
      error:
        String(result?.stderr || "").trim() ||
        `owner-only ACL verification exited ${result?.status}`,
      details,
    };
  }
  return { ok: true, platform: "win32", details };
}

function windowsAclBatch(targets, operation, deps, expectedKind = null) {
  if (targets.length === 0) return [];
  const result = deps.spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& { ${WINDOWS_ACL_BATCH_SCRIPT} }`,
    ],
    {
      encoding: "utf8",
      input: JSON.stringify({
        operation,
        targets,
        ...(expectedKind ? { expectedKind } : {}),
      }),
      windowsHide: true,
      timeout: _resolveWindowsAclTimeout(30_000),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  let details = [];
  try {
    const parsed = JSON.parse(String(result?.stdout || "").trim());
    details = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    details = [];
  }
  const anyFailed = details.some((entry) => entry?.ok !== true);
  const statusOk = result?.status === 0 || (result?.status === 4 && anyFailed);
  const uniqueDetailTargets = new Set(details.map((entry) => entry?.target));
  if (
    result?.error ||
    !statusOk ||
    details.length !== targets.length ||
    uniqueDetailTargets.size !== targets.length
  ) {
    const error =
      result?.error?.message ||
      String(result?.stderr || "").trim() ||
      "owner-only ACL batch verification failed";
    return targets.map((target) => ({
      target,
      ok: false,
      platform: "win32",
      error,
    }));
  }
  const byTarget = new Map(details.map((entry) => [entry.target, entry]));
  return targets.map((target) => {
    const entry = byTarget.get(target);
    return {
      target,
      exists: entry?.exists !== false,
      ok: entry?.ok === true,
      platform: "win32",
      details: entry || null,
      ...(entry?.errorCode ? { errorCode: entry.errorCode } : {}),
      ...(entry?.ok === true
        ? {}
        : {
            error:
              entry?.error ||
              String(result?.stderr || "").trim() ||
              `owner-only ACL batch verification exited ${result?.status}`,
          }),
    };
  });
}

function isWindowsPathStatUnreliable(error, platform) {
  return (
    platform === "win32" &&
    (error?.code === "EPERM" ||
      error?.code === "EACCES" ||
      error?.code === "ENOENT" ||
      error?.code === "WINDOWS_PATH_STAT_UNRELIABLE")
  );
}

function preflightWindowsPaths(targets, deps) {
  const results = [];
  for (
    let offset = 0;
    offset < targets.length;
    offset += WINDOWS_ACL_BATCH_SIZE
  ) {
    results.push(
      ...windowsAclBatch(
        targets.slice(offset, offset + WINDOWS_ACL_BATCH_SIZE),
        "preflight",
        deps,
      ),
    );
  }
  const failed = results.find((entry) => entry.ok !== true);
  if (failed) {
    const error = new Error(
      `Could not verify Windows path ancestors for ${failed.target}: ${failed.error || "native preflight failed"}`,
    );
    error.code = "CONFIG_HOME_UNSAFE";
    throw error;
  }
  return results;
}

function privatePathEntryFromNativeEvidence(target, nativeResult) {
  if (!nativeResult || !samePath(nativeResult.target, target, true)) {
    const unsafe = new Error(
      `Native Windows path evidence did not match requested target: ${target}`,
    );
    unsafe.code = "CONFIG_HOME_UNSAFE";
    throw unsafe;
  }
  if (nativeResult.exists === false) {
    return { exists: false, entry: null };
  }
  const isDirectory = nativeResult.details?.isDirectory;
  if (typeof isDirectory !== "boolean") {
    const unsafe = new Error(
      `Could not classify Windows path type after native preflight: ${target}`,
    );
    unsafe.code = "CONFIG_HOME_UNSAFE";
    throw unsafe;
  }
  return {
    exists: true,
    entry: {
      isDirectory: () => isDirectory,
      isSymbolicLink: () => false,
    },
  };
}

function readPrivatePathEntry(target, deps, platform, nativeEvidence = null) {
  if (platform === "win32" && nativeEvidence) {
    return privatePathEntryFromNativeEvidence(target, nativeEvidence);
  }
  try {
    return { exists: true, entry: deps.fs.lstatSync(target) };
  } catch (error) {
    if (platform !== "win32") {
      if (error?.code === "ENOENT") return { exists: false, entry: null };
      throw error;
    }
    if (!isWindowsPathStatUnreliable(error, platform)) throw error;
    const directoryEntry = readWindowsDirectoryEntry(target, deps.fs);
    if (directoryEntry) {
      return {
        exists: true,
        entry: {
          isDirectory: () => directoryEntry.isDirectory,
          isSymbolicLink: () => directoryEntry.isSymbolicLink,
        },
      };
    }
    const [nativeResult] = preflightWindowsPaths([String(target)], deps);
    return privatePathEntryFromNativeEvidence(target, nativeResult);
  }
}

function assertNoLinkTraversalWithWindowsFallback(
  target,
  deps,
  checkedPaths,
  platform,
) {
  try {
    assertNoLinkTraversal(target, deps.fs, checkedPaths, platform);
    return null;
  } catch (error) {
    if (!isWindowsPathStatUnreliable(error, platform)) throw error;
    return preflightWindowsPaths([String(target)], deps)[0];
  }
}

export function inspectPrivatePaths(targets, options = {}) {
  const uniqueTargets = [...new Set((targets || []).map(String))];
  const deps = { ..._deps, ...(options.deps || {}) };
  if ((options.platform || deps.platform()) === "win32") {
    const results = [];
    for (
      let offset = 0;
      offset < uniqueTargets.length;
      offset += WINDOWS_ACL_BATCH_SIZE
    ) {
      results.push(
        ...windowsAclBatch(
          uniqueTargets.slice(offset, offset + WINDOWS_ACL_BATCH_SIZE),
          "inspect",
          deps,
        ),
      );
    }
    return results;
  }
  return uniqueTargets.map((target) => ({
    target,
    ...inspectPrivatePath(target, { ...options, deps }),
  }));
}

export function repairPrivatePaths(targets, options = {}) {
  const uniqueTargets = [...new Set((targets || []).map(String))];
  const deps = { ..._deps, ...(options.deps || {}) };
  const platform = options.platform || deps.platform();
  const checkedPaths = new Set();
  let nativeWindowsPreflightRequired = false;
  // Complete every path-safety check before starting a batched mutation. This
  // prevents a linked trust root from failing only after a descendant changed.
  for (const target of uniqueTargets) {
    assertSafeOwnerOnlyPath(target, platform);
  }
  for (const target of uniqueTargets) {
    try {
      assertNoLinkTraversal(target, deps.fs, checkedPaths, platform);
    } catch (error) {
      if (!isWindowsPathStatUnreliable(error, platform)) throw error;
      nativeWindowsPreflightRequired = true;
      break;
    }
  }
  if (nativeWindowsPreflightRequired) {
    preflightWindowsPaths(uniqueTargets, deps);
  }
  if (platform === "win32") {
    const results = [];
    for (
      let offset = 0;
      offset < uniqueTargets.length;
      offset += WINDOWS_ACL_BATCH_SIZE
    ) {
      results.push(
        ...windowsAclBatch(
          uniqueTargets.slice(offset, offset + WINDOWS_ACL_BATCH_SIZE),
          "repair",
          deps,
        ),
      );
    }
    const failed = results.filter(
      (entry) => !entry.ok && entry.exists !== false,
    );
    if (failed.length > 0) {
      throw new Error(
        `Could not repair owner-only ACL for ${failed[0].target}: ${failed[0].error}`,
      );
    }
    if (!options.deps) {
      for (const result of results) {
        if (result.ok && result.exists !== false) {
          securedWindowsPaths.add(result.target);
        }
      }
    }
    return results;
  }
  return uniqueTargets.map((target) => {
    try {
      return {
        target,
        ...repairPrivatePathAfterPreflight(target, options, deps),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { target, ok: true, exists: false, skipped: true };
      }
      throw error;
    }
  });
}

export function inspectPrivatePath(target, options = {}) {
  const deps = { ..._deps, ...(options.deps || {}) };
  const platform = options.platform || deps.platform();
  if (platform === "win32") {
    return windowsAclBatch([String(target)], "inspect", deps)[0];
  }
  let stat;
  try {
    stat = deps.fs.lstatSync(target);
  } catch (error) {
    return { ok: false, exists: false, error: error.message };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, exists: true, error: "symbolic links are not allowed" };
  }
  const expected = stat.isDirectory()
    ? PRIVATE_DIRECTORY_MODE
    : PRIVATE_FILE_MODE;
  const actual = stat.mode & 0o777;
  const ownerOk =
    typeof process.getuid !== "function" || stat.uid === process.getuid();
  return {
    ok: actual === expected && ownerOk,
    exists: true,
    platform: options.platform || deps.platform(),
    expectedMode: expected,
    actualMode: actual,
    ownerOk,
  };
}

export function repairPrivatePath(target, options = {}) {
  const deps = { ..._deps, ...(options.deps || {}) };
  const platform = options.platform || deps.platform();
  assertSafeOwnerOnlyPath(target, platform);
  assertNoLinkTraversalWithWindowsFallback(target, deps, null, platform);
  return repairPrivatePathAfterPreflight(target, options, deps);
}

function repairPrivatePathAfterPreflight(target, options, deps) {
  if ((options.platform || deps.platform()) === "win32") {
    const result = windowsAcl(target, "repair", deps);
    if (!result.ok)
      throw new Error(result.error || "owner-only ACL repair failed");
    if (!options.deps) securedWindowsPaths.add(target);
    return result;
  }
  const stat = deps.fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Refusing to change permissions through a symbolic link: ${target}`,
    );
  }
  deps.fs.chmodSync(
    target,
    stat.isDirectory() ? PRIVATE_DIRECTORY_MODE : PRIVATE_FILE_MODE,
  );
  const result = inspectPrivatePath(target, { ...options, deps });
  if (!result.ok)
    throw new Error(`Could not verify owner-only permissions: ${target}`);
  return result;
}

export function ensurePrivateDirectory(target, options = {}) {
  const deps = { ..._deps, ...(options.deps || {}) };
  const platform = options.platform || deps.platform();
  assertSafeOwnerOnlyPath(target, platform);
  const nativeEvidence = assertNoLinkTraversalWithWindowsFallback(
    target,
    deps,
    null,
    platform,
  );
  let existed = deps.fs.existsSync(target);
  let existingMode = null;
  if (existed) {
    const pathEntry = readPrivatePathEntry(
      target,
      deps,
      platform,
      nativeEvidence,
    );
    existed = pathEntry.exists;
    const existing = pathEntry.entry;
    existingMode = existing ? Number(existing.mode) : null;
    if (existed && existing.isSymbolicLink()) {
      throw new Error(
        `Refusing owner-only directory through a symbolic link: ${target}`,
      );
    }
    if (
      existed &&
      typeof existing.isDirectory === "function" &&
      !existing.isDirectory()
    ) {
      throw new Error(`Expected a directory for owner-only storage: ${target}`);
    }
  }
  deps.fs.mkdirSync(target, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  if ((options.platform || deps.platform()) !== "win32") {
    // chmod updates ctime even when the mode is already correct. Session and
    // security stores use ctime as part of their physical witness, so avoid
    // invalidating an otherwise unchanged owner-only directory.
    if (
      !existed ||
      !Number.isFinite(existingMode) ||
      (existingMode & 0o7777) !== PRIVATE_DIRECTORY_MODE
    ) {
      deps.fs.chmodSync(target, PRIVATE_DIRECTORY_MODE);
    }
  } else if (
    options.applyWindowsAcl === true ||
    (!existed && options.applyWindowsAcl !== false)
  ) {
    const result = repairWindowsAclOnce(target, deps, options);
    if (!result.ok && options.failIfUnavailable) {
      throw new Error(result.error || `Could not secure ${target}`);
    }
  }
  return target;
}

export function ensurePrivateFile(target, options = {}) {
  const deps = { ..._deps, ...(options.deps || {}) };
  const platform = options.platform || deps.platform();
  assertSafeOwnerOnlyPath(target, platform);
  const nativeEvidence = assertNoLinkTraversalWithWindowsFallback(
    target,
    deps,
    null,
    platform,
  );
  const pathEntry = readPrivatePathEntry(
    target,
    deps,
    platform,
    nativeEvidence,
  );
  if (!pathEntry.exists) return target;
  const existing = pathEntry.entry;
  if (existing.isSymbolicLink()) {
    throw new Error(
      `Refusing owner-only file through a symbolic link: ${target}`,
    );
  }
  if (typeof existing.isDirectory === "function" && existing.isDirectory()) {
    throw new Error(`Expected a file for owner-only storage: ${target}`);
  }
  if (platform !== "win32") {
    // Preserve ctime for an already-secure file. Rejected CAS writes and
    // read-only preflights must not make a persisted physical witness stale.
    const existingMode = Number(existing.mode);
    if (
      !Number.isFinite(existingMode) ||
      (existingMode & 0o7777) !== PRIVATE_FILE_MODE
    ) {
      deps.fs.chmodSync(target, PRIVATE_FILE_MODE);
    }
  } else if (
    options.applyWindowsAcl === true &&
    (options.deps || !securedWindowsPaths.has(target))
  ) {
    const [result] = windowsAclBatch([String(target)], "repair", deps, "file");
    if (result.errorCode === "EXPECTED_KIND_MISMATCH") {
      throw new Error(`Expected a file for owner-only storage: ${target}`);
    }
    if (!result.ok && result.exists !== false && options.failIfUnavailable) {
      throw new Error(result.error || `Could not secure ${target}`);
    }
    if (result.ok && !options.deps) securedWindowsPaths.add(target);
  }
  return target;
}
