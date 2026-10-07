import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withFileLock,
  withFileLockAsync,
} from "../../src/lib/with-file-lock.js";

const roots = [];
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const strict = { failIfUnavailable: true, timeoutMs: 0 };
function target() {
  const directory = fs.mkdtempSync(
    path.join(temporaryParent, "cc-async-lock-"),
  );
  roots.push(directory);
  return path.join(directory, "state");
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  for (const directory of roots.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== temporaryParent ||
      !path.basename(resolved).startsWith("cc-async-lock-")
    )
      throw new Error("async lock cleanup escaped its temporary root");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("withFileLockAsync", () => {
  it("holds ownership across await and rejects an immediate synchronous writer", async () => {
    const file = target();
    const entered = deferred();
    const finish = deferred();
    let captured;
    const owner = withFileLockAsync(
      file,
      async (context) => {
        captured = context;
        expect(context.assertOwnership()).toBe(true);
        entered.resolve();
        await finish.promise;
        expect(context.assertOwnership()).toBe(true);
        return "committed";
      },
      strict,
    );
    await entered.promise;
    const contender = vi.fn();
    try {
      expect(() => withFileLock(file, contender, strict)).toThrowError(
        expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
      );
      expect(contender).not.toHaveBeenCalled();
      expect(captured.assertOwnership()).toBe(true);
      expect(captured).not.toHaveProperty("token");
    } finally {
      finish.resolve();
    }
    expect(await owner).toBe("committed");
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
    expect(() => captured.assertOwnership()).toThrowError(
      expect.objectContaining({ code: "STATE_LOCK_OWNERSHIP_LOST" }),
    );
  });

  it("waits asynchronously so the current owner can finish on the same event loop", async () => {
    const file = target();
    const finish = deferred();
    const order = [];
    const owner = withFileLockAsync(
      file,
      async (context) => {
        order.push("owner-entered");
        await finish.promise;
        context.assertOwnership();
        order.push("owner-finished");
      },
      strict,
    );
    const waiter = withFileLockAsync(
      file,
      (context) => {
        context.assertOwnership();
        order.push("waiter-entered");
      },
      { failIfUnavailable: true, timeoutMs: 1000, retryMs: 1 },
    );
    const timer = setTimeout(finish.resolve, 10);
    try {
      await Promise.all([owner, waiter]);
    } finally {
      clearTimeout(timer);
      finish.resolve();
      await Promise.allSettled([owner, waiter]);
    }
    expect(order).toEqual([
      "owner-entered",
      "owner-finished",
      "waiter-entered",
    ]);
  });

  it.each(["sync throw", "async rejection", "undefined rejection"])(
    "releases on %s without changing the original thrown value",
    async (kind) => {
      const file = target();
      const failure =
        kind === "undefined rejection" ? undefined : new Error(kind);
      const callback =
        kind === "sync throw"
          ? () => {
              throw failure;
            }
          : async () => {
              await Promise.resolve();
              throw failure;
            };
      await expect(withFileLockAsync(file, callback, strict)).rejects.toBe(
        failure,
      );
      expect(
        withFileLock(file, (context) => context.assertOwnership(), strict),
      ).toBe(true);
    },
  );

  it("keeps callback failure ahead of a cleanup failure", async () => {
    const file = target();
    const failure = new Error("original callback failure");
    let rejectCleanup = false;
    const io = {
      ...fs,
      renameSync(from, to) {
        if (rejectCleanup)
          throw Object.assign(new Error("cleanup failed"), { code: "EIO" });
        fs.renameSync(from, to);
      },
    };
    await expect(
      withFileLockAsync(
        file,
        async () => {
          await Promise.resolve();
          rejectCleanup = true;
          throw failure;
        },
        { ...strict, _fs: io },
      ),
    ).rejects.toBe(failure);
  });

  it("rejects changed owner tokens and leaves the replacement lock untouched", async () => {
    const file = target();
    const ownerPath = path.join(`${file}.lock`, "owner.json");
    let replacement;
    await expect(
      withFileLockAsync(
        file,
        async (context) => {
          await Promise.resolve();
          replacement = {
            ...JSON.parse(fs.readFileSync(ownerPath)),
            token: "replacement-owner-token",
          };
          fs.writeFileSync(ownerPath, JSON.stringify(replacement));
          context.assertOwnership();
        },
        strict,
      ),
    ).rejects.toMatchObject({ code: "STATE_LOCK_OWNERSHIP_LOST" });
    expect(JSON.parse(fs.readFileSync(ownerPath))).toEqual(replacement);
  });

  it("rejects a replacement directory even with copied owner metadata", async () => {
    const file = target();
    const lockDir = `${file}.lock`;
    const original = `${file}.original`;
    await expect(
      withFileLockAsync(
        file,
        async (context) => {
          await Promise.resolve();
          const bytes = fs.readFileSync(path.join(lockDir, "owner.json"));
          fs.renameSync(lockDir, original);
          fs.mkdirSync(lockDir);
          fs.writeFileSync(path.join(lockDir, "owner.json"), bytes);
          context.assertOwnership();
        },
        strict,
      ),
    ).rejects.toMatchObject({ code: "STATE_LOCK_OWNERSHIP_LOST" });
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it("does not publish an early handoff while its asynchronous callback remains active", async () => {
    const file = target();
    const finish = deferred();
    let captured;
    const owner = withFileLockAsync(
      file,
      async (context) => {
        captured = context;
        expect(
          context.publishReleaseAfterPathRemoved(`${file}.already-absent`),
        ).toBe(false);
        await finish.promise;
        expect(context.assertOwnership()).toBe(true);
      },
      strict,
    );
    try {
      expect(fs.readdirSync(`${file}.lock`)).toEqual(["owner.json"]);
      expect(() => withFileLock(file, () => true, strict)).toThrowError(
        expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
      );
      expect(captured.assertOwnership()).toBe(true);
    } finally {
      finish.resolve();
      await owner;
    }
  });

  it("blocks behind a live child across await and recovers after its confirmed SIGKILL exit", async () => {
    const file = target();
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../fixtures/with-file-lock-async-child.mjs",
            import.meta.url,
          ),
        ),
        file,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
    );
    const exited = new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("async child never acquired lock")),
          10000,
        );
        child.once("message", (message) => {
          clearTimeout(timer);
          if (message.kind === "held") resolve();
          else reject(new Error(message.message ?? "child failed"));
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      const contender = vi.fn();
      expect(() => withFileLock(file, contender, strict)).toThrowError(
        expect.objectContaining({ code: "STATE_LOCK_UNAVAILABLE" }),
      );
      expect(contender).not.toHaveBeenCalled();
      expect(child.kill("SIGKILL")).toBe(true);
      await exited;
      expect(
        await withFileLockAsync(
          file,
          async (context) => {
            await Promise.resolve();
            return context.assertOwnership();
          },
          { failIfUnavailable: true, timeoutMs: 2000 },
        ),
      ).toBe(true);
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
    }
  }, 20000);
});
