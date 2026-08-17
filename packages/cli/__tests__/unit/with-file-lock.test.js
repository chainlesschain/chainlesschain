import { describe, it, expect, vi } from "vitest";
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
      if (!dirs.has(p)) throw enoent();
      return { mtimeMs: dirs.get(p) };
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
});
