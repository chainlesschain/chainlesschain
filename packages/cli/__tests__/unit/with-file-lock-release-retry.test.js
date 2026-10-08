import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  withFileLock,
  withFileLockAsync,
} from "../../src/lib/with-file-lock.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture({ permanent = false, beforeRetry, identity = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-retry-"));
  roots.push(root);
  const target = path.join(root, "state.json"),
    lock = `${target}.lock`;
  let now = 0,
    renames = 0,
    markers = 0;
  const waits = [],
    error = (code) => Object.assign(new Error(code), { code });
  const io = {
    ...fs,
    lstatSync(file) {
      const stat = fs.lstatSync(file, { bigint: true });
      return identity ? stat : { mtimeMs: stat.mtimeMs };
    },
    renameSync(from, to) {
      if (from === lock && (++renames === 1 || permanent))
        throw error("EACCES");
      fs.renameSync(from, to);
    },
    writeFileSync(file, bytes, options) {
      if (
        path.dirname(file) === lock &&
        path.basename(file).startsWith(".release-") &&
        (++markers === 1 || permanent)
      )
        throw error("ENOENT");
      fs.writeFileSync(file, bytes, options);
    },
  };
  return {
    root,
    target,
    lock,
    waits,
    get renames() {
      return renames;
    },
    options: {
      _fs: io,
      _now: () => now,
      _random: () => 0,
      _ownerToken: () => "release-retry-original-owner",
      _sleep(ms) {
        waits.push(ms);
        now += ms;
        beforeRetry?.({ root, lock, setNow: (value) => (now = value) });
      },
      failIfUnavailable: true,
      timeoutMs: 100,
      retryMs: 1,
      maxRetryMs: 2,
      retryJitterMs: 0,
    },
  };
}
for (const [name, run] of [
  ["sync", withFileLock],
  ["async", withFileLockAsync],
]) {
  describe(`${name} unpublished lock release`, () => {
    it("recovers sharing denial and a transient missing marker without replaying the body", async () => {
      const f = fixture();
      let calls = 0;
      expect(
        await run(
          f.target,
          () => {
            calls++;
            return "committed";
          },
          f.options,
        ),
      ).toBe("committed");
      expect(calls).toBe(1);
      expect(f.waits).toEqual([1]);
      expect(f.renames).toBe(2);
      expect(fs.existsSync(f.lock)).toBe(false);
    });
    it("preserves the callback failure after recovering release", async () => {
      const f = fixture(),
        failure = new Error("transaction failed");
      await expect(
        Promise.resolve().then(() =>
          run(
            f.target,
            () => {
              throw failure;
            },
            f.options,
          ),
        ),
      ).rejects.toBe(failure);
      expect(fs.existsSync(f.lock)).toBe(false);
    });
    it.each([
      "copied-owner",
      "changed-token",
      "published-marker",
      "deadline",
      "missing-identity",
    ])("preserves the lock when retry becomes unsafe: %s", async (mode) => {
      let expectedOwner;
      const f = fixture({
        identity: mode !== "missing-identity",
        beforeRetry({ root, lock, setNow }) {
          const ownerPath = path.join(lock, "owner.json");
          const bytes = fs.readFileSync(ownerPath);
          if (mode === "copied-owner") {
            fs.renameSync(lock, path.join(root, "old-lock"));
            fs.mkdirSync(lock);
            fs.writeFileSync(ownerPath, bytes);
          }
          if (mode === "changed-token") {
            const owner = JSON.parse(bytes);
            owner.token = "replacement-token";
            fs.writeFileSync(ownerPath, JSON.stringify(owner));
          }
          if (mode === "published-marker")
            fs.writeFileSync(
              path.join(lock, ".release-release-retry-original-owner"),
              bytes,
            );
          if (mode === "deadline") setNow(100);
          expectedOwner = fs.readFileSync(ownerPath);
        },
      });
      await expect(
        Promise.resolve().then(() => run(f.target, () => true, f.options)),
      ).rejects.toMatchObject({ code: "STATE_LOCK_OWNERSHIP_LOST" });
      expect(f.renames).toBe(1);
      expect(f.waits).toEqual(mode === "missing-identity" ? [] : [1]);
      expect(fs.existsSync(f.lock)).toBe(true);
      if (expectedOwner)
        expect(fs.readFileSync(path.join(f.lock, "owner.json"))).toEqual(
          expectedOwner,
        );
      if (mode === "published-marker")
        expect(
          fs.existsSync(
            path.join(f.lock, ".release-release-retry-original-owner"),
          ),
        ).toBe(true);
    });
    it("bounds permanent contention and leaves the owned directory intact", async () => {
      const f = fixture({ permanent: true });
      await expect(
        Promise.resolve().then(() => run(f.target, () => true, f.options)),
      ).rejects.toMatchObject({ code: "STATE_LOCK_OWNERSHIP_LOST" });
      expect(f.renames).toBe(4);
      expect(f.waits).toEqual([1, 2, 2]);
      expect(fs.existsSync(f.lock)).toBe(true);
    });
  });
}
