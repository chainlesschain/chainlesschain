import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  _deps,
  rollbackLastKnownGood,
  scheduleReplace,
  WINDOWS_SIDECAR_READY_TIMEOUT_MS,
} from "../../src/lib/packer/pack-update-applier.js";
import { NATIVE_UPDATE_LINEAGE_SCHEMA } from "../../src/lib/packer/native-update-state.js";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("Windows sidecar asynchronous readiness", () => {
  let directory;
  let target;
  let staged;
  let originalTmpdir;
  let sidecarPath;
  let transactionId;
  let transactionStagingPath;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-async-ready-"),
    );
    target = path.join(directory, "current.exe");
    staged = path.join(directory, "next.exe");
    fs.writeFileSync(target, "current");
    fs.writeFileSync(staged, "next");
    fs.writeFileSync(`${target}.previous`, "previous");
    fs.writeFileSync(
      `${target}.update-lineage.json`,
      JSON.stringify({
        schema: NATIVE_UPDATE_LINEAGE_SCHEMA,
        transactionId: crypto.randomUUID(),
        operation: "update",
        currentSha256: hash("current"),
        previousSha256: hash("previous"),
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    originalTmpdir = _deps.tmpdir;
    _deps.tmpdir = () => directory;
  });

  afterEach(() => {
    _deps.tmpdir = originalTmpdir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function captureSidecar(args) {
    sidecarPath = args.at(-1);
    const body = fs.readFileSync(sidecarPath, "utf8");
    transactionId = body.match(/set "TRANSACTION_ID=([0-9a-f-]{36})"/i)[1];
    transactionStagingPath = body.match(/set "NEW_EXE=([^\r\n]+)"/)[1];
  }

  function schedule(operation, options) {
    const common = { targetExePath: target, platform: "win32", ...options };
    return operation === "update"
      ? scheduleReplace({
          newExePath: staged,
          expectedSha256: hash("next"),
          ...common,
        })
      : rollbackLastKnownGood(common);
  }

  function fakeChild() {
    const child = new EventEmitter();
    child.kill = vi.fn(() => true);
    child.unref = vi.fn();
    return child;
  }

  for (const operation of ["update", "rescue"]) {
    it.each([true, false])(
      `${operation} retains its lock and staging while an async waiter resolves %s`,
      async (ready) => {
        const child = fakeChild();
        let resolveReady;
        const readiness = new Promise((resolve) => {
          resolveReady = resolve;
        });
        const pending = schedule(operation, {
          spawnImpl: (_command, args) => {
            captureSidecar(args);
            return child;
          },
          waitForReadyImpl: ({ timeoutMs }) => {
            expect(timeoutMs).toBe(30_000);
            return readiness;
          },
        });
        const lockToken = fs.readFileSync(`${target}.update.lock`, "utf8");
        try {
          await delay();
          expect(fs.readFileSync(`${target}.update.lock`, "utf8")).toBe(
            lockToken,
          );
          expect(fs.existsSync(transactionStagingPath)).toBe(true);
          expect(fs.readFileSync(target, "utf8")).toBe("current");
          expect(child.unref).not.toHaveBeenCalled();
        } finally {
          resolveReady(ready);
        }
        if (ready) {
          await expect(pending).resolves.toMatchObject({
            action: "sidecar-cmd",
          });
          expect(fs.existsSync(transactionStagingPath)).toBe(true);
          expect(child.unref).toHaveBeenCalledOnce();
        } else {
          await expect(pending).rejects.toMatchObject({
            code: "SIDECAR_NOT_READY",
          });
          expect(child.unref).not.toHaveBeenCalled();
          expect(child.kill).toHaveBeenCalledOnce();
          expect(fs.existsSync(transactionStagingPath)).toBe(
            operation === "update",
          );
        }
        expect(fs.readFileSync(`${target}.update.lock`, "utf8")).toBe(
          lockToken,
        );
        expect(child.listenerCount("exit")).toBe(0);
        // Errors arriving after the handshake must still be consumed.
        expect(() =>
          child.emit("error", new Error("late error")),
        ).not.toThrow();
      },
    );

    it(`${operation} accepts the matching marker after an event-loop turn`, async () => {
      const child = fakeChild();
      const pending = schedule(operation, {
        spawnImpl: (_command, args) => {
          captureSidecar(args);
          return child;
        },
      });
      await delay();
      expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
      expect(fs.existsSync(transactionStagingPath)).toBe(true);
      expect(child.unref).not.toHaveBeenCalled();
      fs.writeFileSync(`${sidecarPath}.ready`, transactionId);
      await expect(pending).resolves.toMatchObject({ action: "sidecar-cmd" });
      expect(child.unref).toHaveBeenCalledOnce();
      expect(fs.existsSync(`${sidecarPath}.ready`)).toBe(false);
      expect(fs.existsSync(transactionStagingPath)).toBe(true);
    });

    it.each(["spawn-error", "early-exit"])(
      `${operation} promptly rejects a real child %s without transferring readiness`,
      async (failure) => {
        let child;
        let closed;
        let delivered = false;
        const started = Date.now();
        try {
          await expect(
            schedule(operation, {
              spawnImpl: (_command, args) => {
                captureSidecar(args);
                child =
                  failure === "spawn-error"
                    ? spawn(path.join(directory, "missing-sidecar.exe"), [], {
                        stdio: "ignore",
                      })
                    : spawn(process.execPath, ["-e", "process.exit(7)"], {
                        stdio: "ignore",
                      });
                child.once(failure === "spawn-error" ? "error" : "exit", () => {
                  delivered = true;
                });
                closed = new Promise((resolve) => child.once("close", resolve));
                vi.spyOn(child, "unref");
                return child;
              },
            }),
          ).rejects.toMatchObject({ code: "SIDECAR_NOT_READY" });
          expect(delivered).toBe(true);
          expect(Date.now() - started).toBeLessThan(10_000);
          expect(WINDOWS_SIDECAR_READY_TIMEOUT_MS).toBe(30_000);
          expect(child.unref).not.toHaveBeenCalled();
          expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
          expect(fs.readFileSync(target, "utf8")).toBe("current");
          expect(fs.readFileSync(staged, "utf8")).toBe("next");
          expect(fs.readFileSync(`${target}.previous`, "utf8")).toBe(
            "previous",
          );
          expect(fs.existsSync(`${target}.update-result.json`)).toBe(false);
          expect(fs.existsSync(transactionStagingPath)).toBe(
            operation === "update",
          );
        } finally {
          if (child?.pid && child.exitCode === null) child.kill();
          if (closed) await closed;
        }
      },
    );
  }

  it.each(["wrong-nonce", "directory"])(
    "rejects a %s ready marker",
    async (kind) => {
      const child = fakeChild();
      await expect(
        schedule("update", {
          spawnImpl: (_command, args) => {
            captureSidecar(args);
            if (kind === "directory") fs.mkdirSync(`${sidecarPath}.ready`);
            else fs.writeFileSync(`${sidecarPath}.ready`, crypto.randomUUID());
            return child;
          },
        }),
      ).rejects.toMatchObject({ code: "SIDECAR_NOT_READY" });
      expect(child.unref).not.toHaveBeenCalled();
      expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
    },
  );

  it("rejects an observed early exit even when the waiter resolves true", async () => {
    const child = fakeChild();
    await expect(
      schedule("update", {
        spawnImpl: (_command, args) => {
          captureSidecar(args);
          return child;
        },
        waitForReadyImpl: async () => {
          await delay();
          child.emit("exit", 7, null);
          return true;
        },
      }),
    ).rejects.toMatchObject({ code: "SIDECAR_NOT_READY" });
    expect(child.unref).not.toHaveBeenCalled();
    expect(child.listenerCount("exit")).toBe(0);
  });

  it.each(["error", "exit"])(
    "rejects an observed %s even when a valid marker is present",
    async (event) => {
      const child = fakeChild();
      const pending = schedule("update", {
        spawnImpl: (_command, args) => {
          captureSidecar(args);
          return child;
        },
      });
      await delay();
      fs.writeFileSync(`${sidecarPath}.ready`, transactionId);
      if (event === "error") child.emit("error", new Error("sidecar failed"));
      else child.emit("exit", 0, null);
      await expect(pending).rejects.toMatchObject({
        code: "SIDECAR_NOT_READY",
      });
      expect(child.unref).not.toHaveBeenCalled();
      expect(child.listenerCount("exit")).toBe(0);
      expect(fs.existsSync(`${target}.update.lock`)).toBe(true);
      expect(fs.readFileSync(target, "utf8")).toBe("current");
    },
  );
});
