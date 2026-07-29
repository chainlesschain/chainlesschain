/**
 * Cross-process advisory lock around a state file.
 *
 * Multiple `cc` processes (and, for some dirs, the desktop app) can do
 * read-modify-write on the same JSON state file. An atomic temp+rename makes
 * each write crash-safe but does NOT prevent a lost update: A reads, B reads, A
 * writes, B writes → A's change is gone. This serializes the whole
 * read-mutate-write across processes using a lock DIRECTORY — `mkdir` is
 * atomic-exclusive on POSIX and Windows, so exactly one process holds it.
 *
 * By default this remains best-effort: if the lock cannot be acquired within
 * `timeoutMs`, it proceeds unlocked. Callers that set `failIfUnavailable` get a
 * strict lock: every owner has a PID + unguessable token, a live owner is never
 * reclaimed merely because the directory is old, and corrupt ownership fails
 * closed. Confirmed-dead owners are reclaimed with an exact-token marker inside
 * the lock directory so a delayed contender cannot delete a replacement lock.
 *
 * @param {string} targetPath  the file being guarded (lock is `${targetPath}.lock`)
 * @param {(ctx:{locked:boolean})=>T} fn  critical section; receives whether the lock was held
 * @returns {T} whatever `fn` returns
 */
export function withFileLock(targetPath, fn, opts = {}) {
  const {
    timeoutMs = 2000,
    staleMs = 30000,
    retryMs = 25,
    _fs = defaultFs,
    _now = () => Date.now(),
    _sleep = sleepSync,
    _isProcessAlive = isProcessAlive,
    _ownerToken = () => randomUUID(),
    failIfUnavailable = false,
  } = opts;

  const lockDir = `${targetPath}.lock`;
  const ownerPath = path.join(lockDir, "owner.json");
  const owner = {
    pid: process.pid,
    startedAt: _now(),
    token: _ownerToken(),
  };
  let held = false;
  const deadline = _now() + timeoutMs;

  for (;;) {
    try {
      _fs.mkdirSync(lockDir);
      try {
        _fs.writeFileSync(ownerPath, JSON.stringify(owner), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        held = true;
        break;
      } catch (error) {
        _fs.rmSync(lockDir, { recursive: true, force: true });
        if (failIfUnavailable) throw error;
        break;
      }
    } catch (err) {
      if (!err || err.code !== "EEXIST") break; // unexpected fs error → run unlocked

      const incumbent = readOwner(_fs, ownerPath);
      if (incumbent) {
        if (!_isProcessAlive(incumbent.pid)) {
          if (reclaimOwnedDirectory(_fs, lockDir, incumbent, _isProcessAlive)) {
            continue;
          }
        }
      } else if (!failIfUnavailable) {
        // Compatibility for legacy best-effort locks that predate owner.json.
        // Strict locks never infer death from mtime alone.
        try {
          const stat = _fs.statSync(lockDir);
          const age = _now() - stat.mtimeMs;
          if (age > staleMs) {
            if (reclaimLegacyDirectory(_fs, lockDir, stat)) continue;
          }
        } catch {
          /* stat lost a race with the holder releasing — retry/wait below */
        }
      }
      if (_now() >= deadline) break; // timed out → run unlocked (best-effort)
      _sleep(retryMs);
    }
  }

  if (!held && failIfUnavailable) {
    const error = new Error(`Could not acquire state lock: ${targetPath}`);
    error.code = "STATE_LOCK_UNAVAILABLE";
    throw error;
  }

  let bodyError = null;
  let result;
  try {
    result = fn({ locked: held });
  } catch (error) {
    bodyError = error;
  }
  let released = !held;
  let releaseError = null;
  if (held) {
    try {
      released = releaseOwnedDirectory(_fs, lockDir, owner);
    } catch (error) {
      releaseError = error;
    }
  }
  if (bodyError) throw bodyError;
  if (failIfUnavailable && !released) {
    const error =
      releaseError ||
      new Error(`Lost state lock ownership before release: ${targetPath}`);
    if (!error.code) error.code = "STATE_LOCK_OWNERSHIP_LOST";
    throw error;
  }
  return result;
}

import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const defaultFs = {
  mkdirSync: (p) => fs.mkdirSync(p),
  statSync: (p) => fs.statSync(p),
  readFileSync: (p, o) => fs.readFileSync(p, o),
  writeFileSync: (p, value, o) => fs.writeFileSync(p, value, o),
  rmSync: (p, o) => fs.rmSync(p, o),
};

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwner(_fs, ownerPath) {
  try {
    const owner = JSON.parse(_fs.readFileSync(ownerPath, "utf8"));
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      !Number.isFinite(owner.startedAt) ||
      typeof owner.token !== "string" ||
      !/^[a-zA-Z0-9-]{16,128}$/.test(owner.token)
    ) {
      return null;
    }
    return owner;
  } catch {
    return null;
  }
}

function sameOwner(left, right) {
  return !!(
    left &&
    right &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.token === right.token
  );
}

function removeOwnMarker(_fs, markerPath, owner) {
  const marker = readOwner(_fs, markerPath);
  if (!sameOwner(marker, owner)) return false;
  try {
    _fs.rmSync(markerPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function writeOwnerMarker(_fs, markerPath, owner) {
  _fs.writeFileSync(markerPath, JSON.stringify(owner), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function reclaimOwnedDirectory(_fs, lockDir, owner, processAlive) {
  const markerPath = path.join(lockDir, `.reclaim-${owner.token}`);
  try {
    writeOwnerMarker(_fs, markerPath, owner);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
  const current = readOwner(_fs, path.join(lockDir, "owner.json"));
  if (!sameOwner(current, owner) || processAlive(owner.pid)) {
    removeOwnMarker(_fs, markerPath, owner);
    return false;
  }
  _fs.rmSync(lockDir, { recursive: true, force: true });
  return true;
}

function reclaimLegacyDirectory(_fs, lockDir, stat) {
  const identity = {
    pid: 1,
    startedAt: Number(stat.mtimeMs) || 0,
    token: `legacy-${Math.trunc(Number(stat.mtimeMs) || 0)}-state-lock`,
  };
  const markerPath = path.join(lockDir, `.reclaim-${identity.token}`);
  try {
    writeOwnerMarker(_fs, markerPath, identity);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
  if (readOwner(_fs, path.join(lockDir, "owner.json"))) {
    removeOwnMarker(_fs, markerPath, identity);
    return false;
  }
  _fs.rmSync(lockDir, { recursive: true, force: true });
  return true;
}

function releaseOwnedDirectory(_fs, lockDir, owner) {
  if (!sameOwner(readOwner(_fs, path.join(lockDir, "owner.json")), owner)) {
    return false;
  }
  const markerPath = path.join(lockDir, `.release-${owner.token}`);
  try {
    writeOwnerMarker(_fs, markerPath, owner);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
  if (!sameOwner(readOwner(_fs, path.join(lockDir, "owner.json")), owner)) {
    removeOwnMarker(_fs, markerPath, owner);
    return false;
  }
  _fs.rmSync(lockDir, { recursive: true, force: true });
  return true;
}

/** Synchronous sleep that doesn't busy-spin the CPU when possible. */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms; // SharedArrayBuffer unavailable — bounded spin
    while (Date.now() < end) {
      /* spin */
    }
  }
}
