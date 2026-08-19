import { describe, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../../src/lib/with-file-lock.js";

// In-memory fake fs modelling the lock DIRECTORY as a single key.
function fakeLockFs() {
  const dirs = new Map(); // lockDir -> mtimeMs
  const files = new Map();
  const normalize = (p) => String(p).replaceAll("\\", "/");
  const parentDir = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
  const enoent = () => {
    const error = new Error("ENOENT");
    error.code = "ENOENT";
    return error;
  };
  return {
    dirs,
    files,
    mkdirSync: vi.fn((p) => {
      p = normalize(p);
      if (dirs.has(p)) {
        const e = new Error("EEXIST");
        e.code = "EEXIST";
        throw e;
      }
      dirs.set(p, 0);
    }),
    statSync: vi.fn((p) => {
      p = normalize(p);
      if (dirs.has(p)) return { mtimeMs: dirs.get(p) };
      if (files.has(p)) return { mtimeMs: 0 };
      throw enoent();
    }),
    readFileSync: vi.fn((p) => {
      p = normalize(p);
      if (!files.has(p)) throw enoent();
      return files.get(p);
    }),
    writeFileSync: vi.fn((p, value, options = {}) => {
      p = normalize(p);
      if (!dirs.has(parentDir(p))) throw enoent();
      if (options.flag === "wx" && files.has(p)) {
        const error = new Error("EEXIST");
        error.code = "EEXIST";
        throw error;
      }
      files.set(p, String(value));
    }),
    renameSync: vi.fn((from, to) => {
      from = normalize(from);
      to = normalize(to);
      if (!dirs.has(from)) throw enoent();
      if (dirs.has(to)) {
        const error = new Error("ENOTEMPTY");
        error.code = "ENOTEMPTY";
        throw error;
      }
      dirs.set(to, dirs.get(from));
      dirs.delete(from);
      for (const [file, value] of Array.from(files.entries())) {
        if (!file.startsWith(`${from}/`)) continue;
        files.delete(file);
        files.set(`${to}${file.slice(from.length)}`, value);
      }
    }),
    rmSync: vi.fn((p) => {
      p = normalize(p);
      if (files.delete(p)) return;
      dirs.delete(p);
      for (const key of Array.from(files.keys())) {
        if (key.startsWith(`${p}/`)) files.delete(key);
      }
    }),
  };
}

describe("withFileLock", () => {
  it("acquires the lock, runs fn (locked:true), and releases", () => {
    const _fs = fakeLockFs();
    const result = withFileLock(
      "/state.json",
      (ctx) => {
        expect(ctx.locked).toBe(true);
        expect(_fs.dirs.has("/state.json.lock")).toBe(true); // held during fn
        return "ok";
      },
      { _fs },
    );
    expect(result).toBe("ok");
    expect(_fs.dirs.has("/state.json.lock")).toBe(false); // released after
  });

  it("releases the lock even if fn throws", () => {
    const _fs = fakeLockFs();
    expect(() =>
      withFileLock(
        "/s.json",
        () => {
          throw new Error("boom");
        },
        { _fs },
      ),
    ).toThrow("boom");
    expect(_fs.dirs.has("/s.json.lock")).toBe(false);
  });

  it("publishes owner metadata atomically and leaves no lock path when staging is interrupted", () => {
    const _fs = fakeLockFs();
    const originalWrite = _fs.writeFileSync;
    let observedCandidate = null;
    _fs.writeFileSync = vi.fn((target, value, options) => {
      if (String(target).includes(".lock.acquire-")) {
        observedCandidate = String(target).replaceAll("\\", "/");
        const error = new Error("acquirer terminated before publication");
        error.code = "EIO";
        throw error;
      }
      return originalWrite(target, value, options);
    });

    expect(() =>
      withFileLock("/atomic.json", () => true, {
        _fs,
        failIfUnavailable: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "STATE_LOCK_UNAVAILABLE",
        cause: expect.objectContaining({ code: "EIO" }),
      }),
    );
    expect(observedCandidate).toContain("/atomic.json.lock.acquire-");
    expect(_fs.dirs.has("/atomic.json.lock")).toBe(false);
    expect(
      [..._fs.dirs.keys()].some((entry) =>
        entry.startsWith("/atomic.json.lock.acquire-"),
      ),
    ).toBe(false);
  });

  it("does not swallow a falsy thrown value and still releases the lock", () => {
    const _fs = fakeLockFs();
    let completed = false;
    try {
      withFileLock(
        "/falsy.json",
        () => {
          const throwValue = (value) => {
            throw value;
          };
          throwValue(undefined);
        },
        { _fs },
      );
      completed = true;
    } catch (error) {
      expect(error).toBeUndefined();
    }
    expect(completed).toBe(false);
    expect(_fs.dirs.has("/falsy.json.lock")).toBe(false);
  });

  it("serializes: a second acquire while held proceeds unlocked (no deadlock)", () => {
    const _fs = fakeLockFs();
    let now = 1000;
    let inner;
    withFileLock(
      "/s.json",
      () => {
        // Mark the held lock fresh as of `now` so the inner acquire sees it as
        // live (not stale). The inner acquire must NOT create a second lock and
        // must NOT hang — it times out and proceeds unlocked.
        _fs.dirs.set("/s.json.lock", now);
        inner = withFileLock("/s.json", (ctx) => ctx.locked, {
          _fs,
          timeoutMs: 50,
          staleMs: 30000,
          _now: () => (now += 20), // advances past the deadline; lock stays fresh
          _sleep: () => {},
        });
      },
      { _fs, _now: () => now },
    );
    expect(inner).toBe(false); // inner ran unlocked (best-effort), didn't deadlock
    expect(_fs.dirs.has("/s.json.lock")).toBe(false); // outer released
  });

  it("times out → proceeds WITHOUT the lock instead of hanging", () => {
    const _fs = fakeLockFs();
    _fs.dirs.set("/s.json.lock", 0); // someone else holds it (fresh, not stale)
    let now = 1000;
    const ran = withFileLock("/s.json", (ctx) => ctx.locked, {
      _fs,
      timeoutMs: 100,
      staleMs: 999999, // never stale
      retryMs: 10,
      _now: () => (now += 30), // advances past the deadline quickly
      _sleep: () => {},
    });
    expect(ran).toBe(false); // proceeded unlocked
    expect(_fs.dirs.has("/s.json.lock")).toBe(true); // foreign lock left intact
  });

  it("reclaims a stale lock (crashed holder) and acquires", () => {
    const _fs = fakeLockFs();
    _fs.dirs.set("/s.json.lock", 0); // stale lock, mtime=0
    let now = 100000; // far past staleMs
    const ran = withFileLock("/s.json", (ctx) => ctx.locked, {
      _fs,
      timeoutMs: 1000,
      staleMs: 30000,
      _now: () => now,
      _sleep: () => {},
    });
    expect(ran).toBe(true); // reclaimed + acquired
    expect(_fs.dirs.has("/s.json.lock")).toBe(false); // released after fn
  });

  it("runs unlocked on an unexpected fs error (never blocks the CLI)", () => {
    const _fs = fakeLockFs();
    _fs.mkdirSync = vi.fn(() => {
      const e = new Error("EACCES");
      e.code = "EACCES";
      throw e;
    });
    const ran = withFileLock("/s.json", (ctx) => ctx.locked, { _fs });
    expect(ran).toBe(false);
  });

  it("can fail closed when a critical state lock is unavailable", () => {
    const _fs = fakeLockFs();
    _fs.dirs.set("/critical.json.lock", 0);
    let now = 1000;
    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        staleMs: 999999,
        _now: () => (now += 20),
        _sleep: () => {},
        failIfUnavailable: true,
      }),
    ).toThrowError(/Could not acquire state lock/);
  });

  it("strict mode retries transient Windows filesystem errors with bounded jitter", () => {
    const _fs = fakeLockFs();
    const originalMkdir = _fs.mkdirSync;
    let attempts = 0;
    _fs.mkdirSync = vi.fn((lockDir) => {
      attempts += 1;
      if (attempts <= 2) {
        const error = new Error("transient Windows filesystem contention");
        error.code = attempts === 1 ? "EPERM" : "ENOTEMPTY";
        throw error;
      }
      return originalMkdir(lockDir);
    });
    let now = 0;
    const sleeps = [];
    const random = [0, 0.5];

    expect(
      withFileLock("/critical.json", (ctx) => ctx.locked, {
        _fs,
        timeoutMs: 100,
        retryMs: 10,
        maxRetryMs: 20,
        retryJitterMs: 10,
        _now: () => now,
        _sleep: (milliseconds) => {
          sleeps.push(milliseconds);
          now += milliseconds;
        },
        _random: () => random.shift() ?? 0,
        failIfUnavailable: true,
      }),
    ).toBe(true);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([10, 25]);
  });

  it("strict mode preserves a persistent transient filesystem cause after its deadline", () => {
    const _fs = fakeLockFs();
    _fs.mkdirSync = vi.fn(() => {
      const error = new Error("persistent Windows denial");
      error.code = "EPERM";
      throw error;
    });
    let now = 0;

    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 25,
        retryMs: 10,
        maxRetryMs: 10,
        retryJitterMs: 0,
        _now: () => now,
        _sleep: (milliseconds) => {
          now += milliseconds;
        },
        _random: () => 0,
        failIfUnavailable: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "STATE_LOCK_UNAVAILABLE",
        cause: expect.objectContaining({ code: "EPERM" }),
      }),
    );
    expect(now).toBe(25);
  });

  it("strict mode preserves transient owner-read errors and never enters unlocked", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    _fs.dirs.set(lockDir, 0);
    const originalRead = _fs.readFileSync;
    _fs.readFileSync = vi.fn((ownerPath) => {
      if (String(ownerPath).endsWith("owner.json")) {
        const error = new Error("Windows owner read is busy");
        error.code = "EBUSY";
        throw error;
      }
      return originalRead(ownerPath);
    });
    let now = 0;
    let ran = false;

    let failure;
    try {
      withFileLock(
        "/critical.json",
        () => {
          ran = true;
        },
        {
          _fs,
          timeoutMs: 20,
          retryMs: 5,
          maxRetryMs: 5,
          retryJitterMs: 0,
          _now: () => now,
          _sleep: (milliseconds) => {
            now += milliseconds;
          },
          _random: () => 0,
          failIfUnavailable: true,
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(ran).toBe(false);
    expect(failure).toMatchObject({
      code: "STATE_LOCK_UNAVAILABLE",
      cause: {
        code: "EBUSY",
      },
    });
    expect(_fs.dirs.has(lockDir)).toBe(true);
  });

  it("strict mode reports corrupt owner metadata without reclaiming it", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, "{not-json");
    let now = 0;

    let failure;
    try {
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        retryMs: 5,
        maxRetryMs: 5,
        retryJitterMs: 0,
        _now: () => now,
        _sleep: (milliseconds) => {
          now += milliseconds;
        },
        _random: () => 0,
        failIfUnavailable: true,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "STATE_LOCK_UNAVAILABLE",
      cause: {
        code: "STATE_LOCK_OWNER_CORRUPT",
      },
    });
    expect(_fs.readFileSync(`${lockDir}/owner.json`)).toBe("{not-json");
  });

  it("uses non-uniform contention backoff and yields only after releasing", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(
      `${lockDir}/owner.json`,
      JSON.stringify({
        pid: 4242,
        startedAt: 1,
        token: "contended-owner-token-0001",
      }),
    );
    let now = 0;
    let waits = 0;
    const sleeps = [];

    const result = withFileLock("/critical.json", (ctx) => ctx.locked, {
      _fs,
      timeoutMs: 200,
      retryMs: 10,
      maxRetryMs: 40,
      retryJitterMs: 10,
      yieldAfterReleaseMs: 17,
      _now: () => now,
      _sleep: (milliseconds) => {
        sleeps.push({
          milliseconds,
          held: _fs.dirs.has(lockDir),
        });
        now += milliseconds;
        waits += 1;
        if (waits === 2) {
          _fs.rmSync(lockDir, { recursive: true, force: true });
        }
      },
      _random: () => (waits === 0 ? 0 : 0.5),
      _isProcessAlive: () => true,
      failIfUnavailable: true,
    });

    expect(result).toBe(true);
    expect(sleeps.map((entry) => entry.milliseconds)).toEqual([10, 25, 17]);
    expect(sleeps.at(-1)).toEqual({ milliseconds: 17, held: false });
  });

  it("strict mode never reclaims a live owner based only on stale mtime", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(
      `${lockDir}/owner.json`,
      JSON.stringify({
        pid: 4242,
        startedAt: 1,
        token: "live-owner-token-0001",
      }),
    );
    let now = 100_000;

    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        staleMs: 1,
        _now: () => (now += 20),
        _sleep: () => {},
        _isProcessAlive: () => true,
        failIfUnavailable: true,
      }),
    ).toThrowError(/Could not acquire state lock/);
    expect(_fs.dirs.has(lockDir)).toBe(true);
  });

  it("reports bounded owner diagnostics without reclaiming a live same-pid owner", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const liveOwner = {
      pid: process.pid,
      startedAt: 1,
      token: "unknown-same-process-token-01",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(liveOwner), {
      flag: "wx",
    });
    let now = 1000;
    let failure = null;

    try {
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        staleMs: 1,
        _now: () => (now += 20),
        _sleep: () => {},
        _isProcessAlive: () => true,
        failIfUnavailable: true,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "STATE_LOCK_UNAVAILABLE",
      lockOwner: {
        pid: process.pid,
        startedAt: liveOwner.startedAt,
        alive: true,
        releasePublished: false,
      },
    });
    expect(failure.message).toContain(`owner pid=${process.pid}`);
    expect(failure.message).toContain("alive=true");
    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      liveOwner,
    );
    expect(_fs.dirs.has(lockDir)).toBe(true);
  });

  it("lets a strict caller reclaim a lock after proving the owner pid was reused", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const owner = {
      pid: 4242,
      startedAt: 1_000,
      token: "reused-owner-token-0001",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(owner));
    const isOwnerAlive = vi.fn(() => false);

    expect(
      withFileLock("/critical.json", (ctx) => ctx.locked, {
        _fs,
        _isProcessAlive: () => true,
        _isOwnerAlive: isOwnerAlive,
        failIfUnavailable: true,
      }),
    ).toBe(true);
    expect(isOwnerAlive).toHaveBeenCalledWith(owner);
    expect(_fs.dirs.has(lockDir)).toBe(false);
  });

  it("takes over a dead reclaim claimant left by a killed contender", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const owner = {
      pid: 4242,
      startedAt: 1,
      token: "dead-owner-token-0002",
    };
    const deadClaimant = {
      pid: 4343,
      startedAt: 2,
      token: "dead-claimant-token-001",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(owner));
    _fs.writeFileSync(
      `${lockDir}/.reclaim-${owner.token}`,
      JSON.stringify(deadClaimant),
    );

    expect(
      withFileLock("/critical.json", () => "recovered", {
        _fs,
        _isProcessAlive: () => false,
        _ownerToken: () => "recovery-contender-token-02",
        failIfUnavailable: true,
      }),
    ).toBe("recovered");
    expect(_fs.dirs.has(lockDir)).toBe(false);
  });

  it("detaches a real lock directory after taking over a dead reclaim claimant", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-with-file-lock-reclaim-"));
    const target = join(root, "critical.json");
    const lockDir = `${target}.lock`;
    const owner = {
      pid: 4242,
      startedAt: 1,
      token: "dead-owner-token-real-01",
    };
    const deadClaimant = {
      pid: 4343,
      startedAt: 2,
      token: "dead-claimant-token-real-1",
    };
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner.json"), JSON.stringify(owner));
      writeFileSync(
        join(lockDir, `.reclaim-${owner.token}`),
        JSON.stringify(deadClaimant),
      );

      expect(
        withFileLock(target, () => "recovered", {
          _isProcessAlive: () => false,
          _ownerToken: () => "recovery-contender-token-real-1",
          failIfUnavailable: true,
        }),
      ).toBe("recovered");
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("waits behind a live reclaim claimant without deleting its marker", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const owner = {
      pid: 4242,
      startedAt: 1,
      token: "dead-owner-token-0003",
    };
    const liveClaimant = {
      pid: 4343,
      startedAt: 2,
      token: "live-claimant-token-001",
    };
    const claimPath = `${lockDir}/.reclaim-${owner.token}`;
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(owner));
    _fs.writeFileSync(claimPath, JSON.stringify(liveClaimant));
    let now = 0;

    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        retryMs: 5,
        maxRetryMs: 5,
        retryJitterMs: 0,
        _now: () => now,
        _sleep: (milliseconds) => {
          now += milliseconds;
        },
        _random: () => 0,
        _isProcessAlive: (pid) => pid === liveClaimant.pid,
        _ownerToken: () => "waiting-contender-token-02",
        failIfUnavailable: true,
      }),
    ).toThrowError(/Could not acquire state lock/);
    expect(JSON.parse(_fs.readFileSync(claimPath))).toEqual(liveClaimant);
    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      owner,
    );
  });

  it("a delayed dead-owner reclaimer never deletes a replacement owner", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const ownerPath = `${lockDir}/owner.json`;
    const deadOwner = {
      pid: 4242,
      startedAt: 1,
      token: "dead-owner-token-0001",
    };
    const liveOwner = {
      pid: 4343,
      startedAt: 2,
      token: "replacement-token-0001",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(ownerPath, JSON.stringify(deadOwner));
    const originalWrite = _fs.writeFileSync;
    let replaced = false;
    _fs.writeFileSync = vi.fn((p, value, options) => {
      originalWrite(p, value, options);
      if (
        !replaced &&
        String(p).replaceAll("\\", "/") ===
          `${lockDir}/.reclaim-${deadOwner.token}`
      ) {
        replaced = true;
        _fs.rmSync(lockDir, { recursive: true, force: true });
        _fs.mkdirSync(lockDir);
        originalWrite(ownerPath, JSON.stringify(liveOwner));
      }
    });
    let now = 1000;

    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        _now: () => (now += 20),
        _sleep: () => {},
        _isProcessAlive: (pid) => pid === liveOwner.pid,
        _ownerToken: () => "contender-token-0001",
        failIfUnavailable: true,
      }),
    ).toThrowError(/Could not acquire state lock/);
    expect(JSON.parse(_fs.readFileSync(ownerPath))).toEqual(liveOwner);
    expect(_fs.dirs.has(lockDir)).toBe(true);
  });

  it("release leaves a replacement owner untouched when the token changed", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const replacement = {
      pid: 5151,
      startedAt: 2,
      token: "replacement-token-0002",
    };

    withFileLock(
      "/critical.json",
      () => {
        _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(replacement));
      },
      {
        _fs,
        _ownerToken: () => "original-owner-token-0001",
      },
    );

    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      replacement,
    );
    expect(_fs.dirs.has(lockDir)).toBe(true);
  });

  it("strict mode fails closed when ownership is lost before release", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const replacement = {
      pid: 6161,
      startedAt: 3,
      token: "replacement-token-0003",
    };

    expect(() =>
      withFileLock(
        "/critical.json",
        () => {
          _fs.writeFileSync(
            `${lockDir}/owner.json`,
            JSON.stringify(replacement),
          );
        },
        {
          _fs,
          _ownerToken: () => "original-owner-token-0002",
          failIfUnavailable: true,
        },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "STATE_LOCK_OWNERSHIP_LOST" }),
    );
    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      replacement,
    );
  });

  it("commits an owner-published release despite a transient Windows cleanup failure", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const ownerToken = "original-owner-token-0003";
    const nextOwnerToken = "next-owner-token-0000001";
    const detachedReleaseDir = `${lockDir}.released-${ownerToken}-${nextOwnerToken}`;
    const originalRename = _fs.renameSync;
    const originalRemove = _fs.rmSync;
    let blockedReleaseRenames = 0;
    let blockedReleaseRemove = false;

    _fs.renameSync = vi.fn((from, to) => {
      const normalizedFrom = String(from).replaceAll("\\", "/");
      if (normalizedFrom === lockDir && blockedReleaseRenames < 2) {
        blockedReleaseRenames += 1;
        const error = new Error("transient Windows sharing violation");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(from, to);
    });
    _fs.rmSync = vi.fn((target, options) => {
      const normalizedTarget = String(target).replaceAll("\\", "/");
      if (normalizedTarget === detachedReleaseDir && !blockedReleaseRemove) {
        blockedReleaseRemove = true;
        const error = new Error("transient Windows directory cleanup denial");
        error.code = "EPERM";
        throw error;
      }
      return originalRemove(target, options);
    });

    expect(
      withFileLock("/critical.json", () => true, {
        _fs,
        _ownerToken: () => ownerToken,
        failIfUnavailable: true,
      }),
    ).toBe(true);
    expect(_fs.dirs.has(lockDir)).toBe(true);
    expect(
      JSON.parse(_fs.readFileSync(`${lockDir}/.release-${ownerToken}`)),
    ).toEqual(expect.objectContaining({ pid: process.pid, token: ownerToken }));

    expect(
      withFileLock("/critical.json", () => "recovered", {
        _fs,
        timeoutMs: 10,
        _now: (() => {
          let now = 0;
          return () => now++;
        })(),
        _sleep: () => {},
        _isProcessAlive: () => true,
        _ownerToken: () => nextOwnerToken,
        failIfUnavailable: true,
      }),
    ).toBe("recovered");
    expect(_fs.dirs.has(lockDir)).toBe(false);
    expect(_fs.dirs.has(detachedReleaseDir)).toBe(true);
  });

  it("does not report ownership loss when a contender wins published-release cleanup", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const ownerToken = "original-owner-token-0004";
    const cleanupClaim = {
      pid: 7474,
      startedAt: 7,
      token: "winning-claimant-token-001",
    };
    const originalRename = _fs.renameSync;
    const originalWrite = _fs.writeFileSync;
    let blockedReleaseRename = false;

    _fs.renameSync = vi.fn((from, to) => {
      const normalizedFrom = String(from).replaceAll("\\", "/");
      if (normalizedFrom === lockDir && !blockedReleaseRename) {
        blockedReleaseRename = true;
        const error = new Error("transient Windows sharing violation");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(from, to);
    });
    _fs.writeFileSync = vi.fn((target, value, options) => {
      originalWrite(target, value, options);
      const normalizedTarget = String(target).replaceAll("\\", "/");
      if (normalizedTarget === `${lockDir}/.release-${ownerToken}`) {
        originalWrite(
          `${lockDir}/.release-claim-${ownerToken}`,
          JSON.stringify(cleanupClaim),
          { encoding: "utf8", mode: 0o600, flag: "wx" },
        );
      }
    });

    expect(
      withFileLock("/critical.json", () => "committed", {
        _fs,
        _isProcessAlive: () => true,
        _ownerToken: () => ownerToken,
        failIfUnavailable: true,
      }),
    ).toBe("committed");
    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      expect.objectContaining({ pid: process.pid, token: ownerToken }),
    );
    expect(
      JSON.parse(_fs.readFileSync(`${lockDir}/.release-claim-${ownerToken}`)),
    ).toEqual(cleanupClaim);
  });

  it("lets a contender release only after the owner's exact staging path disappears", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const pendingPath = "/state.pending-transaction";
    const ownerToken = "early-release-owner-token-001";
    let blockedContender;
    let completedContender;

    const committed = withFileLock(
      "/critical.json",
      ({ publishReleaseAfterPathRemoved }) => {
        _fs.files.set(pendingPath, "pending replacement");
        expect(publishReleaseAfterPathRemoved(pendingPath)).toBe(true);

        let blockedNow = 0;
        try {
          withFileLock("/critical.json", () => "too-early", {
            _fs,
            timeoutMs: 1,
            _now: () => (blockedNow += 2),
            _sleep: () => {},
            _isProcessAlive: () => true,
            _ownerToken: () => "blocked-contender-token-001",
            failIfUnavailable: true,
          });
        } catch (error) {
          blockedContender = error;
        }

        _fs.files.delete(pendingPath);
        completedContender = withFileLock(
          "/critical.json",
          () => "after-commit",
          {
            _fs,
            timeoutMs: 10,
            _now: (() => {
              let now = 0;
              return () => now++;
            })(),
            _sleep: () => {},
            _isProcessAlive: () => true,
            _ownerToken: () => "completed-contender-token-01",
            failIfUnavailable: true,
          },
        );
        return "committed";
      },
      {
        _fs,
        _isProcessAlive: () => true,
        _ownerToken: () => ownerToken,
        failIfUnavailable: true,
      },
    );

    expect(blockedContender).toMatchObject({ code: "STATE_LOCK_UNAVAILABLE" });
    expect(completedContender).toBe("after-commit");
    expect(committed).toBe("committed");
    expect(_fs.dirs.has(lockDir)).toBe(false);
  });

  it("reclaims a dead published owner whose staging path still exists", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const pendingPath = "/critical.json.4242.deadbeef.tmp";
    const deadOwner = {
      pid: 4242,
      startedAt: 1,
      token: "dead-published-owner-token-001",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(deadOwner));
    _fs.writeFileSync(
      `${lockDir}/.release-${deadOwner.token}`,
      JSON.stringify({
        ...deadOwner,
        releaseAfterPathRemoved: pendingPath,
      }),
    );
    _fs.files.set(pendingPath, "uncommitted private replacement");

    expect(
      withFileLock("/critical.json", () => "recovered", {
        _fs,
        _isProcessAlive: () => false,
        _ownerToken: () => "dead-published-reclaimer-001",
        failIfUnavailable: true,
      }),
    ).toBe("recovered");
    expect(_fs.dirs.has(lockDir)).toBe(false);
    expect(_fs.files.get(pendingPath)).toBe("uncommitted private replacement");
  });

  it("completes a prepublished handoff after a transient direct-release failure", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const pendingPath = "/state.pending-rename";
    const originalRename = _fs.renameSync;
    let blockRelease = true;
    _fs.renameSync = vi.fn((from, to) => {
      if (String(from).replaceAll("\\", "/") === lockDir && blockRelease) {
        blockRelease = false;
        const error = new Error("transient Windows sharing violation");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(from, to);
    });

    expect(
      withFileLock(
        "/critical.json",
        ({ publishReleaseAfterPathRemoved }) => {
          _fs.files.set(pendingPath, "pending replacement");
          expect(publishReleaseAfterPathRemoved(pendingPath)).toBe(true);
          _fs.files.delete(pendingPath);
          return "committed";
        },
        {
          _fs,
          _isProcessAlive: () => true,
          _ownerToken: () => "prepublished-owner-token-001",
          failIfUnavailable: true,
        },
      ),
    ).toBe("committed");
    expect(_fs.dirs.has(lockDir)).toBe(false);
  });

  it("does not complete a published release whose marker token mismatches the live owner", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const liveOwner = {
      pid: 7171,
      startedAt: 4,
      token: "live-owner-token-0000001",
    };
    const mismatchedMarker = {
      ...liveOwner,
      token: "different-owner-token-001",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(liveOwner));
    _fs.writeFileSync(
      `${lockDir}/.release-${liveOwner.token}`,
      JSON.stringify(mismatchedMarker),
    );
    let now = 0;

    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        _now: () => (now += 20),
        _sleep: () => {},
        _isProcessAlive: () => true,
        _ownerToken: () => "contender-owner-token-001",
        failIfUnavailable: true,
      }),
    ).toThrowError(/Could not acquire state lock/);
    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      liveOwner,
    );
    expect(_fs.dirs.has(lockDir)).toBe(true);
  });

  it("waits for a live release claimant and takes over only after that claimant dies", () => {
    const _fs = fakeLockFs();
    const lockDir = "/critical.json.lock";
    const owner = {
      pid: 7272,
      startedAt: 5,
      token: "released-owner-token-00001",
    };
    const cleanupClaim = {
      pid: 7373,
      startedAt: 6,
      token: "release-claimant-token-001",
    };
    _fs.dirs.set(lockDir, 0);
    _fs.writeFileSync(`${lockDir}/owner.json`, JSON.stringify(owner));
    _fs.writeFileSync(
      `${lockDir}/.release-${owner.token}`,
      JSON.stringify(owner),
    );
    _fs.writeFileSync(
      `${lockDir}/.release-claim-${owner.token}`,
      JSON.stringify(cleanupClaim),
    );
    let now = 0;

    expect(() =>
      withFileLock("/critical.json", () => true, {
        _fs,
        timeoutMs: 10,
        _now: () => (now += 20),
        _sleep: () => {},
        _isProcessAlive: () => true,
        _ownerToken: () => "waiting-contender-token-001",
        failIfUnavailable: true,
      }),
    ).toThrowError(/Could not acquire state lock/);
    expect(JSON.parse(_fs.readFileSync(`${lockDir}/owner.json`))).toEqual(
      owner,
    );

    expect(
      withFileLock("/critical.json", () => "recovered", {
        _fs,
        _isProcessAlive: (pid) => pid !== cleanupClaim.pid,
        _ownerToken: () => "recovery-contender-token-01",
        failIfUnavailable: true,
      }),
    ).toBe("recovered");
    expect(_fs.dirs.has(lockDir)).toBe(false);
  });
});
