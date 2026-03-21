/**
 * Integration tests: Orchestrator full pipeline
 *
 * Tests the complete flow:
 *   addTask → LLM decompose → AgentRouter dispatch → CI check → notify
 *
 * External dependencies (LLM, CI, spawn) are mocked; all internal
 * orchestration logic runs for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Orchestrator,
  TASK_STATUS,
  TASK_SOURCE,
} from "../../src/lib/orchestrator.js";
import { _deps as bridgeDeps } from "../../src/lib/claude-code-bridge.js";
import { _deps as orchDeps } from "../../src/lib/orchestrator.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeChildProcess(stdout = "", exitCode = 0) {
  const { EventEmitter } = require("events");
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  process.nextTick(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", exitCode);
  });
  return proc;
}

const AGENT_SUCCESS_OUTPUT =
  JSON.stringify({ type: "result", result: "Fixed!" }) + "\n";

/** Build an Orchestrator with LLM + CI + spawn all mocked. */
function buildOrchestrator({
  decomposeTo = [{ id: "sub-1", description: "fix" }],
  agentExitCode = 0,
  ciPasses = true,
  notifySend = vi.fn(),
} = {}) {
  // Mock spawn for claude CLI
  bridgeDeps.spawn = vi.fn(() =>
    makeChildProcess(
      agentExitCode === 0 ? AGENT_SUCCESS_OUTPUT : "",
      agentExitCode,
    ),
  );
  bridgeDeps.execSync = vi.fn((cmd) => {
    if (cmd.includes("--version")) return "2.0.0";
    throw new Error("not found");
  });

  // Mock CI command
  orchDeps.execSync = vi.fn((cmd) => {
    if (!ciPasses) {
      const err = new Error("CI failed");
      err.stdout = "FAIL src/app.test.js\n  ✕ should work\n";
      err.stderr = "Error: expected true";
      throw err;
    }
    return "All tests passed";
  });

  const orch = new Orchestrator({
    cwd: "/tmp/test-project",
    maxParallel: 2,
    maxRetries: 1,
    ciCommand: "npm test",
    verbose: false,
  });

  // Mock LLM chat for decomposition
  orch._chat = vi.fn(async () => JSON.stringify(decomposeTo));

  // Add a mock notification channel
  const notifier = {
    isConfigured: true,
    notifyStart: vi.fn(() => Promise.resolve({ ok: true })),
    notifySuccess: vi.fn(() => Promise.resolve({ ok: true })),
    notifyFailure: vi.fn(() => Promise.resolve({ ok: true })),
  };
  orch.notifier.add("mock", notifier);

  return { orch, notifier };
}

// ─── Basic task lifecycle ─────────────────────────────────────────

