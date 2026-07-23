import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncHookSupervisor } from "../../src/lib/async-hook-supervisor.cjs";
import {
  partitionAsyncHooks,
  dispatchAsyncHooks,
  runUserPromptSubmitHooks,
  runObserveHooks,
} from "../../src/lib/settings-hook-events.cjs";
import { collectHooks } from "../../src/lib/settings-hooks.cjs";

/**
 * A fake child process: an EventEmitter with stdin/stdout/stderr stubs that a
 * test drives explicitly (emit stdout data, then 'close'). No real shell — the
 * whole supervisor runs deterministically.
 */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = { end: () => {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  // helpers the test calls
  child._finish = (code, stdout = "", stderr = "") => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout, "utf8"));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr, "utf8"));
    child.emit("close", code);
  };
  return child;
}

/** A spawn stub that hands back a queue of fake children in order. */
function makeSpawn(children) {
  let i = 0;
  const calls = [];
  const spawn = (command, opts) => {
    calls.push({ command, opts });
    const c = children[i++];
    if (!c) throw new Error("spawn called more times than children provided");
    c._command = command;
    c._opts = opts;
    return c;
  };
  spawn.calls = calls;
  return spawn;
}

describe("AsyncHookSupervisor.dispatch (fire-and-forget)", () => {
  it("returns immediately and marks each hook dispatched (does not await)", () => {
    const children = [makeFakeChild(), makeFakeChild()];
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn(children) });
    const disp = sup.dispatch(
      [
        { command: "run-tests", event: "PostToolUse" },
        { command: "scan-logs", event: "PostToolUse" },
      ],
      { hook_event_name: "PostToolUse" },
    );
    // dispatch is synchronous — both are in-flight, none finished yet.
    expect(disp.every((d) => d.dispatched)).toBe(true);
    expect(sup.runningCount()).toBe(2);
    expect(sup.drainResults()).toEqual([]); // nothing completed yet
    sup.stopAll();
  });

  it("collects a successful hook's plain stdout as injectable context", () => {
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "echo-ctx", event: "PostToolUse" }], {});
    child._finish(0, "build is green\n");
    const results = sup.drainResults();
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].additionalContext).toBe("build is green");
    expect(sup.drainResults()).toEqual([]); // drain cleared it
    sup.stopAll();
  });

  it("parses a JSON additionalContext payload", () => {
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "j", event: "Stop" }], {});
    child._finish(0, JSON.stringify({ additionalContext: "note: 2 TODOs" }));
    const [r] = sup.drainResults();
    expect(r.ok).toBe(true);
    expect(r.additionalContext).toBe("note: 2 TODOs");
    sup.stopAll();
  });
});

describe("AsyncHookSupervisor rewake on failure", () => {
  it("flags a failed asyncRewake hook for rewake, but not a passing one", () => {
    const failChild = makeFakeChild();
    const okChild = makeFakeChild();
    const sup = new AsyncHookSupervisor({
      spawn: makeSpawn([failChild, okChild]),
    });
    sup.dispatch(
      [
        { command: "tests-fail", event: "PostToolUse", asyncRewake: true },
        { command: "tests-pass", event: "Stop", asyncRewake: true },
      ],
      {},
    );
    failChild._finish(1, "", "3 tests failed");
    okChild._finish(0, "ok");
    // Only the failing rewake hook is queued for rewake.
    expect(sup.hasRewake()).toBe(true);
    const rewakes = sup.drainRewakes();
    expect(rewakes).toHaveLength(1);
    expect(rewakes[0].command).toBe("tests-fail");
    expect(rewakes[0].error).toMatch(/3 tests failed/);
    expect(sup.hasRewake()).toBe(false); // drained
    sup.stopAll();
  });

  it("does NOT rewake a failed hook that did not opt in", () => {
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "noisy", event: "PostToolUse" }], {});
    child._finish(1, "", "boom");
    expect(sup.hasRewake()).toBe(false);
    expect(sup.drainResults()[0].ok).toBe(false); // still recorded as a result
    sup.stopAll();
  });

  it("treats a decision:block async hook as a failure for rewake", () => {
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "guard", event: "Stop", asyncRewake: true }], {});
    child._finish(0, JSON.stringify({ decision: "block", reason: "nope" }));
    const rewakes = sup.drainRewakes();
    expect(rewakes).toHaveLength(1);
    expect(rewakes[0].blocked).toBe(true);
    sup.stopAll();
  });
});

