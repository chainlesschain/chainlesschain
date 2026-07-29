import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  WORKSPACE_TRANSACTION_ERROR,
  WorkspaceTransactionManager,
} from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];
const children = [];

function nextLine(stream) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const onData = (chunk) => {
      buffered += String(chunk);
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      resolve(buffered.slice(0, newline));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
    };
    stream.on("data", onData);
    stream.on("error", onError);
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await waitForExit(child);
    }
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace transaction cross-process lock", () => {
  it("prevents two processes from checkpointing the same workspace", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-workspace-lock-multiprocess-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const stateDir = path.join(root, "state");
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "file.txt"), "before\n");
    const fixturePath = fileURLToPath(
      new URL(
        "../fixtures/workspace-transaction-lock-holder.mjs",
        import.meta.url,
      ),
    );
    const child = spawn(
      process.execPath,
      [fixturePath, workspaceRoot, stateDir],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    children.push(child);
    const ready = JSON.parse(await nextLine(child.stdout));
    expect(ready).toMatchObject({
      ready: true,
      pid: child.pid,
    });

    const contender = new WorkspaceTransactionManager({ stateDir });
    expect(() =>
      contender.begin({
        runId: "multiprocess-contender",
        taskKey: "contender-task",
        workspaceRoot,
      }),
    ).toThrow(
      expect.objectContaining({
        code: WORKSPACE_TRANSACTION_ERROR.OVERLAPPING_WORKSPACE,
        ownerPid: child.pid,
        ownerTransactionId: ready.id,
      }),
    );

    child.stdin.end("release\n");
    expect(await waitForExit(child)).toEqual({ code: 0, signal: null });
  });
});
