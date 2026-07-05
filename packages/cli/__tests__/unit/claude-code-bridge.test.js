/**
 * Unit tests: claude-code-bridge
 * Tests ClaudeCodeAgent, ClaudeCodePool, detectClaudeCode, detectCodex
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  _deps,
  detectClaudeCode,
  detectCodex,
  ClaudeCodeAgent,
  ClaudeCodePool,
  AGENT_STATUS,
} from "../../src/lib/claude-code-bridge.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeChildProcess({
  stdout = "",
  stderr = "",
  exitCode = 0,
  errorMsg = null,
} = {}) {
  const { EventEmitter } = require("events");
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  process.nextTick(() => {
    if (errorMsg) {
      proc.emit("error", new Error(errorMsg));
      return;
    }
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });

  return proc;
}

// ─── detectClaudeCode ─────────────────────────────────────────────

describe("detectClaudeCode", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  it("returns found=true with version when claude is installed", () => {
    _deps.execSync = vi.fn(() => "2.1.81 (Claude Code)");
    const result = detectClaudeCode();
    expect(result.found).toBe(true);
    expect(result.version).toBe("2.1.81 (Claude Code)");
    expect(_deps.execSync).toHaveBeenCalledWith(
      "claude --version",
      expect.any(Object),
    );
  });

  it("returns found=false when claude is not installed", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("not found");
    });
    const result = detectClaudeCode();
    expect(result.found).toBe(false);
    expect(result.version).toBeUndefined();
  });
});

// ─── detectCodex ──────────────────────────────────────────────────

describe("detectCodex", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  it("returns found=true with version when codex is installed", () => {
    _deps.execSync = vi.fn(() => "codex 1.0.0");
    const result = detectCodex();
    expect(result.found).toBe(true);
    expect(result.version).toBe("codex 1.0.0");
  });

  it("returns found=false when codex is not installed", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("not found");
    });
    const result = detectCodex();
    expect(result.found).toBe(false);
  });
});

// ─── ClaudeCodeAgent ──────────────────────────────────────────────

describe("ClaudeCodeAgent", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  it("initialises with IDLE status", () => {
    const agent = new ClaudeCodeAgent({ id: "a1" });
    expect(agent.id).toBe("a1");
    expect(agent.status).toBe(AGENT_STATUS.IDLE);
    expect(agent.currentTask).toBeNull();
  });

  it("executes task successfully with exit code 0", async () => {
    const jsonLine = JSON.stringify({ type: "result", result: "Done!" });
    _deps.spawn = vi.fn(() =>
      makeChildProcess({ stdout: jsonLine + "\n", exitCode: 0 }),
    );

    const agent = new ClaudeCodeAgent({ id: "a2", cliCommand: "claude" });
    const result = await agent.executeTask("Fix the bug", { cwd: "/tmp" });

    expect(result.success).toBe(true);
    expect(result.output).toBe("Done!");
    expect(result.exitCode).toBe(0);
    expect(agent.status).toBe(AGENT_STATUS.COMPLETED);
    expect(_deps.spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "Fix the bug",
        "--output-format",
        "stream-json",
      ]),
      expect.objectContaining({ cwd: "/tmp" }),
    );
  });

  it("reassembles a multi-byte UTF-8 char split across stdout chunks (no mojibake)", async () => {
    const { EventEmitter } = require("events");
    const line = JSON.stringify({ type: "result", result: "你好世界" }) + "\n";
    const buf = Buffer.from(line, "utf-8");
    const cut = buf.indexOf(Buffer.from("你", "utf-8")) + 1; // 1 byte into 你
    _deps.spawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      process.nextTick(() => {
        proc.stdout.emit("data", buf.subarray(0, cut));
        proc.stdout.emit("data", buf.subarray(cut));
        proc.emit("close", 0);
      });
      return proc;
    });
    const agent = new ClaudeCodeAgent({ id: "utf8", cliCommand: "claude" });
    const result = await agent.executeTask("hi", { cwd: "/tmp" });
    expect(result.output).toBe("你好世界"); // intact, not "�好世界"
    expect(result.rawOutput).not.toContain("�");
  });

  it("bounds retained output (tail-kept) when the child floods stdout past the cap", async () => {
    const { EventEmitter } = require("events");
    const resultLine =
      JSON.stringify({ type: "result", result: "FINAL-ANSWER" }) + "\n";
    _deps.spawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      process.nextTick(() => {
        // 20 noisy ~1 KB stream-json-style lines, then the terminal result line.
        // Newline-terminated so the surviving tail stays line-parseable.
        for (let i = 0; i < 20; i++) {
          proc.stdout.emit("data", Buffer.from("x".repeat(1023) + "\n"));
        }
        proc.stdout.emit("data", Buffer.from(resultLine));
        proc.emit("close", 0);
      });
      return proc;
    });
    const agent = new ClaudeCodeAgent({ id: "flood", cliCommand: "claude" });
    // Cap at 4 KB → the ~20 KB of noise must be dropped from the front.
    const result = await agent.executeTask("noisy", {
      cwd: "/tmp",
      maxOutputBytes: 4096,
    });

    expect(result.outputTruncated).toBe(true);
    // Memory is bounded near the cap, not the full ~21 KB.
    expect(Buffer.byteLength(result.rawOutput)).toBeLessThanOrEqual(
      4096 + 1024,
    );
    // The tail (terminal result line) survived, so parsing still works.
    expect(result.output).toBe("FINAL-ANSWER");
  });

  it("marks task as FAILED when exit code is non-zero", async () => {
    _deps.spawn = vi.fn(() => makeChildProcess({ stdout: "", exitCode: 1 }));
    const agent = new ClaudeCodeAgent({ id: "a3" });
    const result = await agent.executeTask("task", { cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(agent.status).toBe(AGENT_STATUS.FAILED);
  });

  it("marks task as TIMEOUT when process hangs", async () => {
    const { EventEmitter } = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    // Simulate OS killing the process after SIGTERM
    proc.kill = vi.fn(() => process.nextTick(() => proc.emit("close", null)));

    _deps.spawn = vi.fn(() => proc);
    const agent = new ClaudeCodeAgent({ id: "a4" });
    const result = await agent.executeTask("hang", {
      cwd: "/tmp",
      timeout: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  }, 10000);

  it("handles spawn error gracefully", async () => {
    _deps.spawn = vi.fn(() =>
      makeChildProcess({ errorMsg: "ENOENT: command not found" }),
    );
    const agent = new ClaudeCodeAgent({ id: "a5" });
    const result = await agent.executeTask("task", { cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  it("prepends context to prompt when context is provided", async () => {
    _deps.spawn = vi.fn(() => makeChildProcess({ exitCode: 0 }));
    const agent = new ClaudeCodeAgent({ id: "a6" });
    await agent.executeTask("Fix X", {
      cwd: "/tmp",
      context: "Stack trace here",
    });
    const callArgs = _deps.spawn.mock.calls[0][1];
    const promptIdx = callArgs.indexOf("-p");
    expect(callArgs[promptIdx + 1]).toContain("Context:");
    expect(callArgs[promptIdx + 1]).toContain("Stack trace here");
  });

  it("passes --model flag when model is set", async () => {
    _deps.spawn = vi.fn(() => makeChildProcess({ exitCode: 0 }));
    const agent = new ClaudeCodeAgent({ id: "a7", model: "claude-opus-4-6" });
    await agent.executeTask("task", { cwd: "/tmp" });
    const callArgs = _deps.spawn.mock.calls[0][1];
    expect(callArgs).toContain("--model");
    expect(callArgs).toContain("claude-opus-4-6");
  });

  it("emits task:start and task:complete events", async () => {
    _deps.spawn = vi.fn(() => makeChildProcess({ exitCode: 0 }));
    const agent = new ClaudeCodeAgent({ id: "a8" });
    const startFn = vi.fn();
    const completeFn = vi.fn();
    agent.on("task:start", startFn);
    agent.on("task:complete", completeFn);

    await agent.executeTask("task", { cwd: "/tmp" });
    expect(startFn).toHaveBeenCalledTimes(1);
    expect(completeFn).toHaveBeenCalledTimes(1);
  });

  it("abort() kills running process", async () => {
    const { EventEmitter } = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();

    _deps.spawn = vi.fn(() => proc);
    const agent = new ClaudeCodeAgent({ id: "a9" });

    const taskPromise = agent.executeTask("task", {
      cwd: "/tmp",
      timeout: 30000,
    });
    agent.abort();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    // Clean up — emit close so the promise resolves
    proc.emit("close", 1);
    await taskPromise;
  });

  it("toJSON returns correct shape", () => {
    const agent = new ClaudeCodeAgent({ id: "a10", cliCommand: "codex" });
    const json = agent.toJSON();
    expect(json.id).toBe("a10");
    expect(json.cliCommand).toBe("codex");
    expect(json.status).toBe(AGENT_STATUS.IDLE);
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const { EventEmitter } = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    // Ignores SIGTERM; only dies (emits close) once SIGKILL arrives.
    proc.kill = vi.fn((sig) => {
      if (sig === "SIGKILL") process.nextTick(() => proc.emit("close", null));
    });
    _deps.spawn = vi.fn(() => proc);

    const agent = new ClaudeCodeAgent({ id: "kt1" });
    const result = await agent.executeTask("hang", {
      cwd: "/tmp",
      timeout: 20,
      killGraceMs: 20,
    });

    expect(result.timedOut).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  }, 10000);

  it("does not fire a redundant SIGKILL when SIGTERM kills the process promptly", async () => {
    const { EventEmitter } = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    // Dies immediately on SIGTERM — the escalation timer must be cleared.
    proc.kill = vi.fn((sig) => {
      if (sig === "SIGTERM") process.nextTick(() => proc.emit("close", null));
    });
    _deps.spawn = vi.fn(() => proc);

    const agent = new ClaudeCodeAgent({ id: "kt2" });
    const result = await agent.executeTask("hang", {
      cwd: "/tmp",
      timeout: 20,
      killGraceMs: 30,
    });

    expect(result.timedOut).toBe(true);
    // Wait past the (short) grace; the cleared timer must not fire SIGKILL.
    await new Promise((r) => setTimeout(r, 80));
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
  }, 10000);
});

// ─── ClaudeCodePool ───────────────────────────────────────────────

describe("ClaudeCodePool", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  it("dispatches tasks in parallel batches", async () => {
    let spawnCount = 0;
    _deps.spawn = vi.fn(() => {
      spawnCount++;
      return makeChildProcess({
        stdout: JSON.stringify({ type: "result", result: "ok" }) + "\n",
        exitCode: 0,
      });
    });

    const pool = new ClaudeCodePool({ maxParallel: 2, cliCommand: "claude" });
    const tasks = [
      { id: "t1", description: "task 1" },
      { id: "t2", description: "task 2" },
      { id: "t3", description: "task 3" },
    ];

    const results = await pool.dispatch(tasks, { cwd: "/tmp" });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(spawnCount).toBe(3);
  });

  it("status() returns pool state", () => {
    const pool = new ClaudeCodePool({ maxParallel: 4, cliCommand: "codex" });
    const status = pool.status();
    expect(status.maxParallel).toBe(4);
    expect(status.cliCommand).toBe("codex");
    expect(status.activeCount).toBe(0);
  });

  it("bounds _completed history to maxCompleted (no unbounded leak)", async () => {
    _deps.spawn = vi.fn(() =>
      makeChildProcess({
        stdout: JSON.stringify({ type: "result", result: "ok" }) + "\n",
        exitCode: 0,
      }),
    );
    expect(new ClaudeCodePool().maxCompleted).toBe(1000); // default
    expect(new ClaudeCodePool({ maxCompleted: 0 }).maxCompleted).toBe(1000); // invalid → default

    const pool = new ClaudeCodePool({ maxParallel: 5, maxCompleted: 3 });
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      description: "x",
    }));
    await pool.dispatch(tasks, { cwd: "/tmp" });

    // All 12 ran, but only the most recent 3 are retained.
    expect(pool._completed.length).toBe(3);
    expect(pool._completed.map((c) => c.taskId)).toEqual(["t9", "t10", "t11"]);
  });

  it("forwards agent:output events from agents", async () => {
    _deps.spawn = vi.fn(() =>
      makeChildProcess({
        stdout: JSON.stringify({ type: "result", result: "r" }) + "\n",
        exitCode: 0,
      }),
    );

    const pool = new ClaudeCodePool({ maxParallel: 1 });
    const outputFn = vi.fn();
    pool.on("agent:output", outputFn);

    await pool.dispatch([{ id: "t1", description: "task" }], { cwd: "/tmp" });
    // The pool re-emits each agent's `output` chunk as `agent:output`
    // (claude-code-bridge.js:349). The fake child emits one stdout chunk, so the
    // listener must have fired with that chunk carrying an agentId.
    expect(outputFn).toHaveBeenCalled();
    const ev = outputFn.mock.calls[0][0];
    expect(ev).toHaveProperty("agentId");
    expect(ev.chunk).toContain("result");
  });

  it("includes taskId in each result", async () => {
    _deps.spawn = vi.fn(() => makeChildProcess({ exitCode: 0 }));
    const pool = new ClaudeCodePool({ maxParallel: 1 });
    const [result] = await pool.dispatch(
      [{ id: "my-task", description: "x" }],
      { cwd: "/tmp" },
    );
    expect(result.taskId).toBe("my-task");
  });
});

// ─── stream-json parser (internal _parseStreamJson via output field) ──

describe("stream-json output parsing", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  it("extracts text from result line", async () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "thinking..." }] },
      }),
      JSON.stringify({ type: "result", result: "Final answer here" }),
    ].join("\n");

    _deps.spawn = vi.fn(() =>
      makeChildProcess({ stdout: lines + "\n", exitCode: 0 }),
    );

    const agent = new ClaudeCodeAgent({ id: "p1" });
    const result = await agent.executeTask("task", { cwd: "/tmp" });
    expect(result.output).toBe("Final answer here");
  });

  it("falls back to last assistant text when no result line", async () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "I did X" }] },
      }),
    ].join("\n");

    _deps.spawn = vi.fn(() =>
      makeChildProcess({ stdout: lines + "\n", exitCode: 0 }),
    );

    const agent = new ClaudeCodeAgent({ id: "p2" });
    const result = await agent.executeTask("task", { cwd: "/tmp" });
    expect(result.output).toContain("I did X");
  });
});
