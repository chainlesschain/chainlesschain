/**
 * IDE bridge lockfile writer: the editor side of the discovery protocol that
 * the CLI's `src/lib/ide-bridge.js` reads.
 *
 * Writes ~/.chainlesschain/ide/<port>.json advertising a localhost MCP server
 * and a per-instance bearer token. Publishing is atomic and permissions are
 * fail-closed by default: POSIX mode or the Windows DACL must be applied and
 * independently verified before the bridge may remain running.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const _deps = {
  homedir: () => os.homedir(),
  now: () => Date.now(),
  // signal-0 existence probe (overridable in tests). Throws ESRCH for a dead
  // pid, EPERM for a live one we don't own.
  kill: (pid, sig) => process.kill(pid, sig),
  platform: () => process.platform,
  env: () => process.env,
  spawn: (cmd, args, opts) => require("child_process").spawn(cmd, args, opts),
  spawnSync: (cmd, args, opts) =>
    require("child_process").spawnSync(cmd, args, opts),
  chmodSync: (target, mode) => fs.chmodSync(target, mode),
  lstatSync: (target) => fs.lstatSync(target),
  getuid: () =>
    typeof process.getuid === "function" ? process.getuid() : undefined,
};

const MANAGED_POLICY_KEY = "allowInsecureLockfilePermissions";

// Warn at most once per session when an administrator explicitly allows the
// bridge to run without verified owner-only lockfile permissions.
const _aclWarnState = { warned: false };

function _warnAclOnce(detail) {
  if (_aclWarnState.warned) return;
  _aclWarnState.warned = true;
  try {
    console.warn(
      `[chainlesschain-ide] managed policy permits an insecure IDE bridge ` +
        `lockfile after owner-only permission verification failed: ${detail}`,
    );
  } catch {
    /* best-effort */
  }
}

class LockfileSecurityError extends Error {
  constructor(target, detail) {
    super(
      `refusing to publish IDE bridge token: owner-only permissions could ` +
        `not be verified for ${target} (${detail})`,
    );
    this.name = "LockfileSecurityError";
    this.code = "CC_IDE_LOCKFILE_INSECURE";
    this.target = target;
  }
}

/**
 * Canonical organization-controlled settings file, matching the CLI's managed
 * settings layer. Deliberately no user/workspace setting can enable the
 * downgrade.
 */
function managedSettingsPath() {
  if (_deps.platform() === "win32") {
    const env = _deps.env();
    const base = env.ProgramData || env.PROGRAMDATA || "C:\\ProgramData";
    return path.join(base, "ChainlessChain", "managed-settings.json");
  }
  return "/etc/chainlesschain/managed-settings.json";
}

/**
 * Read the only supported insecure-permission downgrade. A malformed managed
 * file is an error, so callers stop the bridge instead of silently ignoring an
 * administrator's security policy.
 */
function loadLockfileSecurityPolicy(file = managedSettingsPath()) {
  if (!fs.existsSync(file)) {
    return { allowInsecurePermissions: false, managedFile: null };
  }
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    const err = new Error(
      `managed settings are unreadable or malformed: ${file} ` +
        `(${e && e.message ? e.message : e})`,
    );
    err.code = "CC_MANAGED_SETTINGS_INVALID";
    throw err;
  }
  const bridge =
    settings && typeof settings.ideBridge === "object"
      ? settings.ideBridge
      : {};
  return {
    allowInsecurePermissions: bridge[MANAGED_POLICY_KEY] === true,
    managedFile: file,
  };
}

// Read only the owner and access-control portions through .NET. Using Get-Acl
// would make bridge startup depend on Microsoft.PowerShell.Security module
// autoloading, which is not guaranteed in isolated VS Code Extension Host
// profiles (including GitHub-hosted Windows runners).
const WINDOWS_READ_ACL_FUNCTION = String.raw`
function Read-OwnerAccessAcl([string]$target) {
  $sections =
    [System.Security.AccessControl.AccessControlSections]::Access -bor
    [System.Security.AccessControl.AccessControlSections]::Owner
  if ([System.IO.Directory]::Exists($target)) {
    return [System.Security.AccessControl.DirectorySecurity]::new(
      $target,
      $sections
    )
  }
  if ([System.IO.File]::Exists($target)) {
    return [System.Security.AccessControl.FileSecurity]::new(
      $target,
      $sections
    )
  }
  throw "ACL target does not exist: $target"
}
`;

