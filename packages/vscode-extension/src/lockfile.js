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

const WINDOWS_APPLY_ACL_SCRIPT = String.raw`
param([string]$target)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $target -Force
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$grant = "\${account}:F"
if ($item.PSIsContainer) {
  $grant = "\${account}:(OI)(CI)F"
}
& icacls $target /inheritance:r /grant:r $grant | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "icacls exited with status $LASTEXITCODE"
}
`;

const WINDOWS_INSPECT_ACL_SCRIPT = String.raw`
param([string]$target)
$ErrorActionPreference = 'Stop'
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = Get-Acl -LiteralPath $target
$owner = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
  [System.Security.Principal.SecurityIdentifier]
).Value
$rules = @($acl.Access)
$ownerOnly = $acl.AreAccessRulesProtected -and
  $owner -eq $currentSid -and $rules.Count -eq 1
if ($ownerOnly) {
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Translate(
      [System.Security.Principal.SecurityIdentifier]
    ).Value
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
    throw new Error(`could not parse final Windows ACL: ${e.message}`);
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

function _enforceOwnerOnly(target, mode, allowInsecurePermissions) {
  try {
    if (_deps.platform() === "win32") {
      _tightenWindowsAcl(target);
    } else {
      _deps.chmodSync(target, mode);
      _verifyPosixOwnerOnly(target, mode);
    }
    return true;
  } catch (e) {
    const detail = (e && e.message) || String(e);
    if (allowInsecurePermissions === true) {
      _warnAclOnce(`${target}: ${detail}`);
      return false;
    }
    throw new LockfileSecurityError(target, detail);
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
    _enforceOwnerOnly(dir, 0o700, allowInsecurePermissions);

    // Publish atomically. The temporary token file is owner-only before it
    // becomes discoverable, and the destination is verified again after rename
    // because replacement semantics can retain a destination ACL on Windows.
    fs.writeFileSync(tmp, JSON.stringify(lock, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    _enforceOwnerOnly(tmp, 0o600, allowInsecurePermissions);
    fs.renameSync(tmp, file);
    _enforceOwnerOnly(file, 0o600, allowInsecurePermissions);
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
    let lock = null;
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
  removeLock,
  pruneStaleLocks,
  loadLockfileSecurityPolicy,
  managedSettingsPath,
  LockfileSecurityError,
  MANAGED_POLICY_KEY,
  _deps,
  _tightenWindowsAcl,
  _inspectWindowsAcl,
  _verifyPosixOwnerOnly,
  _aclWarnState,
};
