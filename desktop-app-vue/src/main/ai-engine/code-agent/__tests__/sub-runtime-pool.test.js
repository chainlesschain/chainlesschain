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

// ─────────────────────────────────────────────────────────────────────
// Phase B — structured-task scheduler helpers
// ─────────────────────────────────────────────────────────────────────

describe("scopePathsOverlap", () => {
  const { scopePathsOverlap } = poolMod;
  it("returns true for identical paths", () => {
    expect(scopePathsOverlap("src/main", "src/main")).toBe(true);
  });
  it("returns true when one is an ancestor of the other", () => {
    expect(scopePathsOverlap("src/main", "src/main/mcp")).toBe(true);
    expect(scopePathsOverlap("src/main/mcp/foo", "src/main")).toBe(true);
  });
  it("returns false for disjoint subtrees", () => {
    expect(scopePathsOverlap("src/main", "src/renderer")).toBe(false);
    expect(scopePathsOverlap("a/b/c", "a/b/d")).toBe(false);
  });
  it("normalizes backslashes and trailing separators", () => {
    expect(scopePathsOverlap("src\\main", "src/main/mcp/")).toBe(true);
  });
  it("does not confuse 'main' with 'main-foo'", () => {
    expect(scopePathsOverlap("src/main", "src/main-foo")).toBe(false);
  });
  it("returns false for non-string input", () => {
    expect(scopePathsOverlap(null, "src/main")).toBe(false);
    expect(scopePathsOverlap("src/main", undefined)).toBe(false);
  });
});

describe("hasScopeConflict", () => {
  const { hasScopeConflict } = poolMod;
  it("detects overlap across any pair in two scopePath sets", () => {
    expect(
      hasScopeConflict(
        { scopePaths: ["a/b", "x/y"] },
        { scopePaths: ["m/n", "x/y/z"] },
      ),
    ).toBe(true);
  });
  it("is permissive when either side has no declared scope", () => {
    expect(hasScopeConflict({ scopePaths: [] }, { scopePaths: ["a"] })).toBe(
      false,
    );
    expect(hasScopeConflict({}, { scopePaths: ["a"] })).toBe(false);
  });
  it("returns false for fully disjoint scopes", () => {
    expect(
      hasScopeConflict(
        { scopePaths: ["src/main"] },
        { scopePaths: ["src/renderer"] },
      ),
    ).toBe(false);
  });
});