describe("Orchestrator: task lifecycle", () => {
  let originalBridgeDeps;
  let originalOrchDeps;

  beforeEach(() => {
    originalBridgeDeps = { ...bridgeDeps };
    originalOrchDeps = { ...orchDeps };
  });

  afterEach(() => {
    Object.assign(bridgeDeps, originalBridgeDeps);
    Object.assign(orchDeps, originalOrchDeps);
    vi.clearAllMocks();
  });

  it("completes a task with CI pass → status COMPLETED", async () => {
    const { orch } = buildOrchestrator({ ciPasses: true });
    const task = await orch.addTask("Fix auth bug", {
      source: TASK_SOURCE.CLI,
      cwd: "/tmp",
    });

    expect(task.status).toBe(TASK_STATUS.COMPLETED);
    expect(task.subtasks).toHaveLength(1);
    expect(task.agentResults).toHaveLength(1);
    expect(task.agentResults[0].success).toBe(true);
    expect(task.retries).toBe(0);
  });

  it("emits task:complete event on success", async () => {
    const { orch } = buildOrchestrator({ ciPasses: true });
    const completeFn = vi.fn();
    orch.on("task:complete", completeFn);

    await orch.addTask("task", { cwd: "/tmp" });
    expect(completeFn).toHaveBeenCalledTimes(1);
    expect(completeFn.mock.calls[0][0].status).toBe(TASK_STATUS.COMPLETED);
  });

  it("calls notifyStart and notifySuccess on successful pipeline", async () => {
    const { orch, notifier } = buildOrchestrator({ ciPasses: true });
    await orch.addTask("task", { cwd: "/tmp", notify: true });

    expect(notifier.notifyStart).toHaveBeenCalledTimes(1);
    expect(notifier.notifySuccess).toHaveBeenCalledTimes(1);
    expect(notifier.notifyFailure).not.toHaveBeenCalled();
  });

  it("skips CI when runCI=false", async () => {
    const { orch } = buildOrchestrator({ ciPasses: true });
    const task = await orch.addTask("task", { cwd: "/tmp", runCI: false });

    expect(task.status).toBe(TASK_STATUS.COMPLETED);
    expect(orchDeps.execSync).not.toHaveBeenCalled();
  });

  it("records completedAt timestamp on success", async () => {
    const { orch } = buildOrchestrator({ ciPasses: true });
    const task = await orch.addTask("task", { cwd: "/tmp" });
    expect(task.completedAt).toBeDefined();
    expect(new Date(task.completedAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });
});

// ─── LLM decomposition ────────────────────────────────────────────

describe("Orchestrator: LLM decomposition", () => {
  let originalBridgeDeps, originalOrchDeps;

  beforeEach(() => {
    originalBridgeDeps = { ...bridgeDeps };
    originalOrchDeps = { ...orchDeps };
  });

  afterEach(() => {
    Object.assign(bridgeDeps, originalBridgeDeps);
    Object.assign(orchDeps, originalOrchDeps);
    vi.clearAllMocks();
  });

  it("decomposes task into multiple subtasks", async () => {
    const { orch } = buildOrchestrator({
      decomposeTo: [
        { id: "s1", description: "subtask 1" },
        { id: "s2", description: "subtask 2" },
      ],
      ciPasses: true,
    });
    const task = await orch.addTask("large task", { cwd: "/tmp" });
    expect(task.subtasks).toHaveLength(2);
    expect(bridgeDeps.spawn).toHaveBeenCalledTimes(2);
  });

  it("falls back to single subtask when LLM returns invalid JSON", async () => {
    const { orch } = buildOrchestrator({ ciPasses: true });
    orch._chat = vi.fn(async () => "not valid json");

    const task = await orch.addTask("task", { cwd: "/tmp" });
    expect(task.subtasks).toHaveLength(1);
    expect(task.subtasks[0].description).toBe("task");
  });

  it("emits task:decomposed event with subtasks", async () => {
    const { orch } = buildOrchestrator({
      decomposeTo: [{ id: "s1", description: "sub" }],
      ciPasses: true,
    });
    const decomposedFn = vi.fn();
    orch.on("task:decomposed", decomposedFn);

    await orch.addTask("task", { cwd: "/tmp" });
    expect(decomposedFn).toHaveBeenCalledTimes(1);
    expect(decomposedFn.mock.calls[0][0].subtasks).toHaveLength(1);
  });
});

// ─── CI failure and retry ─────────────────────────────────────────

describe("Orchestrator: CI failure and retry", () => {
  let originalBridgeDeps, originalOrchDeps;

  beforeEach(() => {
    originalBridgeDeps = { ...bridgeDeps };
    originalOrchDeps = { ...orchDeps };
  });

  afterEach(() => {
    Object.assign(bridgeDeps, originalBridgeDeps);
    Object.assign(orchDeps, originalOrchDeps);
    vi.clearAllMocks();
  });

  it("retries when CI fails and eventually succeeds", async () => {
    let ciAttempt = 0;
    orchDeps.execSync = vi.fn(() => {
      ciAttempt++;
      if (ciAttempt < 2) {
        const err = new Error("CI failed");
        err.stdout = "FAIL\n✕ test\n";
        err.stderr = "";
        throw err;
      }
      return "passed";
    });

    bridgeDeps.spawn = vi.fn(() => makeChildProcess(AGENT_SUCCESS_OUTPUT, 0));
    bridgeDeps.execSync = vi.fn((cmd) => {
      if (cmd.includes("--version")) return "2.0.0";
      throw new Error("no codex");
    });

    const orch = new Orchestrator({
      cwd: "/tmp",
      maxParallel: 1,
      maxRetries: 2,
      ciCommand: "npm test",
    });
    orch._chat = vi.fn(async () =>
      JSON.stringify([{ id: "s1", description: "fix" }]),
    );

    const task = await orch.addTask("task", { cwd: "/tmp", notify: false });
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
    expect(task.retries).toBe(1);
    expect(ciAttempt).toBe(2);
  });

  it("fails task after exhausting max retries", async () => {
    orchDeps.execSync = vi.fn(() => {
      const err = new Error("CI failed");
      err.stdout = "FAIL\n";
      err.stderr = "";
      throw err;
    });

    bridgeDeps.spawn = vi.fn(() => makeChildProcess(AGENT_SUCCESS_OUTPUT, 0));
    bridgeDeps.execSync = vi.fn((cmd) => {
      if (cmd.includes("--version")) return "2.0.0";
      throw new Error("no codex");
    });

    const orch = new Orchestrator({
      cwd: "/tmp",
      maxParallel: 1,
      maxRetries: 1,
      ciCommand: "npm test",
    });
    orch._chat = vi.fn(async () =>
      JSON.stringify([{ id: "s1", description: "fix" }]),
    );

    const task = await orch.addTask("task", { cwd: "/tmp", notify: false });
    expect(task.status).toBe(TASK_STATUS.FAILED);
    expect(task.retries).toBeGreaterThan(0);
  });

  it("calls notifyFailure for each CI failure", async () => {
    let ciAttempt = 0;
    orchDeps.execSync = vi.fn(() => {
      ciAttempt++;
      if (ciAttempt < 3) {
        const err = new Error("failed");
        err.stdout = "FAIL\n";
        err.stderr = "";
        throw err;
      }
      return "passed";
    });

    bridgeDeps.spawn = vi.fn(() => makeChildProcess(AGENT_SUCCESS_OUTPUT, 0));
    bridgeDeps.execSync = vi.fn((cmd) => {
      if (cmd.includes("--version")) return "2.0.0";
      throw new Error("no codex");
    });

    const orch = new Orchestrator({
      cwd: "/tmp",
      maxParallel: 1,
      maxRetries: 3,
      ciCommand: "npm test",
    });
    orch._chat = vi.fn(async () =>
      JSON.stringify([{ id: "s1", description: "fix" }]),
    );
    const notifier = {
      isConfigured: true,
      notifyStart: vi.fn(() => Promise.resolve({ ok: true })),
      notifySuccess: vi.fn(() => Promise.resolve({ ok: true })),
      notifyFailure: vi.fn(() => Promise.resolve({ ok: true })),
    };
    orch.notifier.add("mock", notifier);

    await orch.addTask("task", { cwd: "/tmp", notify: true });
    expect(notifier.notifyFailure).toHaveBeenCalledTimes(2);
    expect(notifier.notifySuccess).toHaveBeenCalledTimes(1);
  });

  it("re-dispatches with error context on retry", async () => {
    let ciAttempt = 0;
    orchDeps.execSync = vi.fn(() => {
      ciAttempt++;
      if (ciAttempt < 2) {
        const err = new Error("failed");
        err.stdout = "Error: null reference\n";
        err.stderr = "";
        throw err;
      }
      return "passed";
    });

    const promptsSeen = [];
    bridgeDeps.spawn = vi.fn((_, args) => {
      promptsSeen.push(args[1]); // capture the -p argument
      return makeChildProcess(AGENT_SUCCESS_OUTPUT, 0);
    });
    bridgeDeps.execSync = vi.fn((cmd) => {
      if (cmd.includes("--version")) return "2.0.0";
      throw new Error("no codex");
    });

    const orch = new Orchestrator({
      cwd: "/tmp",
      maxParallel: 1,
      maxRetries: 2,
      ciCommand: "npm test",
    });
    orch._chat = vi.fn(async () =>
      JSON.stringify([{ id: "s1", description: "fix bug" }]),
    );
    await orch.addTask("task", { cwd: "/tmp", notify: false });

    // Retry prompt should include CI error context
    const retryPrompt = promptsSeen.find((p) =>
      p.includes("Previous attempt failed CI"),
    );
    expect(retryPrompt).toBeDefined();
    expect(retryPrompt).toContain("null reference");
  });
});

// ─── status() ─────────────────────────────────────────────────────

describe("Orchestrator: status()", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns tasks and pool info", () => {
    bridgeDeps.execSync = vi.fn(() => {
      throw new Error();
    });
    orchDeps.execSync = vi.fn(() => "ok");

    const orch = new Orchestrator({ cwd: "/tmp" });
    const s = orch.status();
    expect(s.tasks).toEqual([]);
    expect(s.pool).toBeDefined();
    expect(typeof s.cronActive).toBe("boolean");
  });
});

// ─── cron watch ───────────────────────────────────────────────────

describe("Orchestrator: cron watch", () => {
  afterEach(() => vi.clearAllMocks());

  it("starts and stops cron", () => {
    bridgeDeps.execSync = vi.fn(() => {
      throw new Error();
    });
    const orch = new Orchestrator({ cwd: "/tmp" });
    orch.startCronWatch(10_000);
    expect(orch._cronTimer).not.toBeNull();
    expect(orch.status().cronActive).toBe(true);
    orch.stopCronWatch();
    expect(orch._cronTimer).toBeNull();
  });

  it("does not create duplicate timers on multiple startCronWatch calls", () => {
    bridgeDeps.execSync = vi.fn(() => {
      throw new Error();
    });
    const orch = new Orchestrator({ cwd: "/tmp" });
    orch.startCronWatch(10_000);
    const timer1 = orch._cronTimer;
    orch.startCronWatch(10_000);
    expect(orch._cronTimer).toBe(timer1);
    orch.stopCronWatch();
  });
});
