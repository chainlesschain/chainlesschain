import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  TeamWorktreeCoordinator,
  _deps,
  _processDeps,
} from "../../src/lib/agent-team/team-worktree.js";

// Save/restore the injected git surface so each test drives fakes.
let saved;
let savedProcessDeps;
beforeEach(() => {
  saved = { ..._deps };
  savedProcessDeps = { ..._processDeps };
});
afterEach(() => {
  Object.assign(_deps, saved);
  Object.assign(_processDeps, savedProcessDeps);
});

describe("TeamWorktreeCoordinator process contracts", () => {
  it("brokers the default task shell with explicit provenance", async () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    _processDeps.spawn = vi.fn(() => child);

    const pending = _deps.runShell("npm test", "/wt/task");
    child.emit("close", 0);

    await expect(pending).resolves.toEqual({ code: 0 });
    expect(_processDeps.spawn).toHaveBeenCalledWith(
      "npm test",
      [],
      expect.objectContaining({
        cwd: "/wt/task",
        origin: "team-worktree:task-command",
        policy: "allow",
        scope: "team-worktree",
        shell: true,
      }),
    );
  });

  it("brokers worktree staging and commit without a shell", () => {
    _processDeps.execFileSync = vi.fn(() => "");

    expect(_deps.commit("/wt/task", "team task build")).toBe(true);
    expect(_processDeps.execFileSync).toHaveBeenCalledTimes(2);
    for (const call of _processDeps.execFileSync.mock.calls) {
      expect(call[0]).toBe("git");
      expect(call[2]).toMatchObject({
        cwd: "/wt/task",
        origin: "team-worktree:commit",
        policy: "allow",
        scope: "team-worktree",
        shell: false,
      });
    }
  });
});

describe("TeamWorktreeCoordinator.makeRunTask", () => {
  it("creates a per-task worktree, runs the command there, and commits", async () => {
    const created = [];
    const ran = [];
    _deps.createWorktree = (repo, branch) => {
      created.push(branch);
      return { path: `/wt/${branch.replace(/\//g, "-")}` };
    };
    _deps.runShell = async (cmd, cwd) => {
      ran.push({ cmd, cwd });
    };
    _deps.commit = () => true;

    const coord = new TeamWorktreeCoordinator("/repo");
    const runTask = coord.makeRunTask();
    const out = await runTask({
      key: "build",
      task: { metadata: { command: "make" } },
    });
    expect(out).toEqual({ branch: "team/build", committed: true });
    expect(created).toEqual(["team/build"]);
    expect(ran).toEqual([{ cmd: "make", cwd: "/wt/team-build" }]);
  });

  it("throws (task failure) when the task has no command", async () => {
    _deps.createWorktree = () => ({ path: "/wt/x" });
    const coord = new TeamWorktreeCoordinator("/repo");
    await expect(
      coord.makeRunTask()({ key: "x", task: { metadata: {} } }),
    ).rejects.toThrow(/no `command`/);
  });

  it("runs an injected executor (agent prompt) in the worktree instead of a shell command", async () => {
    // --agent --worktree: the coordinator drives an agent turn in the worktree
    // cwd rather than a shell command, then still commits + integrates.
    _deps.createWorktree = (repo, branch) => ({
      path: `/wt/${branch.replace(/\//g, "-")}`,
    });
    _deps.commit = () => true;
    const calls = [];
    const coord = new TeamWorktreeCoordinator("/repo");
    const runTask = coord.makeRunTask({
      runInWorktree: async ({ key, task, cwd }) => {
        calls.push({ key, prompt: task.metadata.prompt, cwd });
      },
    });
    const out = await runTask({
      key: "fix",
      task: { metadata: { prompt: "fix the bug" } },
    });
    expect(out).toEqual({ branch: "team/fix", committed: true });
    // The agent ran in the per-task worktree cwd, not process.cwd().
    expect(calls).toEqual([
      { key: "fix", prompt: "fix the bug", cwd: "/wt/team-fix" },
    ]);
  });

  it("propagates an injected executor failure as a task failure", async () => {
    _deps.createWorktree = () => ({ path: "/wt/x" });
    const coord = new TeamWorktreeCoordinator("/repo");
    await expect(
      coord.makeRunTask({
        runInWorktree: async () => {
          throw new Error("agent exited 1");
        },
      })({ key: "x", task: { metadata: { prompt: "p" } } }),
    ).rejects.toThrow(/agent exited 1/);
  });

  it("recovers on retry: tears down the failed attempt's worktree so re-run isn't blocked", async () => {
    // Model real-git semantics: the worktree path is deterministic per branch,
    // and createWorktree throws if that path is still live (as the real one does).
    const live = new Set();
    const removed = [];
    _deps.createWorktree = (repo, branch) => {
      const p = `/wt/${branch.replace(/\//g, "-")}`;
      if (live.has(p)) throw new Error(`Worktree already exists: ${p}`);
      live.add(p);
      return { path: p };
    };
    _deps.removeWorktree = (repo, p) => {
      live.delete(p);
      removed.push(p);
    };
    let attempts = 0;
    _deps.runShell = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient failure");
    };
    _deps.commit = () => true;

    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    const cmd = { key: "flaky", task: { metadata: { command: "make" } } };

    // First attempt fails inside the worktree (task failure → TaskLeaseRegistry
    // re-queues it). The worktree it created is left behind.
    await expect(rt(cmd)).rejects.toThrow(/transient failure/);

    // Retry: must succeed — the stale worktree is removed first, not collided on.
    const out = await rt(cmd);
    expect(out).toEqual({ branch: "team/flaky", committed: true });
    expect(removed).toEqual(["/wt/team-flaky"]); // prior attempt torn down
    expect(coord.branches()).toEqual(["team/flaky"]); // single live entry
  });
});

