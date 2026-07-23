import { describe, it, expect, afterEach, vi } from "vitest";
import {
  executeTool,
  listBackgroundShellTasks,
  killAllBackgroundShellTasks,
  killAllBackgroundShellTasksSync,
  reapIdleBackgroundShellTasks,
  _backgroundProcessDeps,
  _runBackgroundTaskkill,
} from "../../src/runtime/agent-core.js";

// run_shell { run_in_background:true } + check_shell polling pair (Claude-Code
// style run_in_background + BashOutput). These exercise the real spawn path, so
// the commands are short, deterministic Node one-liners that work on any OS.

const NODE = process.execPath; // absolute path to the running node binary

describe("agent-core Windows taskkill process broker adapter", () => {
  it("routes async and sync tree kills with literal argv", () => {
    const originalRun = _backgroundProcessDeps.run;
    const originalRunSync = _backgroundProcessDeps.runSync;
    const run = vi.fn(() => ({ once: vi.fn() }));
    const runSync = vi.fn(() => ({ status: 0 }));
    _backgroundProcessDeps.run = run;
    _backgroundProcessDeps.runSync = runSync;

    try {
      _runBackgroundTaskkill(4242);
      _runBackgroundTaskkill(4242, { sync: true });

      const expectedOptions = expect.objectContaining({
        windowsHide: true,
        origin: "agent-core:background-taskkill",
        policy: "allow",
        scope: "agent-core",
      });
      expect(run).toHaveBeenCalledWith(
        "taskkill",
        ["/pid", "4242", "/T", "/F"],
        expectedOptions,
      );
      expect(runSync).toHaveBeenCalledWith(
        "taskkill",
        ["/pid", "4242", "/T", "/F"],
        expectedOptions,
      );
    } finally {
      _backgroundProcessDeps.run = originalRun;
      _backgroundProcessDeps.runSync = originalRunSync;
    }
  });
});

// Poll check_shell until the task leaves the "running" state or we give up.
// check_shell returns output incrementally (only what's new since the last
// poll, like Claude Code's BashOutput), so accumulate stdout/stderr across
// polls — the agent likewise retains earlier chunks in its message history.
async function pollUntilDone(taskId, { tries = 150, intervalMs = 20 } = {}) {
  let last;
  let stdout = "";
  let stderr = "";
  for (let i = 0; i < tries; i++) {
    last = await executeTool("check_shell", { task_id: taskId }, {});
    stdout += last.stdout || "";
    stderr += last.stderr || "";
    if (last.status !== "running") break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ...last, stdout, stderr };
}