describe("AsyncHookSupervisor guardrails", () => {
  it("dedupes the same (event+command) while a prior run is in flight", () => {
    const child = makeFakeChild();
    const spawn = makeSpawn([child]); // only ONE child — a 2nd spawn would throw
    const sup = new AsyncHookSupervisor({ spawn });
    const hook = { command: "run-tests", event: "PostToolUse" };
    const first = sup.dispatch([hook], {});
    const second = sup.dispatch([hook], {}); // still running → deduped, no spawn
    expect(first[0].dispatched).toBe(true);
    expect(second[0].dispatched).toBe(false);
    expect(second[0].reason).toMatch(/deduped/);
    expect(spawn.calls).toHaveLength(1);
    // After it finishes, the same hook can dispatch again.
    child._finish(0, "done");
    sup.drainResults();
    const child2 = makeFakeChild();
    sup._deps.spawn = makeSpawn([child2]);
    const third = sup.dispatch([hook], {});
    expect(third[0].dispatched).toBe(true);
    sup.stopAll();
  });

  it("caps concurrency and records dropped hooks as visible skips", () => {
    const children = [makeFakeChild(), makeFakeChild()];
    const sup = new AsyncHookSupervisor({
      spawn: makeSpawn(children),
      maxConcurrent: 2,
    });
    const disp = sup.dispatch(
      [
        { command: "a", event: "E" },
        { command: "b", event: "E" },
        { command: "c", event: "E" }, // over the cap → dropped
      ],
      {},
    );
    expect(disp[0].dispatched).toBe(true);
    expect(disp[1].dispatched).toBe(true);
    expect(disp[2].dispatched).toBe(false);
    expect(disp[2].reason).toMatch(/max concurrent/);
    // The drop is a visible result, not silent.
    const skip = sup.drainResults().find((r) => r.command === "c");
    expect(skip.skipped).toBe(true);
    expect(skip.error).toMatch(/max concurrent/);
    sup.stopAll();
  });

  it("kills a hook that exceeds its timeout and records a timeout failure", async () => {
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn([child]) });
    // hook.timeout is in SECONDS; use a tiny value so the real timer fires fast.
    sup.dispatch(
      [{ command: "hang", event: "Stop", timeout: 0.01, asyncRewake: true }],
      {},
    );
    await new Promise((r) => setTimeout(r, 40));
    // The timer fired and SIGTERM'd the child; a real process would then emit
    // 'close'. Emit it so finalize runs (killedByTimeout is already latched).
    expect(child.killed).toBe(true);
    child.emit("close", null);
    const results = sup.peekResults();
    expect(results[0].error).toMatch(/timed out/);
    expect(sup.hasRewake()).toBe(true); // failed rewake hook → rewake queued
    sup.stopAll();
  });

  it("stopAll kills in-flight children and refuses further dispatch", () => {
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({ spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "long", event: "E" }], {});
    expect(sup.runningCount()).toBe(1);
    sup.stopAll();
    expect(child.killed).toBe(true);
    expect(sup.runningCount()).toBe(0);
    const disp = sup.dispatch([{ command: "another", event: "E" }], {});
    expect(disp[0].dispatched).toBe(false);
    expect(disp[0].reason).toMatch(/stopped/);
  });

  it("does NOT register a process 'exit' listener until a hook is dispatched", () => {
    // Leak guard: constructing a supervisor that never spawns (or the many built
    // in tests) must not leave a permanent exit listener behind.
    const before = process.listenerCount("exit");
    const sup = new AsyncHookSupervisor({
      spawn: makeSpawn([makeFakeChild()]),
    });
    expect(process.listenerCount("exit")).toBe(before); // ctor added nothing
    sup.dispatch([{ command: "x", event: "E" }], {});
    expect(process.listenerCount("exit")).toBe(before + 1); // armed on first spawn
    sup.stopAll();
    expect(process.listenerCount("exit")).toBe(before); // detached on stop
  });

  it("caps undrained results at the ring size (no unbounded growth)", () => {
    const sup = new AsyncHookSupervisor({ maxConcurrent: 1 });
    // Overflow the maxConcurrent skip-record path far past the ring cap without
    // ever draining. Hold one hook in-flight so every subsequent hook is skipped.
    sup.dispatch([{ command: "holder", event: "E" }], {});
    for (let i = 0; i < 1200; i++) {
      sup.dispatch([{ command: `spam-${i}`, event: "E" }], {});
    }
    expect(sup.peekResults().length).toBeLessThanOrEqual(500);
    sup.stopAll();
  });

  it("records a spawn failure as a non-blocking result", () => {
    const spawn = () => {
      throw new Error("ENOENT");
    };
    const sup = new AsyncHookSupervisor({ spawn });
    const disp = sup.dispatch([{ command: "missing", event: "E" }], {});
    expect(disp[0].dispatched).toBe(true); // we attempted it
    const [r] = sup.drainResults();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/spawn failed: ENOENT/);
    sup.stopAll();
  });
});

