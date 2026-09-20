import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { createAtomicFileCommitter } = require("../secure-config-atomic-file");
const { SecureConfigStorage } = require("../secure-config-storage");
const workerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "secure-config-atomic-worker.cjs",
);

function waitForChildMessage(child, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for child ${expectedType}`)),
      10000,
    );
    child.on("message", (message) => {
      if (message?.type === "error") {
        clearTimeout(timeout);
        reject(new Error(message.message));
      } else if (message?.type === expectedType) {
        clearTimeout(timeout);
        resolve(message);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForChildExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function createStorage(storagePath) {
  return new SecureConfigStorage({
    storagePath,
    app: { getPath: () => path.dirname(storagePath) },
    safeStorage: { isEncryptionAvailable: () => false },
  });
}

describe("secure config atomic file committer", () => {
  let root;
  let target;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "chainless-atomic-"));
    target = path.join(root, "secure-config.enc");
  });

  afterEach(() => {
    const resolvedRoot = path.resolve(root);
    const resolvedTemp = path.resolve(os.tmpdir());
    if (!resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`)) {
      throw new Error("Refusing to remove a non-temporary test directory");
    }
    fs.rmSync(resolvedRoot, { force: true, recursive: true });
  });

  it("flushes and atomically replaces the target without leaving temporary files", () => {
    const committer = createAtomicFileCommitter();

    committer.writeFileSync(target, Buffer.from("first"));
    committer.writeFileSync(target, Buffer.from("second"));

    expect(fs.readFileSync(target, "utf8")).toBe("second");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
    if (process.platform !== "win32") {
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    }
  });

  it("durably creates a missing nested parent chain", async () => {
    const nestedTarget = path.join(root, "one", "two", "secure-config.enc");
    const committer = createAtomicFileCommitter();

    await committer.writeFile(nestedTarget, Buffer.from("nested"));

    expect(fs.readFileSync(nestedTarget, "utf8")).toBe("nested");
    expect(fs.existsSync(`${nestedTarget}.tmp`)).toBe(false);
  });

  it("supports the same commit protocol for asynchronous writes", async () => {
    const committer = createAtomicFileCommitter();

    await committer.writeFile(target, Buffer.from("async"));

    expect(fs.readFileSync(target, "utf8")).toBe("async");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("rejects concurrent writers to the same resolved target", async () => {
    let releaseSync;
    let announceSync;
    const syncGate = new Promise((resolve) => {
      releaseSync = resolve;
    });
    const syncReached = new Promise((resolve) => {
      announceSync = resolve;
    });
    const delayedPromises = {
      ...fs.promises,
      async open(...args) {
        const handle = await fs.promises.open(...args);
        if (args[0] !== `${target}.tmp`) {
          return handle;
        }
        return {
          close: () => handle.close(),
          writeFile: (data) => handle.writeFile(data),
          async sync() {
            announceSync();
            await syncGate;
            await handle.sync();
          },
        };
      },
    };
    const firstCommitter = createAtomicFileCommitter({
      fs,
      fsPromises: delayedPromises,
      path,
    });
    const secondCommitter = createAtomicFileCommitter();
    const firstWrite = firstCommitter.writeFile(target, Buffer.from("first"));
    await syncReached;

    try {
      await expect(
        secondCommitter.writeFile(target, Buffer.from("second")),
      ).rejects.toThrow("Atomic file target is already active");
    } finally {
      releaseSync();
    }
    await firstWrite;
    expect(fs.readFileSync(target, "utf8")).toBe("first");
  });

  it("rejects writes, recovery, and removal while another process owns the target", async () => {
    const child = fork(workerPath, [target], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const exit = waitForChildExit(child);
    await waitForChildMessage(child, "locked");

    try {
      const committer = createAtomicFileCommitter();
      expect(() => committer.recoverSync(target, () => true)).toThrow(
        "Atomic file target is owned by another process",
      );
      expect(() => committer.removeSync(target)).toThrow(
        "Atomic file target is owned by another process",
      );
      expect(() =>
        committer.writeFileSync(target, Buffer.from("parent")),
      ).toThrow("Atomic file target is owned by another process");
    } finally {
      child.send({ type: "release" });
    }

    await expect(exit).resolves.toEqual({ code: 0, signal: null });
    expect(fs.readFileSync(target, "utf8")).toBe("child");
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  });

  it("reclaims a dead process lock before committing", async () => {
    const child = fork(workerPath, [target], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const exit = waitForChildExit(child);
    await waitForChildMessage(child, "locked");
    child.kill();
    await exit;

    const committer = createAtomicFileCommitter();
    committer.writeFileSync(target, Buffer.from("parent"));

    expect(fs.readFileSync(target, "utf8")).toBe("parent");
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
    expect(fs.existsSync(`${target}.lock.recovery`)).toBe(false);
  });

  it("fails closed on an invalid cross-process owner record", () => {
    fs.writeFileSync(`${target}.lock`, "invalid-owner");
    const committer = createAtomicFileCommitter();

    expect(() =>
      committer.writeFileSync(target, Buffer.from("blocked")),
    ).toThrow("Atomic file lock owner is invalid");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(`${target}.lock`, "utf8")).toBe("invalid-owner");
  });

  it("preserves the old target and removes the temporary file when rename fails", () => {
    fs.writeFileSync(target, "old");
    const failingFs = {
      ...fs,
      renameSync() {
        throw new Error("simulated rename failure");
      },
    };
    const committer = createAtomicFileCommitter({
      fs: failingFs,
      fsPromises: fs.promises,
      path,
    });

    expect(() => committer.writeFileSync(target, Buffer.from("new"))).toThrow(
      "simulated rename failure",
    );
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  });

  it("recovers a validated temporary file when the target is absent", () => {
    fs.writeFileSync(`${target}.tmp`, "recoverable");
    const committer = createAtomicFileCommitter();

    const receipt = committer.recoverSync(
      target,
      (data) => data.toString("utf8") === "recoverable",
    );

    expect(receipt).toEqual({
      action: "temporary-recovered",
      recovered: true,
    });
    expect(fs.readFileSync(target, "utf8")).toBe("recoverable");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("keeps a validated target and discards a stale temporary file", async () => {
    fs.writeFileSync(target, "current");
    fs.writeFileSync(`${target}.tmp`, "stale");
    const committer = createAtomicFileCommitter();

    const receipt = await committer.recover(
      target,
      (data) => data.toString("utf8") === "current",
    );

    expect(receipt).toEqual({
      action: "stale-discarded",
      recovered: false,
    });
    expect(fs.readFileSync(target, "utf8")).toBe("current");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("discards a temporary file that fails validation", () => {
    fs.writeFileSync(`${target}.tmp`, "partial");
    const committer = createAtomicFileCommitter();

    const receipt = committer.recoverSync(target, () => false);

    expect(receipt).toEqual({
      action: "invalid-discarded",
      recovered: false,
    });
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("removes both the target and any stale temporary file", () => {
    fs.writeFileSync(target, "current");
    fs.writeFileSync(`${target}.tmp`, "stale");
    const committer = createAtomicFileCommitter();

    expect(committer.removeSync(target)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("recovers an authenticated encrypted storage temporary file", () => {
    const storage = createStorage(target);
    const config = { "openai.apiKey": "private-test-key" };
    fs.writeFileSync(`${target}.tmp`, storage.encrypt(config));

    expect(storage.load(false)).toEqual(config);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("discards an unauthenticated storage temporary file", () => {
    const storage = createStorage(target);
    fs.writeFileSync(`${target}.tmp`, Buffer.from("partial-secret-data"));

    expect(storage.load(false)).toBeNull();
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });
});