// Build the DACL from an empty security descriptor instead of incrementally
// editing the inherited ACL. `icacls /grant:r` only replaces ACEs for the
// named account and can leave unrelated explicit runner/service ACEs behind.
const WINDOWS_SET_OWNER_ONLY_ACL_FUNCTION = String.raw`
${WINDOWS_READ_ACL_FUNCTION}
function Set-ExactOwnerOnlyAcl([string]$target) {
  $item = Get-Item -LiteralPath $target -Force
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $currentSid = $identity.User
  $currentAcl = Read-OwnerAccessAcl $target
  $currentOwner = $currentAcl.GetOwner(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
  if ($currentOwner -ne $currentSid.Value) {
    & icacls.exe $target /setowner $identity.Name | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "icacls /setowner exited with status $LASTEXITCODE for $target"
    }
  }

  $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $allow = [System.Security.AccessControl.AccessControlType]::Allow

  if ($item.PSIsContainer) {
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $inheritance =
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $currentSid,
      $rights,
      $inheritance,
      $propagation,
      $allow
    )
    $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule($rule) | Out-Null
    [System.IO.DirectoryInfo]::new($target).SetAccessControl($security)
  } else {
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $currentSid,
      $rights,
      [System.Security.AccessControl.InheritanceFlags]::None,
      $propagation,
      $allow
    )
    $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule($rule) | Out-Null
    [System.IO.FileInfo]::new($target).SetAccessControl($security)
  }
}
`;

const WINDOWS_APPLY_ACL_SCRIPT = String.raw`
param([string]$target)
$ErrorActionPreference = 'Stop'
${WINDOWS_SET_OWNER_ONLY_ACL_FUNCTION}
Set-ExactOwnerOnlyAcl $target
`;

const WINDOWS_INSPECT_ACL_SCRIPT = String.raw`
param([string]$target)
$ErrorActionPreference = 'Stop'
${WINDOWS_READ_ACL_FUNCTION}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = Read-OwnerAccessAcl $target
$owner = $acl.GetOwner(
  [System.Security.Principal.SecurityIdentifier]
).Value
$rules = @(
  $acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  )
)
$ownerOnly = $acl.AreAccessRulesProtected -and
  $owner -eq $currentSid -and $rules.Count -eq 1
if ($ownerOnly) {
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Value
    $hasFullControl = (
      $rule.FileSystemRights -band
      [System.Security.AccessControl.FileSystemRights]::FullControl
    ) -eq [System.Security.AccessControl.FileSystemRights]::FullControl
    if ($sid -ne $currentSid -or
        $rule.AccessControlType -ne
          [System.Security.AccessControl.AccessControlType]::Allow -or
        -not $hasFullControl -or $rule.IsInherited) {
      $ownerOnly = $false
      break
    }
  }
}
[pscustomobject]@{
  ownerOnly = [bool]$ownerOnly
  protected = [bool]$acl.AreAccessRulesProtected
  ownerSid = $owner
  currentSid = $currentSid
  aceCount = $rules.Count
} | ConvertTo-Json -Compress
if (-not $ownerOnly) { exit 4 }
`;

// Production Windows publication runs in one asynchronous PowerShell process.
// Besides avoiding repeated cold starts, keeping the full sequence in one
// process means the Extension Host event loop is never blocked while Windows
// resolves the current identity and reads back DACLs. The bearer token is sent
// through stdin (base64 inside JSON), never as a command-line argument.
const WINDOWS_PUBLISH_LOCK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
${WINDOWS_SET_OWNER_ONLY_ACL_FUNCTION}