describe("AsyncHookSupervisor Windows process-tree fallback", () => {
  const processTable = [
    "Node,ParentProcessId,ProcessId",
    "HOST,10,100",
    "HOST,100,200",
    "HOST,200,300",
    "HOST,999,400",
    "",
  ].join("\r\n");

  it("builds only the requested descendant tree from one WMIC snapshot", () => {
    const calls = [];
    const sup = new AsyncHookSupervisor({
      platform: "win32",
      spawnSync(file, args) {
        calls.push([file, args]);
        return { status: 0, stdout: processTable, stderr: "" };
      },
    });

    expect(sup._windowsDescendantPids(100)).toEqual([200, 300]);
    expect(calls).toEqual([
      [
        "wmic",
        [
          "path",
          "Win32_Process",
          "get",
          "ParentProcessId,ProcessId",
          "/format:csv",
        ],
      ],
    ]);
    sup.stopAll();
  });

  it("kills snapshotted descendants leaf-first when taskkill is denied", () => {
    const killed = [];
    const childSignals = [];
    const sup = new AsyncHookSupervisor({
      platform: "win32",
      killProcess(pid, signal) {
        killed.push([pid, signal]);
      },
      spawnSync(file) {
        if (file === "wmic") {
          return { status: 0, stdout: processTable, stderr: "" };
        }
        return { status: 5, stdout: "", stderr: "Access is denied" };
      },
    });

    sup._killChildTree(
      {
        pid: 100,
        kill(signal) {
          childSignals.push(signal);
        },
      },
      "SIGTERM",
    );

    expect(killed).toEqual([
      [300, "SIGKILL"],
      [200, "SIGKILL"],
    ]);
    expect(childSignals).toEqual(["SIGTERM"]);
    sup.stopAll();
  });
});

describe("partitionAsyncHooks", () => {
  it("splits async:true off the blocking set", () => {
    const { sync, async } = partitionAsyncHooks([
      { command: "block-me", async: false },
      { command: "bg-tests", async: true },
      { command: "plain" }, // undefined → sync
    ]);
    expect(sync.map((h) => h.command)).toEqual(["block-me", "plain"]);
    expect(async.map((h) => h.command)).toEqual(["bg-tests"]);
  });

  it("handles empty / nullish input", () => {
    expect(partitionAsyncHooks(null)).toEqual({ sync: [], async: [] });
    expect(partitionAsyncHooks([])).toEqual({ sync: [], async: [] });
  });
});

describe("dispatchAsyncHooks", () => {
  const block = {
    UserPromptSubmit: [
      {
        matcher: "*",
        hooks: [
          { type: "command", command: "sync-guard" },
          { type: "command", command: "bg-check", async: true },
        ],
      },
    ],
  };

  it("dispatches only the async hooks onto the supervisor", () => {
    const dispatched = [];
    const fakeSup = {
      dispatch: (hooks) => {
        dispatched.push(...hooks.map((h) => h.command));
        return hooks.map((h) => ({ command: h.command, dispatched: true }));
      },
    };
    const disp = dispatchAsyncHooks(
      block,
      "UserPromptSubmit",
      { prompt: "hi" },
      { cwd: "/x", supervisor: fakeSup },
    );
    expect(dispatched).toEqual(["bg-check"]); // sync-guard NOT dispatched here
    expect(disp).toHaveLength(1);
  });

  it("is a no-op without a supervisor or without async hooks", () => {
    expect(dispatchAsyncHooks(block, "UserPromptSubmit", {}, {})).toEqual([]);
    const syncOnly = {
      UserPromptSubmit: [
        { matcher: "*", hooks: [{ type: "command", command: "only-sync" }] },
      ],
    };
    const sup = { dispatch: () => [{ dispatched: true }] };
    expect(
      dispatchAsyncHooks(syncOnly, "UserPromptSubmit", {}, { supervisor: sup }),
    ).toEqual([]);
  });
});