describe("topoWaves", () => {
  const { topoWaves } = poolMod;

  it("returns [] for empty input", () => {
    expect(topoWaves([])).toEqual([]);
  });

  it("places independent tasks in a single wave", () => {
    const waves = topoWaves([
      { taskId: "a" },
      { taskId: "b" },
      { taskId: "c" },
    ]);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((t) => t.taskId).sort()).toEqual(["a", "b", "c"]);
  });

  it("orders linear chains by dependency", () => {
    const waves = topoWaves([
      { taskId: "c", dependsOn: ["b"] },
      { taskId: "a" },
      { taskId: "b", dependsOn: ["a"] },
    ]);
    expect(waves.map((w) => w.map((t) => t.taskId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("handles a diamond dependency graph", () => {
    const waves = topoWaves([
      { taskId: "root" },
      { taskId: "left", dependsOn: ["root"] },
      { taskId: "right", dependsOn: ["root"] },
      { taskId: "join", dependsOn: ["left", "right"] },
    ]);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((t) => t.taskId)).toEqual(["root"]);
    expect(waves[1].map((t) => t.taskId).sort()).toEqual(["left", "right"]);
    expect(waves[2].map((t) => t.taskId)).toEqual(["join"]);
  });

  it("ignores dependsOn entries that point outside the input set", () => {
    const waves = topoWaves([{ taskId: "a", dependsOn: ["does-not-exist"] }]);
    expect(waves).toEqual([[{ taskId: "a", dependsOn: ["does-not-exist"] }]]);
  });

  it("throws on a direct cycle", () => {
    expect(() =>
      topoWaves([
        { taskId: "a", dependsOn: ["b"] },
        { taskId: "b", dependsOn: ["a"] },
      ]),
    ).toThrow(/cycle detected/);
  });

  it("throws on a transitive cycle", () => {
    expect(() =>
      topoWaves([
        { taskId: "a", dependsOn: ["c"] },
        { taskId: "b", dependsOn: ["a"] },
        { taskId: "c", dependsOn: ["b"] },
      ]),
    ).toThrow(/cycle detected/);
  });

  it("skips assignments without taskId", () => {
    const waves = topoWaves([
      { taskId: "a" },
      { memberIdx: 0, role: "executor" }, // no taskId → dropped
    ]);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(1);
    expect(waves[0][0].taskId).toBe("a");
  });
});

describe("scopeGroups", () => {
  const { scopeGroups } = poolMod;

  it("returns each task as its own group when no scopes overlap", () => {
    const groups = scopeGroups([
      { taskId: "a", scopePaths: ["src/main"] },
      { taskId: "b", scopePaths: ["src/renderer"] },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length)).toEqual([1, 1]);
  });

  it("unions tasks that share a subtree", () => {
    const groups = scopeGroups([
      { taskId: "a", scopePaths: ["src/main"] },
      { taskId: "b", scopePaths: ["src/main/mcp"] },
      { taskId: "c", scopePaths: ["src/renderer"] },
    ]);
    const sortedSizes = groups.map((g) => g.length).sort();
    expect(sortedSizes).toEqual([1, 2]);
    // The 2-task group must contain exactly {a, b}.
    const pairGroup = groups.find((g) => g.length === 2);
    expect(pairGroup.map((t) => t.taskId).sort()).toEqual(["a", "b"]);
  });

  it("chains transitively overlapping scopes into a single group", () => {
    const groups = scopeGroups([
      { taskId: "a", scopePaths: ["x/y"] },
      { taskId: "b", scopePaths: ["x/y/z"] },
      { taskId: "c", scopePaths: ["x/y/z/w"] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("treats missing scopePaths as non-conflicting (permissive)", () => {
    const groups = scopeGroups([{ taskId: "a" }, { taskId: "b" }]);
    expect(groups).toHaveLength(2);
  });
});

describe("SubRuntimePool._dispatchStructured", () => {
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

  // Minimal fake that replies "done" immediately for every run command.
  function mockAllSucceed(log) {
    poolMod._deps.spawn = (_execPath, _args, _options) => {
      const { child } = createFakeChild({
        onRun: ({ msg, writeLine }) => {
          log.push(msg.assignment.taskId || `idx-${msg.assignment.memberIdx}`);
          setImmediate(() => {
            writeLine({
              type: "done",
              memberId: `${msg.sessionId}.m${msg.assignment.memberIdx}-${msg.assignment.role}`,
              success: true,
            });
          });
        },
      });
      return child;
    };
  }

  it("auto-selects structured mode when assignments carry taskId", async () => {
    const runLog = [];
    mockAllSucceed(runLog);

    const pool = new SubRuntimePool({ maxSize: 6, readyTimeoutMs: 500 });
    const results = await pool.dispatch({
      projectRoot: "/tmp",
      sessionId: "sess",
      assignments: [
        {
          memberIdx: 0,
          taskId: "t-root",
          role: "executor",
          steps: ["root"],
          scopePaths: ["src/main"],
          dependsOn: [],
        },
        {
          memberIdx: 1,
          taskId: "t-leaf",
          role: "tester",
          steps: ["leaf"],
          scopePaths: ["tests/unit"],
          dependsOn: ["t-root"],
        },
      ],
    });

    // Order preserved matches input.
    expect(results.map((r) => r.taskId)).toEqual(["t-root", "t-leaf"]);
    expect(results.every((r) => r.success)).toBe(true);
    // Root must have run before leaf (wave barrier).
    expect(runLog.indexOf("t-root")).toBeLessThan(runLog.indexOf("t-leaf"));
    await pool.shutdown();
  });

  it("structured mode does not enforce the legacy maxSize cap", async () => {
    const runLog = [];
    mockAllSucceed(runLog);

    // 4 independent tasks in a pool with maxSize=2. Legacy path would
    // throw; structured path runs them as one wave with scope groups.
    const pool = new SubRuntimePool({ maxSize: 2, readyTimeoutMs: 500 });
    const results = await pool.dispatch({
      projectRoot: "/tmp",
      sessionId: "sess",
      assignments: [
        { memberIdx: 0, taskId: "a", role: "executor", steps: [] },
        { memberIdx: 1, taskId: "b", role: "executor", steps: [] },
        { memberIdx: 2, taskId: "c", role: "executor", steps: [] },
        { memberIdx: 3, taskId: "d", role: "executor", steps: [] },
      ],
    });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.success)).toBe(true);
    await pool.shutdown();
  });

  it("serializes tasks sharing a scope path within a wave", async () => {
    const runLog = [];
    // Capture the *order* of run commands (not just their presence) to
    // verify serialization of the a/b pair.
    poolMod._deps.spawn = (_e, _a, _o) => {
      const { child } = createFakeChild({
        onRun: ({ msg, writeLine }) => {
          const id = msg.assignment.taskId;
          runLog.push({ phase: "start", id });
          // 10 ms "work" so the scheduler has time to interleave if it
          // does not serialize.
          setTimeout(() => {
            runLog.push({ phase: "end", id });
            writeLine({
              type: "done",
              memberId: msg.sessionId + "." + id,
              success: true,
            });
          }, 10);
        },
      });
      return child;
    };

    const pool = new SubRuntimePool({ maxSize: 4, readyTimeoutMs: 500 });
    await pool.dispatch({
      projectRoot: "/tmp",
      sessionId: "sess",
      assignments: [
        {
          memberIdx: 0,
          taskId: "a",
          role: "executor",
          steps: [],
          scopePaths: ["src/main"],
        },
        {
          memberIdx: 1,
          taskId: "b",
          role: "executor",
          steps: [],
          scopePaths: ["src/main/mcp"], // overlaps with a → serialized
        },
        {
          memberIdx: 2,
          taskId: "c",
          role: "executor",
          steps: [],
          scopePaths: ["src/renderer"], // independent → parallel
        },
      ],
    });

    // Extract start order and verify a ends before b starts (or b ends
    // before a starts — either ordering proves serialization).
    const aStart = runLog.findIndex((e) => e.phase === "start" && e.id === "a");
    const aEnd = runLog.findIndex((e) => e.phase === "end" && e.id === "a");
    const bStart = runLog.findIndex((e) => e.phase === "start" && e.id === "b");
    const bEnd = runLog.findIndex((e) => e.phase === "end" && e.id === "b");
    const aBeforeB = aEnd < bStart;
    const bBeforeA = bEnd < aStart;
    expect(aBeforeB || bBeforeA).toBe(true);
    await pool.shutdown();
  });

  it("marks downstream tasks as blocked when a dependency fails", async () => {
    poolMod._deps.spawn = (_e, _a, _o) => {
      const { child } = createFakeChild({
        onRun: ({ msg, writeLine }) => {
          const id = msg.assignment.taskId;
          setImmediate(() => {
            if (id === "root") {
              writeLine({ type: "error", error: "root blew up" });
            } else {
              writeLine({
                type: "done",
                memberId: msg.sessionId + "." + id,
                success: true,
              });
            }
          });
        },
      });
      return child;
    };

    const pool = new SubRuntimePool({ maxSize: 4, readyTimeoutMs: 500 });
    const results = await pool.dispatch({
      projectRoot: "/tmp",
      sessionId: "sess",
      assignments: [
        { memberIdx: 0, taskId: "root", role: "executor", steps: [] },
        {
          memberIdx: 1,
          taskId: "child",
          role: "executor",
          steps: [],
          dependsOn: ["root"],
        },
      ],
    });
    const root = results.find((r) => r.taskId === "root");
    const childR = results.find((r) => r.taskId === "child");
    expect(root.success).toBe(false);
    expect(root.error).toMatch(/root blew up/);
    expect(childR.success).toBe(false);
    expect(childR.blocked).toBe(true);
    expect(childR.error).toMatch(/blocked by failed dependency: root/);
    await pool.shutdown();
  });
});