function Set-And-VerifyOwnerOnlyAcl([string]$target) {
  Set-ExactOwnerOnlyAcl $target

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Read-OwnerAccessAcl $target
  $owner = $acl.GetOwner(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
  $rules = @(
    $acl.GetAccessRules(
      $true,
      $true,
      [System.Security.Principal.SecurityIdentifier]
    )
  )
  $ownerOnly = $acl.AreAccessRulesProtected -and
    $owner -eq $currentSid -and $rules.Count -eq 1
  if ($ownerOnly) {
    foreach ($rule in $rules) {
      $sid = $rule.IdentityReference.Value
      $hasFullControl = (
        $rule.FileSystemRights -band
        [System.Security.AccessControl.FileSystemRights]::FullControl
      ) -eq [System.Security.AccessControl.FileSystemRights]::FullControl
      if ($sid -ne $currentSid -or
          $rule.AccessControlType -ne
            [System.Security.AccessControl.AccessControlType]::Allow -or
          -not $hasFullControl -or $rule.IsInherited) {
        $ownerOnly = $false
        break
      }
    }
  }
  if (-not $ownerOnly) {
    $ruleSummary = @()
    foreach ($rule in $rules) {
      $ruleSummary += (
        $rule.IdentityReference.Value + ":" +
        $rule.AccessControlType + ":" +
        [int]$rule.FileSystemRights + ":inherited=" +
        $rule.IsInherited
      )
    }
    throw (
      "final Windows ACL is not owner-only for $target " +
      "(protected=$($acl.AreAccessRulesProtected), ownerSid=$owner, " +
      "currentSid=$currentSid, aceCount=$($rules.Count), " +
      "rules=$($ruleSummary -join ';'))"
    )
  }
}

$payload = ([Console]::In.ReadToEnd() | ConvertFrom-Json)
$dir = [string]$payload.dir
$tmp = [string]$payload.tmp
$file = [string]$payload.file

try {
  [System.IO.Directory]::CreateDirectory($dir) | Out-Null
  Set-And-VerifyOwnerOnlyAcl $dir

  $bytes = [System.Convert]::FromBase64String(
    [string]$payload.contentBase64
  )
  $stream = [System.IO.FileStream]::new(
    $tmp,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  Set-And-VerifyOwnerOnlyAcl $tmp

  if ([System.IO.File]::Exists($file)) {
    [System.IO.File]::Delete($file)
  }
  [System.IO.File]::Move($tmp, $file)
  Set-And-VerifyOwnerOnlyAcl $file

  [pscustomobject]@{
    ownerOnly = $true
    file = $file
  } | ConvertTo-Json -Compress
} catch {
  try {
    if ([System.IO.File]::Exists($tmp)) {
      [System.IO.File]::Delete($tmp)
    }
    if ([System.IO.File]::Exists($file)) {
      [System.IO.File]::Delete($file)
    }
  } catch {
    # The JavaScript caller performs another best-effort cleanup.
  }
  throw
}
`;

const WINDOWS_PUBLISH_TIMEOUT_MS = 30000;
const WINDOWS_PUBLISH_OUTPUT_LIMIT = 64 * 1024;

function _appendBounded(current, chunk) {
  if (current.length >= WINDOWS_PUBLISH_OUTPUT_LIMIT) return current;
  return (current + String(chunk || "")).slice(0, WINDOWS_PUBLISH_OUTPUT_LIMIT);
}

function _runWindowsLockPublisher(payload) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = _deps.spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `& { ${WINDOWS_PUBLISH_LOCK_SCRIPT} }`,
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      stdout = _appendBounded(stdout, chunk);
    });
    child.stderr?.on?.("data", (chunk) => {
      stderr = _appendBounded(stderr, chunk);
    });
    child.once?.("error", (error) => finish(error));
    child.once?.("close", (status, signal) => {
      if (status !== 0) {
        finish(
          new Error(
            stderr.trim() ||
              `PowerShell lockfile publisher exited with status ${status}` +
                (signal ? ` (signal ${signal})` : ""),
          ),
        );
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (!result || result.ownerOnly !== true) {
          throw new Error("publisher did not confirm owner-only permissions");
        }
        finish(null, result);
      } catch (error) {
        finish(
          new Error(
            `could not parse Windows lockfile publisher result: ${error.message}`,
          ),
        );
      }
    });
    child.stdin?.on?.("error", () => {
      // A failed child can close stdin before Node finishes writing. The child
      // close/error event carries the actionable diagnostic.
    });

    timer = setTimeout(() => {
      const error = new Error(
        `PowerShell lockfile publisher timed out after ${WINDOWS_PUBLISH_TIMEOUT_MS}ms`,
      );
      error.code = "ETIMEDOUT";
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
      finish(error);
    }, WINDOWS_PUBLISH_TIMEOUT_MS);
    timer.unref?.();

    try {
      if (!child.stdin || typeof child.stdin.end !== "function") {
        throw new Error("PowerShell lockfile publisher has no stdin");
      }
      child.stdin.end(JSON.stringify(payload), "utf8");
    } catch (error) {
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
      finish(error);
    }
  });
}

function _runWindowsAclScript(script, target) {
  const result = _deps.spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& { ${script} }`,
      target,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    },
  );
  if (!result || result.error || result.status !== 0) {
    throw new Error(
      (result && result.error && result.error.message) ||
        (result && String(result.stderr || "").trim()) ||
        `PowerShell ACL command exited with status ${result && result.status}`,
    );
  }
  return result;
}

/**
 * Read back the final Windows DACL. This is intentionally separate from the
 * mutation command so tests and diagnostics can prove effective isolation,
 * rather than trusting a successful chmod/icacls/Set-Acl exit code.
 */