// Kill every background task and wait until none are still running. Killing is
// async (the process tree dies, then its 'close' event flips status), so a
// synchronous killAll alone leaves tasks transiently "running" — tests that
// assert a clean registry must await this.
async function drainAllTasks({ tries = 200, intervalMs = 20 } = {}) {
  killAllBackgroundShellTasks();
  for (let i = 0; i < tries; i++) {
    const running = listBackgroundShellTasks().filter(
      (t) => t.status === "running",
    );
    if (running.length === 0) return;
    killAllBackgroundShellTasks(); // re-signal any that haven't died yet
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("agent-core run_shell background + check_shell", () => {
  afterEach(async () => {
    await drainAllTasks();
  });

  it("run_in_background returns a task_id immediately without blocking", async () => {
    const res = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},300)"`,
        run_in_background: true,
      },
      {},
    );
    expect(res.background).toBe(true);
    expect(typeof res.task_id).toBe("string");
    expect(res.task_id).toMatch(/^bg_/);
    expect(res.status).toBe("running");
    expect(res.error).toBeUndefined();
  });

  it("check_shell streams stdout and reports exit code 0 on completion", async () => {
    const start = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "process.stdout.write('bg-out-marker')"`,
        run_in_background: true,
      },
      {},
    );
    const done = await pollUntilDone(start.task_id);
    expect(done.status).toBe("exited");
    expect(done.running).toBe(false);
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain("bg-out-marker");
  });

  it("a non-zero exit is reported as status 'failed' with the exit code", async () => {
    const start = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "process.exit(3)"`,
        run_in_background: true,
      },
      {},
    );
    const done = await pollUntilDone(start.task_id);
    expect(done.status).toBe("failed");
    expect(done.exitCode).toBe(3);
  });

  it("check_shell incremental reads do not re-return consumed output", async () => {
    const start = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "process.stdout.write('first-chunk')"`,
        run_in_background: true,
      },
      {},
    );
    const done = await pollUntilDone(start.task_id);
    expect(done.stdout).toContain("first-chunk");
    // A second poll after completion has already consumed the buffer.
    const again = await executeTool(
      "check_shell",
      { task_id: start.task_id },
      {},
    );
    expect(again.stdout).toBe("");
    expect(again.status).toBe("exited");
  });

  it("check_shell with an unknown task_id returns an error + task list", async () => {
    const res = await executeTool(
      "check_shell",
      { task_id: "bg_does_not_exist" },
      {},
    );
    expect(res.error).toMatch(/No background shell task/);
    expect(Array.isArray(res.tasks)).toBe(true);
  });

  it("check_shell with no task_id lists known background tasks", async () => {
    const start = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},300)"`,
        run_in_background: true,
      },
      {},
    );
    const res = await executeTool("check_shell", {}, {});
    expect(Array.isArray(res.tasks)).toBe(true);
    expect(res.tasks.some((t) => t.id === start.task_id)).toBe(true);
  });

  it("check_shell { kill:true } terminates a running task", async () => {
    const start = await executeTool(
      "run_shell",
      {
        // Long sleep so the kill lands while it is still running.
        command: `${NODE} -e "setTimeout(()=>{},10000)"`,
        run_in_background: true,
      },
      {},
    );
    const killRes = await executeTool(
      "check_shell",
      { task_id: start.task_id, kill: true },
      {},
    );
    expect(killRes.killed).toBe(true);
    // SIGTERM→'close' on a node child can exceed the default 3s poll
    // budget on a loaded CI runner (ubuntu shard 3/4, 2026-06-11) — give
    // the kill path a 10s ceiling; it resolves in ~100ms when unloaded.
    const done = await pollUntilDone(start.task_id, { tries: 500 });
    expect(done.running).toBe(false);
  });

  it("listBackgroundShellTasks reflects spawned tasks", async () => {
    const before = listBackgroundShellTasks().length;
    await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},300)"`,
        run_in_background: true,
      },
      {},
    );
    expect(listBackgroundShellTasks().length).toBe(before + 1);
  });

  // P1-2 (terminal-context): the snapshot is shown to the model / rendered in
  // /tasks, so a secret embedded in the command must be redacted, and a running
  // task must surface its pid and be marked stoppable.
  it("redacts secrets in the command and surfaces pid + stoppable", async () => {
    const SECRET = "sk-abcdef0123456789abcdef0123456789abcdef01";
    const start = await executeTool(
      "run_shell",
      {
        // The token is a trailing argv the -e script ignores; the process stays
        // alive so we observe a running snapshot before afterEach drains it.
        command: `${NODE} -e "setTimeout(()=>{},60000)" ${SECRET}`,
        run_in_background: true,
      },
      {},
    );
    const snap = listBackgroundShellTasks().find((t) => t.id === start.task_id);
    expect(snap).toBeDefined();
    expect(snap.command).not.toContain(SECRET);
    expect(snap.command).toContain("[REDACTED]");
    expect(Number.isInteger(snap.pid) && snap.pid > 0).toBe(true);
    expect(snap.stoppable).toBe(true);
  });
});

describe("agent-core run_shell configurable foreground timeout", () => {
  it("a tiny timeout aborts a slow synchronous command", async () => {
    const res = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},2000)"`,
        timeout: 100,
      },
      {},
    );
    expect(res.error).toBeTruthy();
    expect(res.stdout).toBeUndefined();
  });

  it("default timeout still runs a fast synchronous command", async () => {
    const res = await executeTool(
      "run_shell",
      { command: `${NODE} -e "process.stdout.write('fast')"` },
      {},
    );
    expect(res.error).toBeUndefined();
    expect(res.stdout).toContain("fast");
  });
});

// killAllBackgroundShellTasks is the disposer the REPL exit (rl.on('close'))
// and headless completion (runAgentHeadless finally) call so a backgrounded
// dev server can't outlive the agent. This is its contract.
describe("agent-core killAllBackgroundShellTasks (REPL/headless teardown seam)", () => {
  afterEach(async () => {
    await drainAllTasks();
  });

  it("signals every running task and terminates the whole tree", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await executeTool(
        "run_shell",
        {
          command: `${NODE} -e "setTimeout(()=>{},10000)"`,
          run_in_background: true,
        },
        {},
      );
      ids.push(r.task_id);
    }
    const killed = killAllBackgroundShellTasks();
    expect(killed).toBeGreaterThanOrEqual(3);
    // Each task's process tree actually dies (close → status leaves running).
    for (const id of ids) {
      const done = await pollUntilDone(id);
      expect(done.running).toBe(false);
    }
  });

  it("is a no-op (returns 0) once tasks have drained", async () => {
    // Spawn one, then drain it, then assert a second call signals nothing.
    await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},10000)"`,
        run_in_background: true,
      },
      {},
    );
    await drainAllTasks();
    expect(killAllBackgroundShellTasks()).toBe(0);
  });
});

