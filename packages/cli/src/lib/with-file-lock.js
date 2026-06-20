/**
 * Best-effort cross-process advisory lock around a state file.
 *
 * Multiple `cc` processes (and, for some dirs, the desktop app) can do
 * read-modify-write on the same JSON state file. An atomic temp+rename makes
 * each write crash-safe but does NOT prevent a lost update: A reads, B reads, A
 * writes, B writes → A's change is gone. This serializes the whole
 * read-mutate-write across processes using a lock DIRECTORY — `mkdir` is
 * atomic-exclusive on POSIX and Windows, so exactly one process holds it.
 *
 * SAFETY — this is intentionally best-effort. If the lock can't be acquired
 * within `timeoutMs`, it PROCEEDS WITHOUT THE LOCK rather than hanging or
 * throwing: worst case degrades to the pre-lock behavior (a rare lost update),
 * never a frozen CLI. A lock left by a crashed holder is reclaimed once its
 * mtime is older than `staleMs`. The lock is always released in `finally`.
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
  } = opts;

  const lockDir = `${targetPath}.lock`;
  let held = false;
  const deadline = _now() + timeoutMs;

  for (;;) {
    try {
      _fs.mkdirSync(lockDir);
      held = true;
      break;
    } catch (err) {
      if (!err || err.code !== "EEXIST") break; // unexpected fs error → run unlocked
      // Reclaim a stale lock left by a crashed holder.
      try {
        const age = _now() - _fs.statSync(lockDir).mtimeMs;
        if (age > staleMs) {
          _fs.rmSync(lockDir, { recursive: true, force: true });
          continue; // retry acquisition immediately
        }
      } catch {
        /* stat lost a race with the holder releasing — fall through to wait */
      }
      if (_now() >= deadline) break; // timed out → run unlocked (best-effort)
      _sleep(retryMs);
    }
  }

  try {
    return fn({ locked: held });
  } finally {
    if (held) {
      try {
        _fs.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        /* best-effort release */
      }
    }
  }
}

import fs from "node:fs";
const defaultFs = {
  mkdirSync: (p) => fs.mkdirSync(p),
  statSync: (p) => fs.statSync(p),
  rmSync: (p, o) => fs.rmSync(p, o),
};

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
