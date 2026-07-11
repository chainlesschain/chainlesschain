/**
 * IDE bridge lockfile writer — the editor side of the discovery protocol that
 * the CLI's `src/lib/ide-bridge.js` reads.
 *
 * Writes ~/.chainlesschain/ide/<port>.json (file 0600, dir 0700) advertising a
 * localhost MCP server + a per-instance bearer token. See
 * docs/design/modules/98_IDE桥接对标方案.md.
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
  // ACL tightening seam (overridable in tests — real ACL changes are not
  // unit-testable cross-platform).
  platform: () => process.platform,
  env: () => process.env,
  spawnSync: (cmd, args, opts) =>
    require("child_process").spawnSync(cmd, args, opts),
};

// Warn at most once per session when ACL tightening fails — the bridge must
// still start (fail-open), but a hardened setup should be diagnosable.
const _aclWarnState = { warned: false };

function _warnAclOnce(detail) {
  if (_aclWarnState.warned) return;
  _aclWarnState.warned = true;
  try {
    console.warn(
      `[chainlesschain-ide] failed to tighten lockfile ACL (token stays ` +
        `chmod-protected only, which is a no-op on Windows): ${detail}`,
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Windows: the POSIX 0600/0700 modes below are a no-op on NTFS, so the bearer
 * token in the lockfile stays readable by other local users. Tighten with an
 * explicit ACL: strip inherited entries, then grant only the current user
 * full control (`icacls <p> /inheritance:r /grant:r <user>:F` — array argv,
 * so a USERNAME with spaces is safe). Strictly fail-open: a missing or
 * failing icacls must NEVER block bridge startup.
 *
 * @returns {boolean} true when the ACL was tightened
 */
function _tightenWindowsAcl(target) {
  if (_deps.platform() !== "win32") return false;
  try {
    const user = _deps.env().USERNAME;
    if (!user) {
      _warnAclOnce("USERNAME is not set");
      return false;
    }
    const r = _deps.spawnSync(
      "icacls",
      [target, "/inheritance:r", "/grant:r", `${user}:F`],
      { stdio: "ignore", windowsHide: true, timeout: 10000 },
    );
    if (!r || r.error || r.status !== 0) {
      _warnAclOnce(
        (r && r.error && r.error.message) ||
          `icacls exited with status ${r && r.status}`,
      );
      return false;
    }
    return true;
  } catch (e) {
    _warnAclOnce((e && e.message) || String(e));
    return false;
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
 * @param {string} [o.ide]        default "vscode"
 * @param {string} [o.transport]  default "http"
 * @param {string} [o.urlPath]    default "/mcp"
 * @param {string} [o.url]        full url (overrides host/port/urlPath)
 * @param {number} [o.pid]
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
}) {
  const dir = ideLockDir();
  fs.mkdirSync(dir, { recursive: true });
  // 0700 dir / 0600 file: keep the bearer token unreadable by other local
  // users (no-op on most Windows filesystems, but correct on POSIX).
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
  _tightenWindowsAcl(dir); // chmod is a no-op on Windows — see helper
  const file = path.join(dir, `${port}.json`);
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
  fs.writeFileSync(file, JSON.stringify(lock, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort */
  }
  _tightenWindowsAcl(file); // the file carries the bearer token
  return file;
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
 * exit path calls removeLock, but a crash leaves the file — and because each run
 * binds an ephemeral port, these orphans accumulate forever in the ide dir. A
 * lock is stale when its owning process is gone (or the file is unparseable).
 * Best-effort; returns the count removed. Mirrors Claude-Code's auto-cleanup of
 * leaked registrations. Never removes a lock whose pid is still alive (so a live
 * sibling editor's bridge is preserved).
 */
function pruneStaleLocks() {
  const dir = ideLockDir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0; // dir absent → nothing to prune
  }
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      lock = null; // corrupt / unreadable → treat as stale
    }
    if (lock && _isProcessAlive(lock.pid)) continue; // owner alive → keep
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
  _deps,
  _tightenWindowsAcl,
  _aclWarnState,
};
