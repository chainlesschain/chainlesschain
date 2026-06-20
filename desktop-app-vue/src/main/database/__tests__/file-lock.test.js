import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import realFs from "fs";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { acquireLock, releaseLock, STALE_LOCK_MS } = require("../file-lock.js");

describe("file-lock", () => {
  let dir;
  let lockPath;

  beforeEach(() => {
    dir = realFs.mkdtempSync(path.join(os.tmpdir(), "cc-filelock-"));
    lockPath = path.join(dir, "op.lock");
  });

  afterEach(() => {
    try {
      realFs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe("real filesystem semantics", () => {
    it("acquires a free lock and creates the lockfile", () => {
      expect(acquireLock(lockPath)).toBe(true);
      expect(realFs.existsSync(lockPath)).toBe(true);
    });

    it("refuses a second acquire while the lock is held (fresh)", () => {
      expect(acquireLock(lockPath)).toBe(true);
      expect(acquireLock(lockPath)).toBe(false);
    });

    it("release removes the lock and lets it be re-acquired", () => {
      expect(acquireLock(lockPath)).toBe(true);
      releaseLock(lockPath);
      expect(realFs.existsSync(lockPath)).toBe(false);
      expect(acquireLock(lockPath)).toBe(true);
    });

    it("release is a no-op when the lock is already gone", () => {
      expect(() => releaseLock(lockPath)).not.toThrow();
    });

    it("reclaims a stale lock (older than STALE_LOCK_MS)", () => {
      expect(acquireLock(lockPath)).toBe(true);
      // Hold but pretend "now" is far enough in the future to be stale.
      const future = () => Date.now() + STALE_LOCK_MS + 60_000;
      expect(acquireLock(lockPath, realFs, future)).toBe(true);
      // After a successful reclaim exactly one lockfile exists.
      expect(realFs.existsSync(lockPath)).toBe(true);
    });

    it("does NOT reclaim a held lock that is not yet stale", () => {
      expect(acquireLock(lockPath)).toBe(true);
      const soon = () => Date.now() + STALE_LOCK_MS - 60_000; // just under the threshold
      expect(acquireLock(lockPath, realFs, soon)).toBe(false);
    });
  });

  describe("atomic stale reclaim (race)", () => {
    // A minimal fs stub that reports the lock as held + stale, letting us drive
    // the rename outcome to model two processes racing to reclaim.
    function staleFsStub({ renameThrows }) {
      const created = [];
      return {
        created,
        openSync: vi.fn((p, flags) => {
          if (flags === "wx" && created.includes(p)) {
            const e = new Error("EEXIST");
            e.code = "EEXIST";
            throw e;
          }
          created.push(p);
          return 1;
        }),
        writeSync: vi.fn(),
        closeSync: vi.fn(),
        statSync: vi.fn(() => ({ mtimeMs: 0 })), // age = now() - 0 → very stale
        unlinkSync: vi.fn((p) => {
          const i = created.indexOf(p);
          if (i >= 0) created.splice(i, 1);
        }),
        renameSync: vi.fn((from) => {
          if (renameThrows) {
            const e = new Error("ENOENT");
            e.code = "ENOENT";
            throw e; // another racer already moved the stale lock
          }
          const i = created.indexOf(from);
          if (i >= 0) created.splice(i, 1);
        }),
      };
    }

    it("winner of the rename race reclaims the lock", () => {
      const fs = staleFsStub({ renameThrows: false });
      fs.created.push(lockPath); // pre-existing (stale) lock held
      const now = () => STALE_LOCK_MS + 1;
      expect(acquireLock(lockPath, fs, now)).toBe(true);
      expect(fs.renameSync).toHaveBeenCalled();
      expect(fs.created).toContain(lockPath); // recreated
    });

    it("loser of the rename race stays locked out (no double-acquire)", () => {
      const fs = staleFsStub({ renameThrows: true });
      fs.created.push(lockPath);
      const now = () => STALE_LOCK_MS + 1;
      expect(acquireLock(lockPath, fs, now)).toBe(false);
      // It must not have created a competing lock after losing the rename.
      expect(fs.openSync).toHaveBeenCalledTimes(1); // only the initial wx attempt
    });
  });

  it("propagates non-EEXIST open errors (e.g. permission)", () => {
    const fs = {
      openSync: vi.fn(() => {
        const e = new Error("EACCES");
        e.code = "EACCES";
        throw e;
      }),
    };
    expect(() => acquireLock(lockPath, fs)).toThrow(/EACCES/);
  });
});
