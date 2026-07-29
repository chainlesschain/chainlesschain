import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
  MAX_TEAM_WORKTREE_STDERR_BYTES,
  TeamWorktreeCoordinator,
  _deps,
  _processDeps,
} from "../../src/lib/agent-team/team-worktree.js";

// Save/restore the injected git surface so each test drives fakes.
let saved;
let savedProcessDeps;
let fakeAncestors;
const fakeOid = (value) =>
  createHash("sha1").update(String(value)).digest("hex");
beforeEach(() => {
  saved = { ..._deps };
  savedProcessDeps = { ..._processDeps };
  // Most coordinator tests inject synthetic `/wt/...` paths. The real path
  // validator is covered explicitly below and by worktree-isolator.test.js.
  _deps.assertManagedWorktreePath = (_repo, worktreePath) => worktreePath;
  fakeAncestors = new Set();
  _deps.resolveGitRef = (cwd, ref = "HEAD") => {
    const label =
      ref === "HEAD"
        ? cwd === "/repo"
          ? "base"
          : String(cwd).split(/[\\/]/).at(-1)
        : String(ref).replaceAll("/", "-");
    return fakeOid(label);
  };
  _deps.resolveGitBranch = () => "main";
  _deps.isGitAncestor = (_repo, ancestor) => fakeAncestors.has(ancestor);
  _deps.isWorktreeClean = () => true;
  _deps.pathExists = () => true;
  _deps.removeManagedDependencyLinks = () => [];
});
afterEach(() => {
  Object.assign(_deps, saved);
  Object.assign(_processDeps, savedProcessDeps);
});

