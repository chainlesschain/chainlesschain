/**
 * Integration: src/harness/background-task-worker.js
 *
 * The worker is the fork() child that background-task-manager spawns to run a
 * command in isolation. It was previously untested — the parent is tested but
 * never actually forks this file. Here we fork it directly (the same contract:
 * argv = [command, cwd, type]) and assert it classifies success vs failure into
 * the {type:"result"} / {type:"error"} process.send messages and sets the exit
 * code accordingly.
 */

import { describe, it, expect } from "vitest";
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "harness",
  "background-task-worker.js",
);

/** Fork the worker, collect its IPC messages, resolve on exit. */
function runWorker(command, cwd, type) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const child = fork(WORKER, [command, cwd, type], { silent: true, cwd });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      reject(new Error("worker did not exit within 15s"));
    }, 15000);
    if (typeof timer.unref === "function") timer.unref();
    child.on("message", (m) => messages.push(m));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ messages, code });
    });
  });
}

describe("background-task-worker (fork child)", () => {
  it("sends a {type:'result'} message with stdout and exits 0 on success", async () => {
    const { messages, code } = await runWorker(
      "echo cc-worker-ok",
      process.cwd(),
      "shell",
    );
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeTruthy();
    expect(result.data).toContain("cc-worker-ok");
    // No error message on the success path.
    expect(messages.find((m) => m.type === "error")).toBeUndefined();
    expect(code).toBe(0);
  });

  it("sends a {type:'error'} message and exits 1 on command failure", async () => {
    const { messages, code } = await runWorker(
      "exit 1",
      process.cwd(),
      "shell",
    );
    const err = messages.find((m) => m.type === "error");
    expect(err).toBeTruthy();
    expect(typeof err.error).toBe("string");
    expect(err.error.length).toBeGreaterThan(0);
    // No result message on the failure path.
    expect(messages.find((m) => m.type === "result")).toBeUndefined();
    expect(code).toBe(1);
  });

  it("treats a non-'shell' type the same execSync path (result on success)", async () => {
    const { messages, code } = await runWorker(
      "echo other-type-ok",
      process.cwd(),
      "generic",
    );
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeTruthy();
    expect(result.data).toContain("other-type-ok");
    expect(code).toBe(0);
  });
});
