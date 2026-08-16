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
 * closed. The default filesystem publishes a fully populated, uniquely staged
 * directory in one rename so a process killed during acquisition cannot expose
 * an ownerless lock. Confirmed-dead owners are reclaimed with an exact-token
 * marker inside the lock directory so a delayed contender cannot delete a
 * replacement lock. Strict callers may use bounded jittered retries and an
 * after-release yield to avoid Windows sharing transients and fixed-interval
 * lock convoys.
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
    maxRetryMs = Math.max(retryMs, 100),
    retryJitterMs = retryMs,
    yieldAfterReleaseMs = 0,
    _fs = defaultFs,
    _now = () => Date.now(),
    _sleep = sleepSync,
    _random = Math.random,
    _isProcessAlive = isProcessAlive,
    _ownerToken = () => randomUUID(),
    failIfUnavailable = false,
  } = opts;
  const isOwnerAlive =
    typeof opts._isOwnerAlive === "function"
      ? opts._isOwnerAlive
      : (candidate) => _isProcessAlive(candidate.pid);

  const lockDir = `${targetPath}.lock`;
  const ownerPath = path.join(lockDir, "owner.json");
  const owner = {
    pid: process.pid,
    startedAt: _now(),
    token: _ownerToken(),
  };
  let held = false;
  let acquisitionError = null;
  let retryAttempt = 0;
  const deadline = _now() + timeoutMs;

  for (;;) {
    try {
      acquireOwnedDirectory(_fs, lockDir, owner);
      held = true;
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        acquisitionError = error;
        if (
          failIfUnavailable &&
          isTransientLockError(error) &&
          waitForRetry({
            _now,
            _sleep,
            _random,
            deadline,
            retryAttempt: retryAttempt++,
            retryMs,
            maxRetryMs,
            retryJitterMs,
          })
        ) {
          continue;
        }
        break;
      }

      const ownerRead = readOwnerResult(_fs, ownerPath);
      const incumbent = ownerRead.owner;
      acquisitionError = ownerRead.error;
      if (incumbent) {
        if (!isOwnerAlive(incumbent)) {
          if (reclaimOwnedDirectory(_fs, lockDir, incumbent, isOwnerAlive)) {
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
      if (
        !waitForRetry({
          _now,
          _sleep,
          _random,
          deadline,
          retryAttempt: retryAttempt++,
          retryMs,
          maxRetryMs,
          retryJitterMs,
        })
      ) {
        break;
      }
    }
  }

  if (!held && failIfUnavailable) {
    const error = new Error(
      `Could not acquire state lock: ${targetPath}`,
      acquisitionError ? { cause: acquisitionError } : undefined,
    );
    error.code = "STATE_LOCK_UNAVAILABLE";
    error.attempts = retryAttempt + 1;
    throw error;
  }

  let bodyError = null;
  let bodyThrew = false;
  let result;
  try {
    result = fn({ locked: held });
  } catch (error) {
    bodyThrew = true;
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
  if (bodyThrew) throw bodyError;
  if (failIfUnavailable && !released) {
    const error =
      releaseError ||
      new Error(`Lost state lock ownership before release: ${targetPath}`);
    if (!error.code) error.code = "STATE_LOCK_OWNERSHIP_LOST";
    throw error;
  }
  if (held && released && yieldAfterReleaseMs > 0) {
    // The lock is already gone. This lets an existing waiter run before a
    // process performing many tiny transactions can immediately reacquire it.
    _sleep(yieldAfterReleaseMs);
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
  renameSync: (from, to) => fs.renameSync(from, to),
  rmSync: (p, o) => fs.rmSync(p, o),
};

function acquireOwnedDirectory(_fs, lockDir, owner) {
  const serializedOwner = JSON.stringify(owner);
  // Injected legacy filesystems used by a few consumers may not implement
  // rename. Keep their old acquire path, while the real Node filesystem always
  // uses the crash-safe staged publication below.
  if (typeof _fs.renameSync !== "function") {
    _fs.mkdirSync(lockDir);
    try {
      _fs.writeFileSync(path.join(lockDir, "owner.json"), serializedOwner, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return;
    } catch (error) {
      _fs.rmSync(lockDir, { recursive: true, force: true });
      throw error;
    }
  }

  const candidateDir = `${lockDir}.acquire-${owner.token}`;
  try {
    _fs.mkdirSync(candidateDir);
    _fs.writeFileSync(path.join(candidateDir, "owner.json"), serializedOwner, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    _fs.renameSync(candidateDir, lockDir);
  } catch (error) {
    try {
      _fs.rmSync(candidateDir, { recursive: true, force: true });
    } catch {
      /* uniquely-tokened acquisition debris cannot block the lock path */
    }
    if (directoryExists(_fs, lockDir)) {
      const contention = new Error("State lock already exists", {
        cause: error,
      });
      contention.code = "EEXIST";
      throw contention;
    }
    throw error;
  }
}

function directoryExists(_fs, target) {
  try {
    _fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const TRANSIENT_LOCK_ERROR_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ENOTEMPTY",
  "EPERM",
]);

function isTransientLockError(error) {
  return !!error && TRANSIENT_LOCK_ERROR_CODES.has(error.code);
}

function waitForRetry({
  _now,
  _sleep,
  _random,
  deadline,
  retryAttempt,
  retryMs,
  maxRetryMs,
  retryJitterMs,
}) {
  const remaining = deadline - _now();
  if (remaining <= 0) return false;

  const base = Math.max(1, Number(retryMs) || 1);
  const maximum = Math.max(base, Number(maxRetryMs) || base);
  const exponent = Math.min(Math.max(0, retryAttempt), 8);
  const exponential = Math.min(maximum, base * 2 ** exponent);
  const jitterLimit = Math.max(0, Number(retryJitterMs) || 0);
  const sample = Number(_random());
  const jitter =
    jitterLimit > 0 && Number.isFinite(sample)
      ? Math.floor(Math.min(1, Math.max(0, sample)) * jitterLimit)
      : 0;
  _sleep(Math.min(remaining, exponential + jitter));
  return true;
}

function readOwner(_fs, ownerPath) {
  return readOwnerResult(_fs, ownerPath).owner;
}

function readOwnerResult(_fs, ownerPath) {
  let owner;
  try {
    owner = JSON.parse(_fs.readFileSync(ownerPath, "utf8"));
  } catch (cause) {
    if (cause?.code) return { owner: null, error: cause };
    const error = new Error("State lock owner metadata is corrupt", { cause });
    error.code = "STATE_LOCK_OWNER_CORRUPT";
    return { owner: null, error };
  }
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
    const error = new Error("State lock owner metadata is corrupt");
    error.code = "STATE_LOCK_OWNER_CORRUPT";
    return { owner: null, error };
  }
  return { owner, error: null };
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

function reclaimOwnedDirectory(_fs, lockDir, owner, ownerAlive) {
  const markerPath = path.join(lockDir, `.reclaim-${owner.token}`);
  try {
    writeOwnerMarker(_fs, markerPath, owner);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
  const current = readOwner(_fs, path.join(lockDir, "owner.json"));
  if (!sameOwner(current, owner) || ownerAlive(owner)) {
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
  // Atomically move the exact owned directory out of the acquisition path,
  // then remove that uniquely-tokened directory. A replacement owner may
  // create `lockDir` immediately after the rename and can never be deleted by
  // this delayed releaser. Injected filesystems without rename support retain
  // the conservative marker protocol below.
  if (typeof _fs.renameSync === "function") {
    const releasedDir = `${lockDir}.release-${owner.token}`;
    try {
      _fs.renameSync(lockDir, releasedDir);
      try {
        _fs.rmSync(releasedDir, { recursive: true, force: true });
      } catch {
        // The acquisition path is already free. This uniquely named release
        // directory is harmless cache debris if cleanup is interrupted.
      }
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      // Windows sharing transients fall back to the marker-based release.
    }
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