describe("TeamWorktreeCoordinator.integrate", () => {
  function coordWith(tasks) {
    // tasks: [{key, committed, previewSuccess, conflicts}]
    _deps.createWorktree = (repo, branch) => ({
      path: `/wt/${branch.replace(/\//g, "-")}`,
    });
    _deps.runShell = async () => {};
    const commitMap = {};
    for (const t of tasks) commitMap[t.key] = t.committed;
    _deps.commit = (worktreePath) => {
      const key = worktreePath.split("team-")[1];
      return commitMap[key] !== false;
    };
    _deps.previewWorktreeMerge = (repo, branch) => {
      const key = branch.split("/")[1];
      const t = tasks.find((x) => x.key === key);
      return t.previewSuccess === false
        ? { success: false, conflicts: t.conflicts || [{ file: "x" }] }
        : { success: true, conflicts: [] };
    };
    return _deps;
  }

  it("previews clean branches and merges them when merge:true", async () => {
    coordWith([
      { key: "a", committed: true, previewSuccess: true },
      { key: "b", committed: true, previewSuccess: true },
    ]);
    const merged = [];
    // Real mergeWorktree returns {success:true} — the mock must honor that
    // contract (the code now checks .success rather than assuming success).
    _deps.mergeWorktree = (repo, branch) => {
      merged.push(branch);
      return { success: true };
    };
    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    await rt({ key: "a", task: { metadata: { command: "c" } } });
    await rt({ key: "b", task: { metadata: { command: "c" } } });

    const res = coord.integrate({ merge: true });
    expect(res.every((r) => r.clean && r.merged)).toBe(true);
    expect(merged).toEqual(["team/a", "team/b"]);
  });

  it("reports a conflicting branch and does NOT merge it", async () => {
    coordWith([
      { key: "a", committed: true, previewSuccess: true },
      {
        key: "b",
        committed: true,
        previewSuccess: false,
        conflicts: [{ file: "shared.txt" }],
      },
    ]);
    const merged = [];
    // Real mergeWorktree returns {success:true} — the mock must honor that
    // contract (the code now checks .success rather than assuming success).
    _deps.mergeWorktree = (repo, branch) => {
      merged.push(branch);
      return { success: true };
    };
    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    await rt({ key: "a", task: { metadata: { command: "c" } } });
    await rt({ key: "b", task: { metadata: { command: "c" } } });

    const res = coord.integrate({ merge: true });
    const a = res.find((r) => r.key === "a");
    const b = res.find((r) => r.key === "b");
    expect(a.merged).toBe(true);
    expect(b.clean).toBe(false);
    expect(b.merged).toBe(false);
    expect(b.conflicts).toHaveLength(1);
    expect(merged).toEqual(["team/a"]); // only the clean one merged
  });

  it("reports a merge failure when mergeWorktree returns success:false (not merged)", async () => {
    // Regression: mergeWorktree never throws — a merge that fails despite a
    // clean preview (a conflict the preview didn't predict, or a non-conflict
    // git failure) RETURNS {success:false}. The old code ignored the return and
    // reported merged:true. Assert the failure is surfaced instead.
    coordWith([{ key: "a", committed: true, previewSuccess: true }]);
    _deps.mergeWorktree = () => ({
      success: false,
      message: "unrelated histories",
      conflicts: [{ file: "late.txt" }],
    });
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    const res = coord.integrate({ merge: true });
    expect(res[0].merged).toBe(false);
    expect(res[0].clean).toBe(false);
    expect(res[0].error).toMatch(/merge failed: unrelated histories/);
    expect(res[0].conflicts).toEqual([{ file: "late.txt" }]);
  });

  it("skips a task that produced no commit", async () => {
    coordWith([{ key: "noop", committed: false }]);
    _deps.mergeWorktree = () => {
      throw new Error("should not merge");
    };
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "noop",
      task: { metadata: { command: "true" } },
    });
    const res = coord.integrate({ merge: true });
    expect(res[0]).toMatchObject({ committed: false, merged: false });
  });
});