function _inspectWindowsAcl(target) {
  if (_deps.platform() !== "win32") return null;
  const result = _runWindowsAclScript(WINDOWS_INSPECT_ACL_SCRIPT, target);
  try {
    return JSON.parse(String(result.stdout || "").trim());
  } catch (e) {
    throw new Error(`could not parse final Windows ACL: ${e.message}`, {
      cause: e,
    });
  }
}

/**
 * Windows owner-only DACL: remove inheritance and every existing ACE, grant
 * full control only to the process identity, then independently read back and
 * verify the effective DACL.
 */
function _tightenWindowsAcl(target) {
  if (_deps.platform() !== "win32") return false;
  _runWindowsAclScript(WINDOWS_APPLY_ACL_SCRIPT, target);
  const actual = _inspectWindowsAcl(target);
  if (!actual || actual.ownerOnly !== true) {
    throw new Error("final Windows ACL is not owner-only");
  }
  return true;
}

function _verifyPosixOwnerOnly(target, expectedMode) {
  const stat = _deps.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error("symbolic links are not allowed");
  }
  const actualMode = stat.mode & 0o777;
  if (actualMode !== expectedMode) {
    throw new Error(
      `final mode is ${actualMode.toString(8)}, expected ${expectedMode.toString(8)}`,
    );
  }
  const uid = _deps.getuid();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(`owner uid is ${stat.uid}, expected current uid ${uid}`);
  }
  return true;
}

/**
 * Enforce owner-only permissions on a lockfile path.
 * @param {string} target
 * @param {number} desiredMode
 * @param {boolean} allowInsecurePermissions
 */
function _enforceOwnerOnly(target, desiredMode, allowInsecurePermissions) {
  const isWin = _deps.platform() === "win32";
  try {
    if (isWin) {
      _tightenWindowsAcl(target);
      return true;
    } else {
      _deps.chmodSync(target, desiredMode);
      _verifyPosixOwnerOnly(target, desiredMode);
      return true;
    }
  } catch (err) {
    if (allowInsecurePermissions) {
      return false;
    }
    throw err;
  }
}

function _safeUnlink(target) {
  if (!target) return;
  try {
    fs.unlinkSync(target);
  } catch {
    /* best-effort cleanup */
  }
}

/** True if `pid` names a live process (EPERM = alive but not ours). */
function _isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    _deps.kill(pid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === "EPERM");
  }
}

function ideLockDir() {
  return path.join(_deps.homedir(), ".chainlesschain", "ide");
}

/** A fresh 256-bit hex bearer token. */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Write (or overwrite) the lockfile for a running server.
 * @param {object} o
 * @param {number} o.port
 * @param {string} o.token
 * @param {string[]} [o.workspaceFolders]
 * @param {string} [o.ide] default "vscode"
 * @param {string} [o.transport] default "http"
 * @param {string} [o.urlPath] default "/mcp"
 * @param {string} [o.url] full url (overrides host/port/urlPath)
 * @param {number} [o.pid]
 * @param {boolean} [o.allowInsecurePermissions] true only from managed policy
 * @returns {string} the lockfile path
 */
