import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TeamWorktreeCoordinator,
  _deps,
} from "../../src/lib/agent-team/team-worktree.js";

// Save/restore the injected git surface so each test drives fakes.
let saved;
beforeEach(() => {
  saved = { ..._deps };
});
afterEach(() => {
  Object.assign(_deps, saved);
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
    _deps.mergeWorktree = (repo, branch) => merged.push(branch);
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
    _deps.mergeWorktree = (repo, branch) => merged.push(branch);
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
