/**
 * Process-lifetime exclusive ownership for a `cc team --state` file.
 *
 * Atomic snapshot writes prevent torn JSON, but they do not stop two CLI
 * processes from restoring the same leases and executing the same side effects.
 * A lock directory is held for the entire async run. A crashed owner's lock is
 * reclaimed only when its recorded PID is no longer alive; corrupt ownership
 * fails closed and requires manual adjudication.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TEAM_RUN_STATE_LOCK_ERROR = "TEAM_RUN_STATE_LOCK_UNAVAILABLE";

export const _deps = {
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === "EPERM";
    }
  },
  ownerToken: () => randomUUID(),
  writeMarker: (markerPath, owner) =>
    fs.writeFileSync(markerPath, JSON.stringify(owner), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    }),
};

function lockError(statePath, owner = null) {
  const error = new Error(
    `Team state is already owned by another process: ${statePath}`,
  );
  error.code = TEAM_RUN_STATE_LOCK_ERROR;
  if (owner?.pid) error.ownerPid = owner.pid;
  return error;
}

function readOwner(ownerPath) {
  try {
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    if (
      !owner ||
      typeof owner !== "object" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      !Number.isFinite(owner.startedAt) ||
      (owner.token !== undefined &&
        (typeof owner.token !== "string" ||
          !/^[a-zA-Z0-9-]{16,128}$/.test(owner.token)))
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
    (left.token || null) === (right.token || null)
  );
}

function ownerMarker(owner) {
  if (owner?.token) return owner.token;
  return `legacy-${owner.pid}-${Math.trunc(owner.startedAt)}`;
}

function removeOwnMarker(markerPath, owner) {
  const marker = readOwner(markerPath);
  if (!sameOwner(marker, owner)) return false;
  try {
    fs.rmSync(markerPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim deletion inside the observed lock directory, then re-check the exact
 * owner identity and liveness before removing it.
 *
 * This closes the stale-observation ABA race: if a delayed contender writes its
 * old-owner marker into a replacement lock directory, the owner re-read
 * mismatches and it removes only its own marker, never the replacement lock.
 */
function reclaimDeadLock(lockDir, owner) {
  const markerPath = path.join(lockDir, `.reclaim-${ownerMarker(owner)}`);
  try {
    _deps.writeMarker(markerPath, owner);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
  const current = readOwner(path.join(lockDir, "owner.json"));
  if (!sameOwner(current, owner) || _deps.isProcessAlive(owner.pid)) {
    removeOwnMarker(markerPath, owner);
    return false;
  }
  fs.rmSync(lockDir, { recursive: true, force: true });
  return true;
}

function canonicalStatePath(statePath) {
  const requested = path.resolve(statePath);
  const parent = fs.realpathSync.native(path.dirname(requested));
  const target = path.join(parent, path.basename(requested));
  if (fs.existsSync(target)) {
    const entry = fs.lstatSync(target);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(
        `Team state must be a regular, non-symlink file: ${target}`,
      );
    }
    if (entry.nlink > 1) {
      throw new Error(`Team state hard links are not allowed: ${target}`);
    }
    return fs.realpathSync.native(target);
  }
  return target;
}

export class TeamRunStateLock {
  constructor(statePath, lockDir, owner) {
    this.statePath = statePath;
    this.lockDir = lockDir;
    this.owner = owner;
    this._released = false;
  }

  static acquire(statePath) {
    if (typeof statePath !== "string" || statePath.trim() === "") {
      throw new TypeError("team state path is required");
    }
    const target = canonicalStatePath(statePath);
    const lockDir = `${target}.run-lock`;
    const ownerPath = path.join(lockDir, "owner.json");
    const owner = {
      pid: process.pid,
      startedAt: Date.now(),
      token: _deps.ownerToken(),
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        fs.mkdirSync(lockDir);
        try {
          fs.writeFileSync(ownerPath, JSON.stringify(owner), {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
          });
        } catch (error) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          throw error;
        }
        return new TeamRunStateLock(target, lockDir, owner);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const incumbent = readOwner(ownerPath);
        if (!incumbent) throw lockError(target);
        if (_deps.isProcessAlive(incumbent.pid)) {
          throw lockError(target, incumbent);
        }
        // Claim deletion against the exact observed dead owner. The exact-token
        // reclaim marker prevents a delayed concurrent reclaimer
        // from deleting a replacement lock created at the original path.
        reclaimDeadLock(lockDir, incumbent);
      }
    }
    throw lockError(target);
  }

  release() {
    if (this._released) return false;
    const current = readOwner(path.join(this.lockDir, "owner.json"));
    if (!sameOwner(current, this.owner)) return false;
    const markerPath = path.join(
      this.lockDir,
      `.release-${ownerMarker(this.owner)}`,
    );
    try {
      _deps.writeMarker(markerPath, this.owner);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EEXIST") throw error;
      return false;
    }
    const confirmed = readOwner(path.join(this.lockDir, "owner.json"));
    if (!sameOwner(confirmed, this.owner)) {
      removeOwnMarker(markerPath, this.owner);
      return false;
    }
    this._released = true;
    fs.rmSync(this.lockDir, { recursive: true, force: true });
    return true;
  }
}
