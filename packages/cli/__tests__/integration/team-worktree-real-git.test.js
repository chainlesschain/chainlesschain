import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import { TeamWorktreeCoordinator } from "../../src/lib/agent-team/team-worktree.js";

/**
 * Integration tier: drive REAL git worktrees. Each test builds a throwaway git
 * repo in a temp dir (never the project repo), runs a task graph where each task
 * writes files inside its own worktree, then integrates by sequentially
 * previewing + merging each branch back to base. This proves parallel isolation
 * AND that a second branch touching the same file surfaces a conflict after the
 * first merges — Phase 4's "并行 Worktree 修改可预览冲突并安全合并".
 */

const NODE = process.execPath.replace(/\\/g, "/");
let repo;

function git(args, cwd = repo) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "cc-team-wt-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "t@t.local"]);
  git(["config", "user.name", "t"]);
  writeFileSync(path.join(repo, "README.md"), "base\n", "utf8");
  git(["add", "-A"]);
  git(["commit", "-m", "base"]);
});

afterEach(() => {
  try {
    rmSync(repo, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// A task command that writes `content` to `file` (in the worktree cwd).
function writeCmd(file, content) {
  return `"${NODE}" -e "require('fs').writeFileSync('${file}','${content}')"`;
}

describe("cc team worktree (real git)", { timeout: 120_000 }, () => {
  it("propagates a stable multi-dependency commit baseline into a downstream task and resume", async () => {
    const producer = new TeamWorktreeCoordinator(repo, {
      runId: "dag-baseline",
    });
    const produce = producer.makeRunTask();
    const aResult = await produce({
      key: "a",
      task: { metadata: { command: writeCmd("fileA.txt", "AAA") } },
    });
    const bResult = await produce({
      key: "b",
      task: { metadata: { command: writeCmd("fileB.txt", "BBB") } },
    });

    const coord = new TeamWorktreeCoordinator(repo, {
      runId: "dag-baseline",
    });
    coord.registerCompletedDependency("a", aResult);
    coord.registerCompletedDependency("b", bResult);
    const consumeResult = await coord.makeRunTask()({
      key: "consume",
      task: {
        dependsOn: ["b", "a"],
        metadata: {
          command: `"${NODE}" -e "const f=require('fs');f.writeFileSync('combined.txt',f.readFileSync('fileA.txt','utf8')+'+'+f.readFileSync('fileB.txt','utf8'))"`,
        },
      },
    });

    expect(aResult).toMatchObject({
      worktreePath: expect.any(String),
      commitOid: expect.stringMatching(/^[a-f0-9]{40,64}$/),
    });
    expect(
      readFileSync(
        path.join(consumeResult.worktreePath, "combined.txt"),
        "utf8",
      ),
    ).toBe("AAA+BBB");
    const snapshot = coord.snapshot();
    expect(
      snapshot.records.find((record) => record.key === "consume")
        .dependencyCommits,
    ).toEqual([
      {
        key: "a",
        branch: aResult.branch,
        commitOid: aResult.commitOid,
      },
      {
        key: "b",
        branch: bResult.branch,
        commitOid: bResult.commitOid,
      },
    ]);

    const recovered = new TeamWorktreeCoordinator(repo, { snapshot });
    const integ = recovered.integrate({ merge: true });
    expect(integ.every((result) => result.clean && result.merged)).toBe(true);
    recovered.prepareCleanupAll({ requireMerged: true });
    recovered.cleanupAll();
    expect(readFileSync(path.join(repo, "combined.txt"), "utf8")).toBe(
      "AAA+BBB",
    );
  });

  it("requires adjudication when stable dependency composition conflicts", async () => {
    const coord = new TeamWorktreeCoordinator(repo);
    const runTask = coord.makeRunTask();
    const a = await runTask({
      key: "a",
      task: { metadata: { command: writeCmd("shared.txt", "from-A") } },
    });
    const b = await runTask({
      key: "b",
      task: { metadata: { command: writeCmd("shared.txt", "from-B") } },
    });
    let executed = false;

    await expect(
      coord.makeRunTask({
        runInWorktree: async () => {
          executed = true;
        },
      })({
        key: "consume",
        task: {
          dependsOn: ["b", "a"],
          metadata: { prompt: "must not execute" },
        },
      }),
    ).rejects.toMatchObject({
      code: "TEAM_WORKTREE_DEPENDENCY_ADJUDICATION_REQUIRED",
      retryable: false,
      dependency: "b",
    });
    expect(executed).toBe(false);
    const record = coord
      .snapshot()
      .records.find((item) => item.key === "consume");
    expect(record.dependencyCommits.map((item) => item.commitOid)).toEqual([
      a.commitOid,
      b.commitOid,
    ]);
    expect(readFileSync(path.join(record.path, "shared.txt"), "utf8")).toBe(
      "from-A",
    );
  });

  it("rejects a recovered dependency binding after its branch ref drifts", async () => {
    const coord = new TeamWorktreeCoordinator(repo, {
      runId: "dependency-drift",
    });
    const runTask = coord.makeRunTask();
    const a = await runTask({
      key: "a",
      task: { metadata: { command: writeCmd("a.txt", "A") } },
    });
    await runTask({
      key: "b",
      task: {
        dependsOn: ["a"],
        metadata: { command: writeCmd("b.txt", "B") },
      },
    });
    const snapshot = coord.snapshot();

    writeFileSync(path.join(a.worktreePath, "drift.txt"), "drift", "utf8");
    git(["add", "-A"], a.worktreePath);
    git(["commit", "-m", "move dependency branch"], a.worktreePath);

    expect(() => new TeamWorktreeCoordinator(repo, { snapshot })).toThrow(
      /dependency branch .* moved after settlement/,
    );
  });

  it("runs two independent tasks in isolated worktrees and merges both clean", async () => {
    const reg = new TaskLeaseRegistry({ defaultTtlMs: 1_000_000 });
    reg.addTask({
      key: "a",
      title: "a",
      metadata: { command: writeCmd("fileA.txt", "AAA") },
    });
    reg.addTask({
      key: "b",
      title: "b",
      metadata: { command: writeCmd("fileB.txt", "BBB") },
    });

    const coord = new TeamWorktreeCoordinator(repo);
    const runner = new TeamRunner(reg, {
      teammates: 2,
      runTask: coord.makeRunTask(),
    });
    const summary = await runner.run();
    expect(summary.done).toBe(true);

    const integ = coord.integrate({ merge: true });
    expect(integ.every((r) => r.committed && r.clean && r.merged)).toBe(true);
    coord.prepareCleanupAll({ requireMerged: true });
    coord.cleanupAll();

    // Both files landed on main after the merges.
    git(["checkout", "main"]);
    expect(existsSync(path.join(repo, "fileA.txt"))).toBe(true);
    expect(existsSync(path.join(repo, "fileB.txt"))).toBe(true);
  });

  it("surfaces a conflict when two tasks change the same file (second doesn't merge)", async () => {
    const reg = new TaskLeaseRegistry({ defaultTtlMs: 1_000_000 });
    reg.addTask({
      key: "a",
      title: "a",
      metadata: { command: writeCmd("shared.txt", "from-A") },
    });
    reg.addTask({
      key: "b",
      title: "b",
      metadata: { command: writeCmd("shared.txt", "from-B") },
    });

    const coord = new TeamWorktreeCoordinator(repo);
    // One teammate → deterministic integration order (a then b).
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: coord.makeRunTask(),
    });
    await runner.run();

    const integ = coord.integrate({ merge: true });
    const a = integ.find((r) => r.key === "a");
    const b = integ.find((r) => r.key === "b");
    // First branch merges clean; the second now conflicts on shared.txt.
    expect(a.merged).toBe(true);
    expect(b.merged).toBe(false);
    expect(b.clean).toBe(false);
    expect(b.conflicts.length).toBeGreaterThan(0);

    // Base got A's version; B was NOT silently clobbered in.
    git(["checkout", "main"]);
    expect(readFileSync(path.join(repo, "shared.txt"), "utf8")).toContain(
      "from-A",
    );
  });

  it("refuses to merge a recovered run into a different checked-out branch", async () => {
    const reg = new TaskLeaseRegistry({ defaultTtlMs: 1_000_000 });
    reg.addTask({
      key: "a",
      title: "a",
      metadata: { command: writeCmd("wrong-target.txt", "task-output") },
    });
    const coord = new TeamWorktreeCoordinator(repo, { runId: "base-binding" });
    const runner = new TeamRunner(reg, {
      teammates: 1,
      runTask: coord.makeRunTask(),
    });
    await runner.run();
    const snapshot = coord.snapshot();

    git(["switch", "-c", "release"]);
    const recovered = new TeamWorktreeCoordinator(repo, { snapshot });

    expect(() => recovered.integrate({ merge: true })).toThrow(
      /base target changed/,
    );
    expect(existsSync(path.join(repo, "wrong-target.txt"))).toBe(false);
  });
});