function writeLock({
  port,
  token,
  workspaceFolders = [],
  ide = "vscode",
  transport = "http",
  urlPath = "/mcp",
  url,
  pid = process.pid,
  allowInsecurePermissions = false,
}) {
  const dir = ideLockDir();
  const file = path.join(dir, `${port}.json`);
  const tmp = path.join(
    dir,
    `${port}.json.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`,
  );
  const dirExisted = fs.existsSync(dir);
  const lock = {
    ide,
    version: 1,
    transport,
    url: url || `http://127.0.0.1:${port}${urlPath}`,
    port,
    workspaceFolders,
    token,
    pid,
    started_at: _deps.now(),
  };

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // ACL enforcement is fail-closed by default. Only the organization-managed
    // downgrade may keep the bridge alive when the OS cannot prove owner-only
    // permissions. The temporary file is protected before rename as well: it
    // contains the bearer token before becoming the discoverable lockfile.
    let aclWarned = false;
    function warnSkip(reason) {
      if (!aclWarned) {
        _warnAclOnce(reason);
        aclWarned = true;
      }
    }
    function tryEnforce(p, mode) {
      const enforced = _enforceOwnerOnly(
        p,
        mode,
        allowInsecurePermissions === true,
      );
      if (!enforced) warnSkip("permission enforcement failed");
      return enforced;
    }
    tryEnforce(dir, 0o700);

    // Publish atomically. The temporary token file is owner-only before it
    // becomes discoverable, and the destination is verified again after rename
    // because replacement semantics can retain a destination ACL on Windows.
    fs.writeFileSync(tmp, JSON.stringify(lock, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    tryEnforce(tmp, 0o600);
    fs.renameSync(tmp, file);
    tryEnforce(file, 0o600);
    return file;
  } catch (e) {
    _safeUnlink(tmp);
    _safeUnlink(file);
    if (!dirExisted) {
      try {
        fs.rmdirSync(dir);
      } catch {
        /* keep a non-empty/shared directory */
      }
    }
    throw e;
  }
}

/**
 * Non-blocking production publisher. On Windows the complete sensitive write
 * and DACL verification sequence runs in one child process, so VS Code's
 * Extension Host stays responsive. POSIX keeps the small synchronous path.
 *
 * @param {object} o same options as writeLock
 * @returns {Promise<string>} the lockfile path
 */
async function writeLockAsync({
  port,
  token,
  workspaceFolders = [],
  ide = "vscode",
  transport = "http",
  urlPath = "/mcp",
  url,
  pid = process.pid,
  allowInsecurePermissions = false,
}) {
  if (_deps.platform() !== "win32") {
    return writeLock({
      port,
      token,
      workspaceFolders,
      ide,
      transport,
      urlPath,
      url,
      pid,
      allowInsecurePermissions,
    });
  }

  const dir = ideLockDir();
  const file = path.join(dir, `${port}.json`);
  const tmp = path.join(
    dir,
    `${port}.json.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`,
  );
  const dirExisted = fs.existsSync(dir);
  const lock = {
    ide,
    version: 1,
    transport,
    url: url || `http://127.0.0.1:${port}${urlPath}`,
    port,
    workspaceFolders,
    token,
    pid,
    started_at: _deps.now(),
  };
  const content = JSON.stringify(lock, null, 2);

  try {
    await _runWindowsLockPublisher({
      dir,
      tmp,
      file,
      contentBase64: Buffer.from(content, "utf8").toString("base64"),
    });
    return file;
  } catch (error) {
    _safeUnlink(tmp);
    _safeUnlink(file);

    if (allowInsecurePermissions === true) {
      _warnAclOnce(error?.message || String(error));
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(tmp, content, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        _safeUnlink(file);
        fs.renameSync(tmp, file);
        return file;
      } catch (fallbackError) {
        _safeUnlink(tmp);
        _safeUnlink(file);
        if (!dirExisted) {
          try {
            fs.rmdirSync(dir);
          } catch {
            /* keep a non-empty/shared directory */
          }
        }
        throw fallbackError;
      }
    }

    if (!dirExisted) {
      try {
        fs.rmdirSync(dir);
      } catch {
        /* keep a non-empty/shared directory */
      }
    }
    throw new LockfileSecurityError(file, error?.message || String(error));
  }
}

/** Remove the lockfile for a port. Returns true if a file was deleted. */
function removeLock(port) {
  try {
    fs.unlinkSync(path.join(ideLockDir(), `${port}.json`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove lockfiles left behind by crashed / force-killed instances. The normal
 * exit path calls removeLock, but a crash leaves the file. Atomic-write temp
 * siblings are swept as well. Never removes a lock/temp whose pid is alive.
 */
function pruneStaleLocks() {
  const dir = ideLockDir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    const isLock = name.endsWith(".json");
    const tmpMarker = name.indexOf(".json.tmp-");
    if (!isLock && tmpMarker < 0) continue;
    const file = path.join(dir, name);
    if (tmpMarker >= 0) {
      const pidText = name
        .slice(tmpMarker + ".json.tmp-".length)
        .split("-", 1)[0];
      const ownerPid = Number(pidText);
      if (_isProcessAlive(ownerPid)) continue;
      try {
        fs.unlinkSync(file);
        removed++;
      } catch {
        /* best-effort */
      }
      continue;
    }
    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      lock = null;
    }
    if (lock && _isProcessAlive(lock.pid)) continue;
    try {
      fs.unlinkSync(file);
      removed++;
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

module.exports = {
  ideLockDir,
  generateToken,
  writeLock,
  writeLockAsync,
  removeLock,
  pruneStaleLocks,
  loadLockfileSecurityPolicy,
  managedSettingsPath,
  LockfileSecurityError,
  MANAGED_POLICY_KEY,
  _deps,
  _tightenWindowsAcl,
  _inspectWindowsAcl,
  _runWindowsLockPublisher,
  _verifyPosixOwnerOnly,
  _aclWarnState,
};