describe("runUserPromptSubmitHooks excludes async hooks from the blocking run", () => {
  // An async hook that would exit 2 (block) must NOT gate the turn — a
  // fire-and-forget hook can't decide a turn it no longer blocks. We prove the
  // exclusion two ways that don't depend on cross-module spawnSync identity
  // (vitest inlines CJS into a separate copy, so process-spying is unreliable):
  //   (1) an async-ONLY UserPromptSubmit set produces no blocking run at all;
  //   (2) the partition runUserPromptSubmitHooks feeds to the sync runner keeps
  //       only the sync hooks (block-guard), never the async one.
  it("returns a no-op result for an async-only UserPromptSubmit set", () => {
    const asyncOnly = {
      UserPromptSubmit: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "bg", async: true }],
        },
      ],
    };
    const res = runUserPromptSubmitHooks(asyncOnly, { prompt: "hi" });
    // No sync hooks → nothing can block, nothing to inject.
    expect(res).toEqual({ blocked: false, additionalContext: null });
  });

  it("partitions a mixed set so only sync hooks reach the blocking runner", () => {
    const mixed = {
      UserPromptSubmit: [
        {
          matcher: "*",
          hooks: [
            { type: "command", command: "block-guard" },
            { type: "command", command: "bg", async: true },
          ],
        },
      ],
    };
    const matched = collectHooks(mixed, "UserPromptSubmit", "");
    const { sync, async } = partitionAsyncHooks(matched);
    // runUserPromptSubmitHooks runs exactly `sync` via runHooks; `async` is
    // handed to the supervisor instead — so a blocking async hook never gates.
    expect(sync.map((h) => h.command)).toEqual(["block-guard"]);
    expect(async.map((h) => h.command)).toEqual(["bg"]);
  });
});

describe("runObserveHooks excludes async hooks from the sync run", () => {
  it("returns no results for an async-only Stop set (they fire-and-forget instead)", () => {
    const asyncOnlyStop = {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "bg-tests", async: true }],
        },
      ],
    };
    const outcome = runObserveHooks(asyncOnlyStop, "Stop", {}, { cwd: "/x" });
    // No sync Stop hooks → nothing ran synchronously (the async one is dispatched
    // separately by dispatchAsyncHooks; running it here too would double-execute).
    expect(outcome).toEqual({ decision: "continue", results: [] });
  });
});

describe("collectHooks carries async fields", () => {
  it("stamps event + async + asyncRewake through", () => {
    const block = {
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            { type: "command", command: "sync-guard" },
            {
              type: "command",
              command: "bg-tests",
              async: true,
              asyncRewake: true,
              timeout: 30,
            },
          ],
        },
      ],
    };
    const hooks = collectHooks(block, "PostToolUse", "write_file");
    expect(hooks).toHaveLength(2);
    expect(hooks[0]).toMatchObject({
      command: "sync-guard",
      event: "PostToolUse",
      async: false,
      asyncRewake: false,
    });
    expect(hooks[1]).toMatchObject({
      command: "bg-tests",
      event: "PostToolUse",
      async: true,
      asyncRewake: true,
      timeout: 30,
    });
  });
});