describe("TeamWorktreeCoordinator process contracts", () => {
  it("brokers the default task shell with explicit provenance", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.resume = vi.fn();
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
    expect(child.stdout.resume).toHaveBeenCalledOnce();
  });

  it("bounds retained stderr and ignores a close event after an error", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.resume = vi.fn();
    child.stderr = new EventEmitter();
    _processDeps.spawn = vi.fn(() => child);

    const pending = _deps.runShell("bad command", "/wt/task");
    child.stderr.emit(
      "data",
      Buffer.alloc(MAX_TEAM_WORKTREE_STDERR_BYTES + 1024, "x"),
    );
    child.emit("close", 7);
    child.emit("error", new Error("late process error"));

    const error = await pending.catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message.length).toBeLessThanOrEqual(
      MAX_TEAM_WORKTREE_STDERR_BYTES,
    );
    expect(error.message).not.toContain("late process error");
  });

  it("preserves the first process error when close follows it", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    _processDeps.spawn = vi.fn(() => child);

    const pending = _deps.runShell("bad command", "/wt/task");
    child.emit("error", new Error("spawn failed"));
    child.emit("close", 1);

    await expect(pending).rejects.toThrow("spawn failed");
  });

  it("terminates the process tree and waits for close on abort", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    });
    _processDeps.spawn = vi.fn(() => child);
    _processDeps.killProcessTree = vi.fn(() => child.kill());
    const controller = new AbortController();
    const pending = _deps.runShell("long command", "/wt/task", {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "TEAM_WORKTREE_SHELL_ABORTED",
    });
    expect(_processDeps.killProcessTree).toHaveBeenCalledOnce();
  });

  it("brokers worktree staging and commit without a shell", () => {
    _processDeps.execFileSync = vi.fn((file, args) => {
      if (args.includes("diff")) {
        const error = new Error("staged changes");
        error.status = 1;
        throw error;
      }
      return "";
    });

    expect(_deps.commit("/wt/task", "team task build")).toBe(true);
    expect(_processDeps.execFileSync).toHaveBeenCalledTimes(3);
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

  it("returns false only when the staged diff is empty", () => {
    _processDeps.execFileSync = vi.fn(() => "");

    expect(_deps.commit("/wt/task", "team task noop")).toBe(false);
    expect(_processDeps.execFileSync).toHaveBeenCalledTimes(2);
    expect(_processDeps.execFileSync.mock.calls[1][1]).toEqual([
      "diff",
      "--cached",
      "--quiet",
      "--exit-code",
    ]);
  });

  it("surfaces diff and commit failures instead of reporting no changes", () => {
    const diffFailure = new Error("repository is corrupt");
    diffFailure.status = 128;
    _processDeps.execFileSync = vi.fn((file, args) => {
      if (args.includes("diff")) throw diffFailure;
      return "";
    });
    expect(() => _deps.commit("/wt/task", "team task x")).toThrow(
      "repository is corrupt",
    );

    const commitFailure = new Error("commit hook rejected");
    commitFailure.status = 1;
    _processDeps.execFileSync = vi.fn((file, args) => {
      if (args.includes("diff")) {
        const changed = new Error("staged changes");
        changed.status = 1;
        throw changed;
      }
      if (args.includes("commit")) throw commitFailure;
      return "";
    });
    expect(() => _deps.commit("/wt/task", "team task x")).toThrow(
      "commit hook rejected",
    );
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
    _deps.resolveGitRef = () => fakeOid("base");

    const observed = [];
    const coord = new TeamWorktreeCoordinator("/repo", {
      onWorktree: (record) => observed.push(record),
    });
    const runTask = coord.makeRunTask();
    const out = await runTask({
      key: "build",
      task: { metadata: { command: "make" } },
    });
    expect(out).toEqual({ branch: "team/build", committed: true });
    expect(created).toEqual(["team/build"]);
    expect(ran).toEqual([{ cmd: "make", cwd: "/wt/team-build" }]);
    expect(observed).toEqual([
      {
        key: "build",
        branch: "team/build",
        path: "/wt/team-build",
        holder: undefined,
      },
    ]);
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

  it("requires adjudication when the post-commit lease fence is lost", async () => {
    _deps.createWorktree = () => ({ path: "/wt/fenced" });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.resolveGitRef = () => fakeOid("fenced");
    const renew = vi
      .fn()
      .mockReturnValueOnce({ ok: true })
      .mockReturnValueOnce({ ok: false, reason: "lease_lost" });
    const coord = new TeamWorktreeCoordinator("/repo");

    let failure;
    try {
      await coord.makeRunTask()({
        key: "fenced",
        task: { metadata: { command: "build" } },
        renew,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "TEAM_WORKTREE_POST_COMMIT_ADJUDICATION_REQUIRED",
      retryable: false,
    });
    expect(coord.snapshot().records[0]).toMatchObject({
      completed: false,
      committed: false,
      commitOid: null,
    });
    expect(coord.integrate({ merge: true })[0]).toMatchObject({
      clean: false,
      merged: false,
      note: "task did not complete",
    });
  });

  it("treats commit OID capture failure as non-retryable", async () => {
    _deps.createWorktree = () => ({ path: "/wt/oid" });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.resolveGitRef = (cwd) => {
      if (cwd === "/repo") return fakeOid("base");
      throw new Error("rev-parse unavailable");
    };
    const coord = new TeamWorktreeCoordinator("/repo");

    await expect(
      coord.makeRunTask()({
        key: "oid",
        task: { metadata: { command: "build" } },
      }),
    ).rejects.toMatchObject({
      code: "TEAM_WORKTREE_COMMIT_ADJUDICATION_REQUIRED",
      retryable: false,
    });
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
    _deps.resolveGitRef = () => fakeOid("base");

    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    const cmd = {
      key: "flaky",
      task: {
        metadata: { command: "make", retrySafe: true },
      },
    };

    // First attempt fails inside the worktree (task failure → TaskLeaseRegistry
    // re-queues it). The worktree it created is left behind.
    await expect(rt(cmd)).rejects.toThrow(/transient failure/);

    // Retry: must succeed — the stale worktree is removed first, not collided on.
    const out = await rt(cmd);
    expect(out).toEqual({ branch: "team/flaky", committed: true });
    expect(removed).toEqual(["/wt/team-flaky"]); // prior attempt torn down
    expect(coord.branches()).toEqual(["team/flaky"]); // single live entry
  });

  it("refuses a retry that would discard files from the failed attempt", async () => {
    _deps.createWorktree = () => ({ path: "/wt/team-flaky" });
    _deps.runShell = async () => {
      throw new Error("transient failure");
    };
    _deps.resolveGitRef = () => fakeOid("base");
    _deps.removeWorktree = vi.fn();
    const coord = new TeamWorktreeCoordinator("/repo");
    const runTask = coord.makeRunTask();
    const context = {
      key: "flaky",
      task: {
        metadata: { command: "make", retrySafe: true },
      },
    };

    await expect(runTask(context)).rejects.toThrow("transient failure");
    _deps.isWorktreeClean = () => false;

    await expect(runTask(context)).rejects.toMatchObject({
      code: "TEAM_WORKTREE_RETRY_ADJUDICATION_REQUIRED",
      retryable: false,
    });
    expect(_deps.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("TeamWorktreeCoordinator run identity and recovery", () => {
  it("keeps legacy branch names without runId and makes run-scoped refs safe", () => {
    expect(new TeamWorktreeCoordinator("/repo").branchFor("build")).toBe(
      "team/build",
    );

    const key = "../feature @{x}.lock";
    const first = new TeamWorktreeCoordinator("/repo", {
      runId: "run / one @{.lock",
    }).branchFor(key);
    const same = new TeamWorktreeCoordinator("/repo", {
      runId: "run / one @{.lock",
    }).branchFor(key);
    const second = new TeamWorktreeCoordinator("/repo", {
      runId: "run / two @{.lock",
    }).branchFor(key);

    expect(first).toBe(same);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^team\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/);
    expect(first).not.toContain("..");
    expect(first).not.toContain("@{");
    expect(first).not.toMatch(/\.lock(?:\/|$)/);
  });

  it("snapshots and restores completed worktree records", async () => {
    _deps.createWorktree = (repo, branch) => ({
      path: `/wt/${branch.replace(/\//g, "-")}`,
    });
    _deps.runShell = async () => {};
    _deps.commit = () => true;

    const coord = new TeamWorktreeCoordinator("/repo", {
      runId: "recoverable-run",
    });
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    const snapshot = coord.snapshot();
    const restored = new TeamWorktreeCoordinator("/repo", { snapshot });

    expect(snapshot.baseTarget).toEqual({
      branch: "main",
      commitOid: fakeOid("base"),
    });
    expect(restored.runId).toBe("recoverable-run");
    expect(restored.branches()).toEqual(coord.branches());
    expect(restored.snapshot()).toEqual(snapshot);

    snapshot.records[0].branch = "team/mutated";
    expect(restored.branches()).toEqual(coord.branches());
  });

  it("supports raw completed-record seeds and rejects mismatched snapshots", () => {
    const source = new TeamWorktreeCoordinator("/repo", { runId: "run-a" });
    const branch = source.branchFor("done");
    const seeded = new TeamWorktreeCoordinator("/repo", {
      runId: "run-a",
      seedRecords: [
        {
          key: "done",
          branch,
          path: "/wt/done",
          committed: true,
          completed: true,
          commitOid: fakeOid("done"),
          integration: {
            previewed: false,
            clean: null,
            merged: false,
            baseCommit: null,
            mergeCommit: null,
          },
          cleanupPrepared: false,
          cleaned: false,
        },
      ],
    });
    expect(seeded.snapshot().records).toEqual([
      {
        key: "done",
        branch,
        path: "/wt/done",
        committed: true,
        completed: true,
        commitOid: fakeOid("done"),
        integration: {
          previewed: false,
          clean: null,
          merged: false,
          baseCommit: null,
          mergeCommit: null,
        },
        managedLinks: [],
        cleanupPrepared: false,
        cleaned: false,
      },
    ]);

    expect(
      () =>
        new TeamWorktreeCoordinator("/repo", {
          runId: "run-b",
          snapshot: {
            version: 3,
            runId: "run-a",
            baseTarget: {
              branch: "main",
              commitOid: fakeOid("base"),
            },
            records: [],
          },
        }),
    ).toThrow(/runId mismatch/);
  });

  it("rejects a recovered path that does not match its managed branch path", () => {
    _deps.assertManagedWorktreePath = (repo, worktreePath, { branchName }) => {
      const expected = `${repo}/.worktrees/${branchName.replaceAll("/", "-")}`;
      if (worktreePath !== expected) {
        throw new Error("managed worktree path does not match its branch");
      }
      return worktreePath;
    };
    const source = new TeamWorktreeCoordinator("/repo", {
      runId: "run-safe",
    });
    const branch = source.branchFor("danger");

    expect(
      () =>
        new TeamWorktreeCoordinator("/repo", {
          runId: "run-safe",
          snapshot: {
            version: 3,
            runId: "run-safe",
            baseTarget: {
              branch: "main",
              commitOid: fakeOid("base"),
            },
            records: [
              {
                key: "danger",
                branch,
                path: "/repo",
                committed: true,
                completed: true,
              },
            ],
          },
        }),
    ).toThrow(/does not match its branch/);
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
    _deps.mergeWorktree = (repo, commitOid) => {
      merged.push(commitOid);
      fakeAncestors.add(commitOid);
      return { success: true };
    };
    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    await rt({ key: "a", task: { metadata: { command: "c" } } });
    await rt({ key: "b", task: { metadata: { command: "c" } } });

    const res = coord.integrate({ merge: true });
    expect(res.every((r) => r.clean && r.merged)).toBe(true);
    expect(merged).toEqual([fakeOid("team-a"), fakeOid("team-b")]);
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
    _deps.mergeWorktree = (repo, commitOid) => {
      merged.push(commitOid);
      fakeAncestors.add(commitOid);
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
    expect(merged).toEqual([fakeOid("team-a")]); // only the clean one merged
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

  it("refuses recovery integration when the persisted base branch changed", async () => {
    coordWith([{ key: "a", committed: true, previewSuccess: true }]);
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    const recovered = new TeamWorktreeCoordinator("/repo", {
      snapshot: coord.snapshot(),
    });
    _deps.resolveGitBranch = () => "release";
    _deps.mergeWorktree = vi.fn();

    expect(() => recovered.integrate({ merge: true })).toThrow(
      /base target changed/,
    );
    expect(_deps.mergeWorktree).not.toHaveBeenCalled();
  });

  it("fails closed if a task branch moves during preview", async () => {
    coordWith([{ key: "a", committed: true, previewSuccess: true }]);
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "c" } },
    });
    const originalResolve = _deps.resolveGitRef;
    let moved = false;
    _deps.previewWorktreeMerge = () => {
      moved = true;
      return { success: true, conflicts: [] };
    };
    _deps.resolveGitRef = (cwd, ref = "HEAD") => {
      if (moved && cwd === "/repo" && ref === "team/a") {
        return fakeOid("advanced-task-branch");
      }
      return originalResolve(cwd, ref);
    };
    _deps.mergeWorktree = vi.fn();

    const result = coord.integrate({ merge: true });
    expect(result[0]).toMatchObject({
      clean: false,
      merged: false,
    });
    expect(result[0].error).toMatch(/Git refs moved while previewing/);
    expect(_deps.mergeWorktree).not.toHaveBeenCalled();
  });
});

describe("TeamWorktreeCoordinator.cleanupAll", () => {
  it("removes every worktree it created", async () => {
    const removed = [];
    const removalOptions = [];
    _deps.createWorktree = (repo, branch) => ({
      path: `/wt/${branch.replace(/\//g, "-")}`,
    });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.previewWorktreeMerge = () => ({
      success: true,
      conflicts: [],
    });
    _deps.removeWorktree = (repo, p, options) => {
      removed.push(p);
      removalOptions.push(options);
    };

    const coord = new TeamWorktreeCoordinator("/repo");
    const rt = coord.makeRunTask();
    await rt({ key: "a", task: { metadata: { command: "c" } } });
    await rt({ key: "b", task: { metadata: { command: "c" } } });
    expect(coord.integrate({ merge: false }).every((item) => item.clean)).toBe(
      true,
    );
    coord.prepareCleanupAll();
    expect(coord.cleanupAll()).toEqual([
      { key: "a", ok: true, path: "/wt/team-a" },
      { key: "b", ok: true, path: "/wt/team-b" },
    ]);
    expect(removed).toEqual(["/wt/team-a", "/wt/team-b"]);
    expect(removalOptions).toEqual([
      expect.objectContaining({
        force: false,
        branchName: "team/a",
        expectedBranchOid: fakeOid("team-a"),
      }),
      expect.objectContaining({
        force: false,
        branchName: "team/b",
        expectedBranchOid: fakeOid("team-b"),
      }),
    ]);
    expect(coord.branches()).toEqual([]);
    expect(coord.snapshot().records).toMatchObject([
      {
        key: "a",
        cleaned: true,
        integration: { previewed: true, clean: true },
      },
      {
        key: "b",
        cleaned: true,
        integration: { previewed: true, clean: true },
      },
    ]);
  });

  it("keeps failed removals in the recovery manifest", async () => {
    const removed = [];
    _deps.createWorktree = (repo, branch) => ({
      path: `/wt/${branch.replace(/\//g, "-")}`,
    });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.previewWorktreeMerge = () => ({
      success: true,
      conflicts: [],
    });
    _deps.removeWorktree = (repo, worktreePath) => {
      removed.push(worktreePath);
      if (worktreePath.endsWith("-a")) throw new Error("busy");
    };

    const coord = new TeamWorktreeCoordinator("/repo");
    const runTask = coord.makeRunTask();
    await runTask({ key: "a", task: { metadata: { command: "c" } } });
    await runTask({ key: "b", task: { metadata: { command: "c" } } });
    coord.integrate({ merge: false });
    coord.prepareCleanupAll();

    expect(coord.cleanupAll()).toEqual([
      {
        key: "a",
        ok: false,
        path: "/wt/team-a",
        error: "busy",
      },
      { key: "b", ok: true, path: "/wt/team-b" },
    ]);
    expect(removed).toEqual(["/wt/team-a", "/wt/team-b"]);
    expect(coord.branches()).toEqual(["team/a"]);
    expect(coord.snapshot().records).toMatchObject([
      {
        key: "a",
        branch: "team/a",
        path: "/wt/team-a",
        committed: true,
        completed: true,
        cleaned: false,
        integration: { previewed: true, clean: true },
      },
      {
        key: "b",
        cleaned: true,
      },
    ]);
  });

  it("finishes prepared cleanup idempotently after crash recovery", async () => {
    _deps.createWorktree = () => ({ path: "/wt/team-a" });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.previewWorktreeMerge = () => ({
      success: true,
      conflicts: [],
    });
    const original = new TeamWorktreeCoordinator("/repo");
    await original.makeRunTask()({
      key: "a",
      task: { metadata: { command: "build" } },
    });
    original.integrate({ merge: false });
    original.prepareCleanupAll();
    const prepared = original.snapshot();

    const removed = vi.fn();
    _deps.removeWorktree = removed;
    const recovered = new TeamWorktreeCoordinator("/repo", {
      snapshot: prepared,
    });
    expect(recovered.cleanupAll()).toEqual([
      { key: "a", ok: true, path: "/wt/team-a" },
    ]);
    expect(removed).toHaveBeenCalledOnce();
    expect(recovered.snapshot().records[0]).toMatchObject({
      cleanupPrepared: true,
      cleaned: true,
    });
  });

  it("does not reuse a prepared preview after the base branch advanced", async () => {
    _deps.createWorktree = () => ({ path: "/wt/team-a" });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.previewWorktreeMerge = () => ({
      success: true,
      conflicts: [],
    });
    const original = new TeamWorktreeCoordinator("/repo");
    await original.makeRunTask()({
      key: "a",
      task: { metadata: { command: "build" } },
    });
    original.integrate({ merge: false });
    original.prepareCleanupAll();
    const snapshot = original.snapshot();
    const originalResolve = _deps.resolveGitRef;
    const advancedHead = fakeOid("advanced-base");
    _deps.resolveGitRef = (cwd, ref = "HEAD") =>
      cwd === "/repo" && ref === "HEAD"
        ? advancedHead
        : originalResolve(cwd, ref);
    _deps.isGitAncestor = (_repo, ancestor, descendant) =>
      ancestor === fakeOid("base") && descendant === advancedHead;
    _deps.pathExists = () => false;
    const recovered = new TeamWorktreeCoordinator("/repo", { snapshot });

    expect(recovered.integrate({ merge: false })[0]).toMatchObject({
      clean: false,
      merged: false,
      error: expect.stringMatching(/stale or incomplete/),
    });
  });

  it("retains a prepared worktree when ignored or unsettled files appeared", async () => {
    _deps.createWorktree = () => ({ path: "/wt/team-a" });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.previewWorktreeMerge = () => ({
      success: true,
      conflicts: [],
    });
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "build" } },
    });
    coord.integrate({ merge: false });
    coord.prepareCleanupAll();
    _deps.isWorktreeClean = (_path, options) =>
      options?.includeIgnored !== true;
    _deps.removeWorktree = vi.fn();

    expect(coord.cleanupAll()).toEqual([
      {
        key: "a",
        ok: false,
        path: "/wt/team-a",
        error: 'refusing to clean worktree "a" with unsettled or ignored files',
      },
    ]);
    expect(_deps.removeWorktree).not.toHaveBeenCalled();
    expect(coord.snapshot().records[0].cleaned).toBe(false);
  });

  it("retains a prepared worktree when its branch advanced", async () => {
    _deps.createWorktree = () => ({ path: "/wt/team-a" });
    _deps.runShell = async () => {};
    _deps.commit = () => true;
    _deps.previewWorktreeMerge = () => ({
      success: true,
      conflicts: [],
    });
    const coord = new TeamWorktreeCoordinator("/repo");
    await coord.makeRunTask()({
      key: "a",
      task: { metadata: { command: "build" } },
    });
    coord.integrate({ merge: false });
    coord.prepareCleanupAll();
    const originalResolve = _deps.resolveGitRef;
    _deps.resolveGitRef = (cwd, ref = "HEAD") =>
      cwd === "/repo" && ref === "team/a"
        ? fakeOid("advanced")
        : originalResolve(cwd, ref);
    _deps.removeWorktree = vi.fn();

    const [result] = coord.cleanupAll();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/after its branch moved/);
    expect(_deps.removeWorktree).not.toHaveBeenCalled();
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

  it("requires control-plane approval for task dependency links", async () => {
    const calls = captureWorktreeOpts();
    const unapproved = new TeamWorktreeCoordinator("/repo");
    await expect(
      unapproved.makeRunTask()({
        key: "a",
        task: {
          metadata: {
            command: "c",
            symlinkDirectories: ["node_modules"],
          },
        },
      }),
    ).rejects.toThrow(/explicitly approved by --symlink-dirs/);
    expect(calls).toEqual([]);

    const approved = new TeamWorktreeCoordinator("/repo", {
      symlinkDirectories: ["node_modules"],
    });
    await approved.makeRunTask()({
      key: "b",
      task: {
        metadata: {
          command: "c",
          symlinkDirectories: ["node_modules"],
        },
      },
    });
    expect(calls[0]).toMatchObject({
      symlinkDirectories: ["node_modules"],
    });
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
