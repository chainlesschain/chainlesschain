/**
 * SubRuntimePool — unit tests with a mocked spawn that simulates the
 * JSON-lines protocol. No real child processes are created.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const poolMod = require("../sub-runtime-pool.js");
const { SubRuntimePool } = poolMod;

/**
 * Build a fake child that mimics the sub-runtime protocol. The test
 * drives it via `fake.emitReady()`, `fake.emitLine()`, `fake.exit()`.
 */
function createFakeChild(script = {}) {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinWrites = [];
  const stdin = {
    destroyed: false,
    write: (chunk) => {
      stdinWrites.push(chunk);
    },
  };
  const child = new EventEmitter();
  child.stdout = stdoutEmitter;
  child.stderr = stderrEmitter;
  child.stdin = stdin;
  child.pid = 424242;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0, null);
  };

  const scheduled = {
    readyDelay: script.readyDelay ?? 0,
    runReply: script.runReply ?? null,
    readyWillTimeout: script.readyWillTimeout ?? false,
    onRun: script.onRun,
  };

  const writeLine = (obj) => {
    stdoutEmitter.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));
  };

  if (!scheduled.readyWillTimeout) {
    setImmediate(() => writeLine({ type: "ready" }));
  }

  // Intercept the first stdin write so we can react to the "run" cmd.
  const originalWrite = stdin.write;
  stdin.write = (chunk) => {
    stdinWrites.push(chunk);
    let msg;
    try {
      msg = JSON.parse(String(chunk).trim());
    } catch {
      return;
    }
    if (msg.cmd === "run") {
      if (scheduled.onRun) {
        scheduled.onRun({ msg, writeLine, child });
      } else if (scheduled.runReply) {
        for (const ev of scheduled.runReply) {
          writeLine(ev);
        }
      }
    }
  };

  return { child, stdinWrites, writeLine };
}

describe("SubRuntimePool", () => {
  let originalSpawn;
  let originalEntry;

  beforeEach(() => {
    originalSpawn = poolMod._deps.spawn;
    originalEntry = poolMod._deps.entryFile;
    poolMod._deps.entryFile = "/fake/sub-runtime.js";
  });
  afterEach(() => {
    poolMod._deps.spawn = originalSpawn;
    poolMod._deps.entryFile = originalEntry;
  });

  it("dispatch runs N assignments in parallel and returns ordered results", async () => {
    const spawnCalls = [];
    poolMod._deps.spawn = (execPath, args, options) => {
      spawnCalls.push({ execPath, args, options });
      const idx = spawnCalls.length - 1;
      const { child } = createFakeChild({
        onRun: ({ msg, writeLine }) => {
          setImmediate(() => {
            for (let i = 0; i < msg.assignment.steps.length; i += 1) {
              writeLine({
                type: "progress",
                memberId: `parent.m${idx}-executor`,
                step: msg.assignment.steps[i],
                index: i,
                total: msg.assignment.steps.length,
              });
            }
            writeLine({
              type: "done",
              memberId: `parent.m${idx}-executor`,
              success: true,
            });
          });
        },
      });
      return child;
    };

    const pool = new SubRuntimePool({ maxSize: 3, readyTimeoutMs: 500 });
    const results = await pool.dispatch({
      projectRoot: "/tmp/proj",
      sessionId: "parent",
      assignments: [
        { memberIdx: 0, role: "executor", steps: ["a1", "a2"] },
        { memberIdx: 1, role: "executor", steps: ["b1"] },
        { memberIdx: 2, role: "executor", steps: ["c1", "c2", "c3"] },
      ],
    });

    expect(spawnCalls).toHaveLength(3);
    // ELECTRON_RUN_AS_NODE must be set on every child.
    for (const call of spawnCalls) {
      expect(call.options.env.ELECTRON_RUN_AS_NODE).toBe("1");
      expect(call.args).toEqual(["/fake/sub-runtime.js"]);
    }

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.memberIdx)).toEqual([0, 1, 2]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].progressEvents).toHaveLength(2);
    expect(results[1].progressEvents).toHaveLength(1);
    expect(results[2].progressEvents).toHaveLength(3);

    await pool.shutdown();
  });

  it("reports error when child emits error event", async () => {
    poolMod._deps.spawn = () => {
      const { child } = createFakeChild({
        onRun: ({ writeLine }) => {
          setImmediate(() => {
            writeLine({ type: "error", error: "boom inside child" });
          });
        },
      });
      return child;
    };

    const pool = new SubRuntimePool({ maxSize: 2, readyTimeoutMs: 500 });
    const [res] = await pool.dispatch({
      projectRoot: "/tmp/proj",
      sessionId: "parent",
      assignments: [{ memberIdx: 0, role: "executor", steps: ["a"] }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/boom inside child/);
    await pool.shutdown();
  });

  it("reports error when child exits before done", async () => {
    poolMod._deps.spawn = () => {
      const { child } = createFakeChild({
        onRun: ({ child: c }) => {
          setImmediate(() => {
            c.emit("exit", 1, null);
          });
        },
      });
      return child;
    };

    const pool = new SubRuntimePool({ maxSize: 2, readyTimeoutMs: 500 });
    const [res] = await pool.dispatch({
      projectRoot: "/tmp/proj",
      sessionId: "parent",
      assignments: [{ memberIdx: 0, role: "executor", steps: ["a"] }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exited before done/);
    await pool.shutdown();
  });

  it("rejects when assignment count exceeds maxSize", async () => {
    poolMod._deps.spawn = () => createFakeChild({}).child;
    const pool = new SubRuntimePool({ maxSize: 2, readyTimeoutMs: 500 });
    await expect(
      pool.dispatch({
        projectRoot: "/tmp",
        sessionId: "p",
        assignments: [
          { memberIdx: 0, role: "executor", steps: [] },
          { memberIdx: 1, role: "executor", steps: [] },
          { memberIdx: 2, role: "executor", steps: [] },
        ],
      }),
    ).rejects.toThrow(/exceeds maxSize/);
    await pool.shutdown();
  });

  it("rejects on missing required args", async () => {
    const pool = new SubRuntimePool();
    await expect(pool.dispatch({})).rejects.toThrow(/required/);
  });

  it("returns [] for empty assignment list without spawning", async () => {
    const spawnCalls = [];
    poolMod._deps.spawn = () => {
      spawnCalls.push(1);
      return createFakeChild({}).child;
    };
    const pool = new SubRuntimePool();
    const results = await pool.dispatch({
      projectRoot: "/tmp",
      sessionId: "p",
      assignments: [],
    });
    expect(results).toEqual([]);
    expect(spawnCalls).toHaveLength(0);
  });

  it("maps a spawn-ready timeout to a failure result instead of hanging", async () => {
    poolMod._deps.spawn = () =>
      createFakeChild({ readyWillTimeout: true }).child;
    const pool = new SubRuntimePool({ maxSize: 1, readyTimeoutMs: 50 });
    const [res] = await pool.dispatch({
      projectRoot: "/tmp",
      sessionId: "p",
      assignments: [{ memberIdx: 0, role: "executor", steps: ["a"] }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/spawn failed.*ready timeout/);
    await pool.shutdown();
  });
});
