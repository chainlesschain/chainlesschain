import { describe, it, expect, vi } from "vitest";
import { withFileLock } from "../../src/lib/with-file-lock.js";

// In-memory fake fs modelling the lock DIRECTORY as a single key.
function fakeLockFs() {
  const dirs = new Map(); // lockDir -> mtimeMs
  return {
    dirs,
    mkdirSync: vi.fn((p) => {
      if (dirs.has(p)) {
        const e = new Error("EEXIST");
        e.code = "EEXIST";
        throw e;
      }
      dirs.set(p, 0);
    }),
    statSync: vi.fn((p) => {
      if (!dirs.has(p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      return { mtimeMs: dirs.get(p) };
    }),
    rmSync: vi.fn((p) => dirs.delete(p)),
  };
}

describe("withFileLock", () => {
  it("acquires the lock, runs fn (locked:true), and releases", () => {
    const _fs = fakeLockFs();
    const result = withFileLock("/state.json", (ctx) => {
      expect(ctx.locked).toBe(true);
      expect(_fs.dirs.has("/state.json.lock")).toBe(true); // held during fn
      return "ok";
    }, { _fs });
    expect(result).toBe("ok");
    expect(_fs.dirs.has("/state.json.lock")).toBe(false); // released after
  });

  it("releases the lock even if fn throws", () => {
    const _fs = fakeLockFs();
    expect(() =>
      withFileLock("/s.json", () => {
        throw new Error("boom");
      }, { _fs }),
    ).toThrow("boom");
    expect(_fs.dirs.has("/s.json.lock")).toBe(false);
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
});
