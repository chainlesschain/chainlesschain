import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _deps,
  launchBackgroundAgent,
  readBackgroundAgentState,
  removeBackgroundAgent,
  resumeBackgroundAgent,
  statePath,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import { setupAgentWorktree } from "../../src/lib/agent-worktree.js";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("background agent worktree lifecycle", () => {
  let stateDir;
  let repo;
  let originalSpawn;
  let originalReadProcessStartTimeMs;
  let nextPid;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "cc-bg-wt-state-"));
    repo = mkdtempSync(join(tmpdir(), "cc-bg-wt-repo-"));
    process.env.CC_BACKGROUND_AGENTS_DIR = stateDir;
    git(["init", "-b", "main"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test"], repo);
    writeFileSync(join(repo, "README.md"), "# test\n", "utf8");
    git(["add", "README.md"], repo);
    git(["commit", "-m", "base", "--no-verify"], repo);

    originalSpawn = _deps.spawn;
    originalReadProcessStartTimeMs = _deps.readProcessStartTimeMs;
    nextPid = 41000;
    _deps.readProcessStartTimeMs = () => null;
    _deps.spawn = vi.fn(() => ({
      pid: nextPid++,
      on: vi.fn(),
      unref: vi.fn(),
    }));
  });

  afterEach(() => {
    _deps.spawn = originalSpawn;
    _deps.readProcessStartTimeMs = originalReadProcessStartTimeMs;
    delete process.env.CC_BACKGROUND_AGENTS_DIR;

    // Tests intentionally retain dirty worktrees. Unregister them before
    // recursively deleting the temporary repository (especially on Windows).
    try {
      const entries = git(["worktree", "list", "--porcelain"], repo)
        .split(/\r?\n/)
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length));
      for (const entry of entries) {
        if (resolve(entry) === resolve(repo)) continue;
        try {
          git(["worktree", "remove", "--force", entry], repo);
        } catch {
          /* best-effort fixture cleanup */
        }
      }
    } catch {
      /* repository may already be gone */
    }
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  function terminalState(id, worktree, extra = {}) {
    return {
      id,
      status: "completed",
      sessionId: `session-${id}`,
      title: id,
      cwd: worktree.path,
      repoRoot: worktree.repoRoot,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
      startedAt: 1,
      endedAt: 2,
      ...extra,
    };
  }

  it("persists repoRoot/worktreePath/baseSha/branch in both state and job", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    const state = launchBackgroundAgent({
      argv: ["agent", "-p", "work"],
      cwd: worktree.path,
      sessionId: "session-launch",
      title: "work",
      followUpArgv: ["agent", "--session", "session-launch"],
      worktree,
    });

    expect(state).toMatchObject({
      cwd: worktree.path,
      repoRoot: worktree.repoRoot,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
    });
    expect(readBackgroundAgentState(state.id)).toMatchObject({
      cwd: worktree.path,
      repoRoot: worktree.repoRoot,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
    });

    const jobFile = _deps.spawn.mock.calls[0][1][1];
    expect(JSON.parse(readFileSync(jobFile, "utf8"))).toMatchObject({
      cwd: worktree.path,
      repoRoot: worktree.repoRoot,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
    });
  });

  it("resume launches the same conversation in the original worktree", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    writeBackgroundAgentState(terminalState("bg-wt-resume", worktree));

    const resumed = resumeBackgroundAgent("bg-wt-resume", "continue");
    const spawnOptions = _deps.spawn.mock.calls[0][2];
    const jobFile = _deps.spawn.mock.calls[0][1][1];
    const job = JSON.parse(readFileSync(jobFile, "utf8"));

    expect(spawnOptions.cwd).toBe(worktree.path);
    expect(job.cwd).toBe(worktree.path);
    expect(job.argv).toEqual([
      "agent",
      "--session",
      "session-bg-wt-resume",
      "-p",
      "continue",
    ]);
    expect(resumed).toMatchObject({
      sessionId: "session-bg-wt-resume",
      cwd: worktree.path,
      worktreePath: worktree.path,
      repoRoot: worktree.repoRoot,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
    });
  });

  it("resume fails closed when the persisted worktree disappeared", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    writeBackgroundAgentState(terminalState("bg-wt-gone", worktree));
    git(["worktree", "remove", worktree.path], repo);
    _deps.spawn.mockClear();

    expect(() => resumeBackgroundAgent("bg-wt-gone", "continue")).toThrow(
      /worktree|does not exist/i,
    );
    expect(_deps.spawn).not.toHaveBeenCalled();
  });

  it("stale state writers cannot drop immutable worktree metadata or cwd", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    writeBackgroundAgentState(terminalState("bg-wt-merge", worktree));
    writeBackgroundAgentState({
      id: "bg-wt-merge",
      status: "completed",
      sessionId: "session-bg-wt-merge",
      cwd: repo,
      startedAt: 1,
      endedAt: 3,
    });

    expect(readBackgroundAgentState("bg-wt-merge")).toMatchObject({
      cwd: worktree.path,
      repoRoot: worktree.repoRoot,
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
      branch: worktree.branch,
    });
  });

  it("record cleanup refuses dirty work and preserves the state for recovery", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    writeFileSync(join(worktree.path, "unfinished.txt"), "keep me\n", "utf8");
    writeBackgroundAgentState(terminalState("bg-wt-dirty", worktree));

    expect(() => removeBackgroundAgent("bg-wt-dirty")).toThrow(
      /worktree is kept|uncommitted changes/i,
    );
    expect(existsSync(worktree.path)).toBe(true);
    expect(existsSync(statePath("bg-wt-dirty"))).toBe(true);

    const removed = removeBackgroundAgent("bg-wt-dirty", {
      keepWorktree: true,
    });
    expect(removed.worktree).toMatchObject({
      removed: false,
      kept: true,
      path: worktree.path,
    });
    expect(existsSync(worktree.path)).toBe(true);
    expect(existsSync(statePath("bg-wt-dirty"))).toBe(false);
  });

  it("explicit record cleanup removes only a verified clean worktree", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    writeBackgroundAgentState(terminalState("bg-wt-clean", worktree));

    const removed = removeBackgroundAgent("bg-wt-clean");
    expect(removed.worktree).toMatchObject({
      removed: true,
      kept: false,
      path: worktree.path,
    });
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(["branch", "--list", worktree.branch], repo)).toBe("");
    expect(existsSync(statePath("bg-wt-clean"))).toBe(false);
  });

  it("cleanup blocks active processes and uncertain side effects", () => {
    const worktree = setupAgentWorktree({ cwd: repo });
    writeBackgroundAgentState(
      terminalState("bg-wt-active", worktree, {
        pid: process.pid,
        workerPid: process.pid,
        uncertainSideEffects: 1,
      }),
    );

    expect(() => removeBackgroundAgent("bg-wt-active")).toThrow(
      /active worker process|side effect/i,
    );
    expect(existsSync(worktree.path)).toBe(true);
    expect(existsSync(statePath("bg-wt-active"))).toBe(true);
  });

  it("corrupt metadata can never make cleanup delete the main checkout", () => {
    const head = git(["rev-parse", "HEAD"], repo);
    writeBackgroundAgentState({
      id: "bg-wt-corrupt",
      status: "failed",
      sessionId: "session-corrupt",
      cwd: repo,
      repoRoot: repo,
      worktreePath: repo,
      baseSha: head,
      branch: "main",
      startedAt: 1,
      endedAt: 2,
    });

    expect(() => removeBackgroundAgent("bg-wt-corrupt")).toThrow(
      /main checkout|unverifiable worktree/i,
    );
    expect(existsSync(join(repo, "README.md"))).toBe(true);
    expect(existsSync(statePath("bg-wt-corrupt"))).toBe(true);
  });
});
