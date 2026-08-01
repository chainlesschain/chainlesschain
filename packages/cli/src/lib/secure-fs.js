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
export function assertSafeOwnerOnlyPath(target) {
  const value = String(target || "").trim();
  if (!value) throw new Error("Owner-only storage path must not be empty");
  const native = resolve(value);
  const nativeRoot = parse(native).root;
  const posixPath = posix.isAbsolute(value) ? posix.normalize(value) : null;
  const windowsPath = win32.isAbsolute(value) ? win32.normalize(value) : null;
  const isAbsolute = isNativeAbsolute(value);
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
    samePath(native, nativeRoot, process.platform === "win32") ||
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
  const caseInsensitive = ["win32", "darwin"].includes(process.platform);
  const protectedLocation = samePath(
    native,
    resolve(homedir()),
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

function assertNoLinkTraversal(target, deps = fs, checkedPaths = null) {
  const absolute = resolve(String(target));
  const root = parse(absolute).root;
  const segments = absolute
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const cacheKey =
      process.platform === "win32" ? current.toLowerCase() : current;
    if (checkedPaths?.has(cacheKey)) continue;
    let entry;
    try {
      entry = deps.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (entry.isSymbolicLink()) {
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
    throw "owner-only ACL repair refuses a path owned by another identity: $path"
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
  ownerSid = $owner
  currentSid = $sid.Value
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
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$operation = [string]$request.operation
$targets = @($request.targets)
if ($operation -ne 'inspect' -and $operation -ne 'repair') {
  throw "unsupported ACL batch operation: $operation"
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
if ($operation -eq 'repair') {
  $preflightFailures = @()
  foreach ($target in $targets) {
    try {
      Assert-CcNoReparseTraversal $target
      $candidate = Get-Item -LiteralPath $target -Force
    } catch {
      if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
        $preflightFailures += [pscustomobject]@{
          target = [string]$target
          error = $_.Exception.Message
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
        ok = $false
        error = "ACL batch preflight failed at $($firstFailure.target): $($firstFailure.error)"
      }
    })
    [Console]::Write((ConvertTo-Json -InputObject $output -Compress -Depth 4))
    exit 4
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
    throw "owner-only ACL repair refuses a path owned by another identity: $path"
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
      ok = [bool]$ownerOnly
      ownerSid = $owner
      currentSid = $sid.Value
      protected = [bool]$acl.AreAccessRulesProtected
      aceCount = $rules.Count
      error = if ($ownerOnly) { $null } else { 'path is not owner-only' }
    }
  } catch {
    [pscustomobject]@{
      target = [string]$target
      exists = [bool](($null -ne $item) -or (Test-Path -LiteralPath $target))
      ok = $false
      error = $_.Exception.Message
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
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
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

function windowsAclBatch(targets, operation, deps) {
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
      input: JSON.stringify({ operation, targets }),
      windowsHide: true,
      timeout: 30000,
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
  const checkedPaths = new Set();
  // Complete every path-safety check before starting a batched mutation. This
  // prevents a linked trust root from failing only after a descendant changed.
  for (const target of uniqueTargets) {
    assertSafeOwnerOnlyPath(target);
    assertNoLinkTraversal(target, deps.fs, checkedPaths);
  }
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
  let stat;
  try {
    stat = deps.fs.lstatSync(target);
  } catch (error) {
    return { ok: false, exists: false, error: error.message };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, exists: true, error: "symbolic links are not allowed" };
  }
  if ((options.platform || deps.platform()) === "win32") {
    return { exists: true, ...windowsAcl(target, "inspect", deps) };
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
  assertSafeOwnerOnlyPath(target);
  const deps = { ..._deps, ...(options.deps || {}) };
  assertNoLinkTraversal(target, deps.fs);
  return repairPrivatePathAfterPreflight(target, options, deps);
}

function repairPrivatePathAfterPreflight(target, options, deps) {
  const stat = deps.fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Refusing to change permissions through a symbolic link: ${target}`,
    );
  }
  if ((options.platform || deps.platform()) === "win32") {
    const result = windowsAcl(target, "repair", deps);
    if (!result.ok)
      throw new Error(result.error || "owner-only ACL repair failed");
    if (!options.deps) securedWindowsPaths.add(target);
    return result;
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
  assertSafeOwnerOnlyPath(target);
  const deps = { ..._deps, ...(options.deps || {}) };
  assertNoLinkTraversal(target, deps.fs);
  const existed = deps.fs.existsSync(target);
  if (existed) {
    const existing = deps.fs.lstatSync(target);
    if (existing.isSymbolicLink()) {
      throw new Error(
        `Refusing owner-only directory through a symbolic link: ${target}`,
      );
    }
    if (typeof existing.isDirectory === "function" && !existing.isDirectory()) {
      throw new Error(`Expected a directory for owner-only storage: ${target}`);
    }
  }
  deps.fs.mkdirSync(target, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  if ((options.platform || deps.platform()) !== "win32") {
    deps.fs.chmodSync(target, PRIVATE_DIRECTORY_MODE);
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
  assertSafeOwnerOnlyPath(target);
  const deps = { ..._deps, ...(options.deps || {}) };
  assertNoLinkTraversal(target, deps.fs);
  if (!deps.fs.existsSync(target)) return target;
  const existing = deps.fs.lstatSync(target);
  if (existing.isSymbolicLink()) {
    throw new Error(
      `Refusing owner-only file through a symbolic link: ${target}`,
    );
  }
  if (typeof existing.isDirectory === "function" && existing.isDirectory()) {
    throw new Error(`Expected a file for owner-only storage: ${target}`);
  }
  if ((options.platform || deps.platform()) !== "win32") {
    deps.fs.chmodSync(target, PRIVATE_FILE_MODE);
  } else if (options.applyWindowsAcl === true) {
    const result = repairWindowsAclOnce(target, deps, options);
    if (!result.ok && options.failIfUnavailable) {
      throw new Error(result.error || `Could not secure ${target}`);
    }
  }
  return target;
}