describe("AsyncHookSupervisor reliability stats (doctor)", () => {
  const require = createRequire(import.meta.url);
  const store = require("../../src/lib/hook-stats-store.cjs");

  it("aggregates completed runs in-memory (no path → hermetic, no write)", () => {
    const child = makeFakeChild();
    let t = 1000;
    const sup = new AsyncHookSupervisor({
      spawn: makeSpawn([child]),
      now: () => (t += 100),
    });
    sup.dispatch([{ command: "run-tests", event: "PostToolUse" }], {
      hook_event_name: "PostToolUse",
    });
    child._finish(1, "", "boom"); // non-zero exit → failure
    const agg = sup.getStatsAggregate();
    const entry = Object.values(agg)[0];
    expect(entry.runs).toBe(1);
    expect(entry.failures).toBe(1);
    expect(entry.consecutiveFailures).toBe(1);
    sup.stopAll(); // no hookStatsPath → no persistence, nothing to clean up
  });

  it("persists the aggregate to disk on stopAll when a path is set", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hooksup-"));
    const file = path.join(tmp, "hook-stats.json");
    try {
      const child = makeFakeChild();
      let t = 5000;
      const sup = new AsyncHookSupervisor({
        spawn: makeSpawn([child]),
        now: () => (t += 50),
        hookStatsPath: file,
      });
      sup.dispatch([{ command: "flaky-hook", event: "PostToolUse" }], {
        hook_event_name: "PostToolUse",
      });
      child._finish(2, "", "fail"); // failure
      sup.stopAll();

      const loaded = store.loadHookStats(file);
      const entry = Object.values(loaded)[0];
      expect(entry.command).toBe("flaky-hook");
      expect(entry.failures).toBe(1);
      // The in-memory delta was cleared after persist (no double count).
      expect(Object.keys(sup.getStatsAggregate()).length).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("AsyncHookSupervisor persistent rewake queue (crash recovery)", () => {
  const require = createRequire(import.meta.url);
  const queueStore = require("../../src/lib/async-hook-queue.cjs");
  const QFILE = "/virtual/async-hook-queue.json";

  // Exact-match in-memory fs (the queue only uses these five calls).
  function memFs() {
    const files = new Map();
    return {
      files,
      existsSync: (p) => files.has(p),
      readFileSync: (p) => {
        if (!files.has(p)) throw new Error("ENOENT " + p);
        return files.get(p);
      },
      writeFileSync: (p, d) => files.set(p, d),
      renameSync: (a, b) => {
        files.set(b, files.get(a));
        files.delete(a);
      },
      mkdirSync: () => {},
    };
  }

  function makeSup(qfs, extra = {}) {
    let t = 1000;
    return new AsyncHookSupervisor({
      now: () => (t += 100),
      sessionId: "sess-A",
      queuePath: QFILE,
      queueFs: qfs,
      ...extra,
    });
  }

  it("parks a FAILED rewake so a crash before drain can recover it", () => {
    const qfs = memFs();
    const child = makeFakeChild();
    const sup = makeSup(qfs, { spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "npm test", event: "Stop", asyncRewake: true }], {
      hook_event_name: "Stop",
    });
    child._finish(1, "", "1 failing"); // failure → rewake recorded + parked
    // Simulate a crash: the run never drained. A resuming session recovers it.
    const recovered = queueStore.takePending(
      { sessionId: "sess-A", now: 9999 },
      QFILE,
      qfs,
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0].command).toBe("npm test");
    expect(recovered[0].error).toContain("1 failing");
    sup.stopAll();
  });

  it("does NOT park a PASSING rewake hook (no failure to re-engage)", () => {
    const qfs = memFs();
    const child = makeFakeChild();
    const sup = makeSup(qfs, { spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "npm test", event: "Stop", asyncRewake: true }], {
      hook_event_name: "Stop",
    });
    child._finish(0, "all green"); // success → no rewake, nothing parked
    expect(
      queueStore.takePending({ sessionId: "sess-A", now: 9999 }, QFILE, qfs),
    ).toEqual([]);
    sup.stopAll();
  });

  it("drainRewakes clears the durable copy (consumed → not replayed on resume)", () => {
    const qfs = memFs();
    const child = makeFakeChild();
    const sup = makeSup(qfs, { spawn: makeSpawn([child]) });
    sup.dispatch([{ command: "npm test", event: "Stop", asyncRewake: true }], {
      hook_event_name: "Stop",
    });
    child._finish(1, "", "boom");
    const drained = sup.drainRewakes();
    expect(drained).toHaveLength(1);
    // The run consumed it → the durable bucket is gone.
    expect(
      queueStore.takePending({ sessionId: "sess-A", now: 9999 }, QFILE, qfs),
    ).toEqual([]);
    sup.stopAll();
  });

  it("writes NOTHING when the queue is not configured (byte-unchanged default)", () => {
    const qfs = memFs();
    // No sessionId / queuePath → queue disabled even with a fs handed in.
    let t = 1000;
    const child = makeFakeChild();
    const sup = new AsyncHookSupervisor({
      now: () => (t += 100),
      spawn: makeSpawn([child]),
      queueFs: qfs,
    });
    sup.dispatch([{ command: "npm test", event: "Stop", asyncRewake: true }], {
      hook_event_name: "Stop",
    });
    child._finish(1, "", "boom");
    expect(qfs.files.size).toBe(0); // no writes at all
    sup.stopAll();
  });
});