describe("TeamWorktreeCoordinator.cleanupAll", () => {
  it("removes every worktree it created", async () => {
    const removed = [];
    _deps.createWorktree = (repo, branch) => ({
      path: `/wt/${branch.replace(/\//g, "-")}`,
    });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.removeWorktree = (repo, p) => removed.push(p);

    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    await rt({ key: "a", task: { metadata: { command: "c" } } });
    await rt({ key: "b", task: { metadata: { command: "c" } } });
    coord.cleanupAll();
    expect(removed).toEqual(["/wt/team-a", "/wt/team-b"]);
  });
});

describe("TeamWorktreeCoordinator sparse/symlink threading", () => {
  function captureWorktreeOpts() {
    const calls = [];
    _deps.createWorktree = (repo, branch, base, opts) => {
      calls.push(opts);
      return { path: `/wt/${branch.replace(/\//g, "-")}` };
    };
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    return calls;
  }

  it("passes NO options by default (full checkout, byte-identical)", async () => {
    const calls = captureWorktreeOpts();
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    expect(calls[0]).toBeUndefined();
  });

  it("applies coordinator-wide sparsePaths / symlinkDirectories defaults", async () => {
    const calls = captureWorktreeOpts();
    const coord = new TeamWorktreeCoordinator("/repo", {
      sparsePaths: ["packages/cli"],
      symlinkDirectories: ["node_modules"],
    });
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    expect(calls[0]).toEqual({
      sparsePaths: ["packages/cli"],
      symlinkDirectories: ["node_modules"],
    });
  });

  it("lets a per-task value override the coordinator default", async () => {
    const calls = captureWorktreeOpts();
    const coord = new TeamWorktreeCoordinator("/repo", {
      sparsePaths: ["packages/cli"],
    });
    await coord.makeRunTask()({
      key: "a",
      task: { sparsePaths: ["backend"], metadata: { command: "c" } },
    });
    expect(calls[0].sparsePaths).toEqual(["backend"]);
  });

  it("normalizes/drops unsafe sparse paths (no options if all invalid)", async () => {
    const calls = captureWorktreeOpts();
    const coord = new TeamWorktreeCoordinator("/repo", {
      sparsePaths: ["../evil", "/abs"],
    });
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    expect(calls[0]).toBeUndefined();
  });
});