// killAllBackgroundShellTasksSync is the SIGNAL/exit-safe disposer: a Ctrl-C or
// SIGTERM terminates Node without unwinding the `finally` reaper, so orphan
// reclaim on those paths must be synchronous (no async spawn/taskkill that a
// dying process would cut off). The headless signal handler + the lazily-armed
// process 'exit' net both call it. This is its contract.
describe("agent-core killAllBackgroundShellTasksSync (signal/exit-safe teardown)", () => {
  afterEach(async () => {
    await drainAllTasks();
  });

  it("synchronously kills a running task's whole tree", async () => {
    const start = await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},60000)"`,
        run_in_background: true,
      },
      {},
    );
    expect(start.status).toBe("running");
    // Synchronous call — returns without awaiting the process's 'close'.
    const killed = killAllBackgroundShellTasksSync();
    expect(killed).toBeGreaterThanOrEqual(1);
    // The process really dies: its 'close' event flips status off "running".
    for (let i = 0; i < 200; i++) {
      const t = listBackgroundShellTasks().find((x) => x.id === start.task_id);
      if (t && t.status !== "running") {
        expect(t.status).not.toBe("running");
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("task survived a synchronous kill");
  });

  it("returns 0 when nothing is running", async () => {
    await drainAllTasks();
    expect(killAllBackgroundShellTasksSync()).toBe(0);
  });

  it("arms the process 'exit' reaper exactly once across background tasks", async () => {
    // Creating a background task lazily installs a single process 'exit' net so
    // an explicit process.exit() (serve shutdown, headless signal handler) can't
    // orphan it. It must be idempotent — no per-task listener leak.
    await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},60000)"`,
        run_in_background: true,
      },
      {},
    );
    const afterFirst = process.listenerCount("exit");
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    await executeTool(
      "run_shell",
      {
        command: `${NODE} -e "setTimeout(()=>{},60000)"`,
        run_in_background: true,
      },
      {},
    );
    expect(process.listenerCount("exit")).toBe(afterFirst);
  });
});

describe("reapIdleBackgroundShellTasks (memory-pressure reaping)", () => {
  afterEach(async () => {
    await drainAllTasks();
    delete process.env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP;
  });

  // A silent long-runner: stays "running", produces no output (so it counts as
  // idle the moment it starts when idleMs is 0).
  const silent = async () => {
    const r = await executeTool(
      "run_shell",
      {
        command: `"${NODE}" -e "setTimeout(()=>{},60000)"`,
        run_in_background: true,
      },
      {},
    );
    expect(r.status).toBe("running");
    return r.task_id;
  };
  const lowMem = { freemem: () => 5, totalmem: () => 100 }; // 5% free = pressure
  const okMem = { freemem: () => 80, totalmem: () => 100 }; // 80% free = healthy

  it("reaps an idle running task under memory pressure", async () => {
    const id = await silent();
    const reaped = reapIdleBackgroundShellTasks({ ...lowMem, idleMs: 0 });
    expect(reaped).toContain(id);
    const task = listBackgroundShellTasks().find((t) => t.id === id);
    expect(task.status).toBe("reaped");
  });

  it("does NOT reap when memory is healthy (no pressure)", async () => {
    const id = await silent();
    expect(reapIdleBackgroundShellTasks({ ...okMem, idleMs: 0 })).toEqual([]);
    expect(listBackgroundShellTasks().find((t) => t.id === id).status).toBe(
      "running",
    );
  });

  it("does NOT reap a task still inside the idle window", async () => {
    const id = await silent();
    // 60s idle window, task just started → not yet idle even under pressure.
    expect(reapIdleBackgroundShellTasks({ ...lowMem, idleMs: 60000 })).toEqual(
      [],
    );
    expect(listBackgroundShellTasks().find((t) => t.id === id).status).toBe(
      "running",
    );
  });

  it("is disabled by CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1", async () => {
    const id = await silent();
    process.env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP = "1";
    expect(reapIdleBackgroundShellTasks({ ...lowMem, idleMs: 0 })).toEqual([]);
    expect(listBackgroundShellTasks().find((t) => t.id === id).status).toBe(
      "running",
    );
  });
});
