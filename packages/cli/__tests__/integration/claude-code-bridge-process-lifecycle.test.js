import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  ClaudeAdapter,
  ClaudeCodeAgent,
  EXTERNAL_AGENT_ERROR,
  _deps,
} from "../../src/lib/claude-code-bridge.js";
import broker from "../../src/lib/process-execution-broker/index.js";
import { useOwnershipJournalHome } from "../helpers/ownership-journal-home.js";

useOwnershipJournalHome();

it("waits for the real Broker-owned process close after post-spawn failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bridge-owned-"));
  const originalSpawn = _deps.spawn;
  const originalHook = broker._emitHooksEvent;
  const adapter = new ClaudeAdapter({ command: process.execPath });
  // No provider or account is involved. The real Broker and native child
  // launch remain intact; only the post-launch bookkeeping hook fails.
  adapter.buildArgs = () => [
    "-e",
    "setTimeout(() => process.exit(0), 10000); setInterval(() => {}, 1000)",
  ];
  let child = null;
  let closed = false;
  let closePromise = null;
  let spawnFailure = null;
  let cleanupTimer = null;
  broker._emitHooksEvent = function (event, payload) {
    if (
      event === "tool:start" &&
      payload.component === "claude-code-bridge:agent"
    ) {
      throw new Error("fixture post-spawn bookkeeping failure");
    }
    return originalHook.call(this, event, payload);
  };
  _deps.spawn = (...args) => {
    try {
      return originalSpawn(...args);
    } catch (error) {
      spawnFailure = error;
      child = error.spawnedProcess;
      if (child) {
        closePromise = new Promise((resolve) => {
          child.once("close", () => {
            closed = true;
            resolve();
          });
        });
      }
      throw error;
    }
  };
  try {
    const agent = new ClaudeCodeAgent({ adapter });
    // Observe closure at the actual callback, not after a grace-period sleep.
    const complete = vi.fn(() => closed);
    agent.on("task:complete", complete);
    const result = await agent.executeTask("fixture", {
      cwd: root,
      timeout: 20_000,
      killGraceMs: 100,
    });
    expect(child, "test must reach native spawn").not.toBeNull();
    expect(spawnFailure.workspaceTerminationRequested).toBe(true);
    expect(closed).toBe(true);
    expect(result).toMatchObject({
      success: false,
      errorCode: EXTERNAL_AGENT_ERROR.SPAWN_FAILED,
      error: "fixture post-spawn bookkeeping failure",
      timedOut: false,
      cancelled: false,
    });
    expect(complete).toHaveBeenCalledExactlyOnceWith(result);
    expect(complete.mock.results[0].value).toBe(true);
    expect(agent.currentTask).toBeNull();
  } finally {
    _deps.spawn = originalSpawn;
    broker._emitHooksEvent = originalHook;
    if (child && !closed) child.kill("SIGKILL");
    if (closePromise) {
      await Promise.race([
        closePromise,
        new Promise((resolve) => {
          cleanupTimer = setTimeout(resolve, 12_000);
        }),
      ]);
      clearTimeout(cleanupTimer);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
