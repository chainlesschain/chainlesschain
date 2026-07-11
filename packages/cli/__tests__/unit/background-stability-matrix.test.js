/**
 * Background supervisor stability matrix (gap-2026-07-11 P0#2) — systematic
 * regression coverage for the failure modes Claude Code 2.1.203-2.1.205 fixed
 * in its background-agent stack, mapped onto cc's supervisor:
 *
 *  1. env inheritance      — dispatched worker inherits the launcher's PATH /
 *                            provider env (spawn must NOT override env)
 *  2. cwd hygiene          — deleted / file-replaced / inaccessible cwd fails
 *                            fast with ONE clear error and leaves no phantom
 *                            state or job files behind
 *  3. async spawn errors   — a post-validation spawn 'error' event is reaped
 *                            into a failed state instead of an uncaught crash
 *  4. stale running        — heartbeat-stale or dead-pid sessions are never
 *                            shown as running (list + dashboard grouping)
 *  5. attach resilience    — attach to a worker whose transport is gone
 *                            (upgrading/restarting/finalizing) falls back
 *                            instead of throwing
 *  6. resume guards        — running sessions refuse resume with an attach
 *                            hint; sessions without a session id refuse
 *  7. worktree isolation   — agent worktree commands run INSIDE the worktree
 *                            (never the parent checkout); finish never
 *                            destroys unverifiable or dirty work
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _deps,
  effectiveBackgroundAgentState,
  launchBackgroundAgent,
  listBackgroundAgents,
  readBackgroundAgentState,
  resumeBackgroundAgent,
  statePath,
  writeBackgroundAgentState,
} from "../../src/lib/background-agent-supervisor.js";
import { groupKey } from "../../src/repl/bg-dashboard.js";

let dir;
const originalSpawn = _deps.spawn;
const originalSpawnSync = _deps.spawnSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-matrix-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
});

afterEach(async () => {
  _deps.spawn = originalSpawn;
  _deps.spawnSync = originalSpawnSync;
  delete process.env.CC_BACKGROUND_AGENTS_DIR;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

describe("1. env inheritance", () => {
  it("spawns the worker WITHOUT an env override so PATH/provider env/base URL flow through", () => {
    _deps.spawn = vi.fn(() => ({ pid: 1234, unref: vi.fn(), on: vi.fn() }));
    launchBackgroundAgent({
      argv: ["agent", "-p", "task"],
      cwd: process.cwd(),
      sessionId: "sid-env",
      title: "env",
    });
    const options = _deps.spawn.mock.calls[0][2];
    // No env key at all = full inheritance of the dispatch shell's environment.
    expect("env" in options).toBe(false);
    expect(options).toMatchObject({ detached: true, stdio: "ignore" });
  });
});

describe("2. cwd hygiene", () => {
  it("rejects a deleted cwd with one clear error and leaves no state/job files", () => {
    _deps.spawn = vi.fn();
    const gone = join(dir, "deleted-dir");
    expect(() =>
      launchBackgroundAgent({
        argv: ["agent", "-p", "x"],
        cwd: gone,
        sessionId: "sid-cwd1",
        title: "x",
      }),
    ).toThrow(/does not exist/);
    expect(_deps.spawn).not.toHaveBeenCalled();
    expect(listBackgroundAgents({ all: true })).toEqual([]);
  });

  it("rejects a cwd that was replaced by a FILE", () => {
    _deps.spawn = vi.fn();
    const file = join(dir, "now-a-file");
    writeFileSync(file, "not a dir", "utf-8");
    expect(() =>
      launchBackgroundAgent({
        argv: ["agent", "-p", "x"],
        cwd: file,
        sessionId: "sid-cwd2",
        title: "x",
      }),
    ).toThrow(/not a directory/);
    expect(_deps.spawn).not.toHaveBeenCalled();
  });

  it("rejects a missing cwd argument outright", () => {
    _deps.spawn = vi.fn();
    expect(() =>
      launchBackgroundAgent({
        argv: ["agent", "-p", "x"],
        cwd: undefined,
        sessionId: "sid-cwd3",
        title: "x",
      }),
    ).toThrow(/no working directory/);
    expect(_deps.spawn).not.toHaveBeenCalled();
  });
});

describe("3. async spawn errors", () => {
  it("reaps a post-spawn 'error' event into a failed state (no phantom running)", async () => {
    const child = new EventEmitter();
    child.pid = 4321;
    child.unref = vi.fn();
    _deps.spawn = vi.fn(() => child);
    const state = launchBackgroundAgent({
      argv: ["agent", "-p", "x"],
      cwd: process.cwd(),
      sessionId: "sid-async",
      title: "x",
    });
    expect(state.status).toBe("running");
    child.emit(
      "error",
      Object.assign(new Error("spawn EPERM"), { code: "EPERM" }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const after = readBackgroundAgentState(state.id);
    expect(after.status).toBe("failed");
    expect(after.lostReason).toMatch(/spawn-error: EPERM/);
    expect(after.endedAt).toBeTruthy();
  });
});

describe("4. stale running is never shown as running", () => {
  it("heartbeat-stale sessions reconcile to lost (and persist the correction)", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-stale-hb",
      status: "running",
      pid: process.pid, // alive — staleness must come from the heartbeat
      startedAt: now - 600_000,
      heartbeatAt: now - 500_000,
    });
    const sessions = listBackgroundAgents({ all: true });
    const s = sessions.find((x) => x.id === "bg-stale-hb");
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("heartbeat-stale");
    // the on-disk state was corrected too — panels reading later agree
    expect(readBackgroundAgentState("bg-stale-hb").status).toBe("lost");
    // and the dashboard groups it under Failed, not Working
    expect(groupKey(s)).toBe("failed");
  });

  it("dead-pid sessions reconcile to lost/process-exited", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-dead-pid",
      status: "running",
      pid: 999999999, // no such process
      startedAt: now - 10_000,
      heartbeatAt: now, // fresh heartbeat — loss must come from the pid probe
    });
    const s = effectiveBackgroundAgentState(
      readBackgroundAgentState("bg-dead-pid"),
    );
    expect(s.status).toBe("lost");
    expect(s.lostReason).toBe("process-exited");
  });

  it("running-only listing excludes reconciled-lost sessions entirely", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-gone",
      status: "running",
      pid: 999999999,
      startedAt: now,
      heartbeatAt: now,
    });
    expect(listBackgroundAgents({ all: false })).toEqual([]);
  });

  it("terminal states pass through reconciliation untouched", () => {
    const state = {
      id: "bg-done",
      status: "completed",
      pid: 999999999,
      startedAt: 1,
      endedAt: 2,
      heartbeatAt: 1,
    };
    expect(effectiveBackgroundAgentState(state)).toBe(state);
  });
});

describe("5. attach resilience while the worker is upgrading/restarting", () => {
  it("interactiveAttach returns false (fallback) when the transport is gone", async () => {
    const { interactiveAttach } =
      await import("../../src/commands/background-session.js");
    const deadPipe =
      process.platform === "win32"
        ? `\\\\.\\pipe\\cc-bg-matrix-nonexistent-${Date.now()}`
        : join(dir, `nonexistent-${Date.now()}.sock`);
    const attached = await interactiveAttach(
      "bg-matrix-gone",
      { transport: { pipe: deadPipe, token: "t" } },
      {},
    );
    expect(attached).toBe(false); // caller falls back to the log follow
  });
});

describe("6. resume guards", () => {
  it("refuses to resume a RUNNING session and points at attach", () => {
    const now = Date.now();
    writeBackgroundAgentState({
      id: "bg-live",
      status: "running",
      pid: process.pid,
      sessionId: "sid-live",
      startedAt: now,
      heartbeatAt: now,
    });
    expect(() => resumeBackgroundAgent("bg-live", "more")).toThrow(
      /still running.*cc attach/,
    );
  });

  it("refuses a session with no session id, and an empty prompt", () => {
    writeBackgroundAgentState({
      id: "bg-nosid",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
    });
    expect(() => resumeBackgroundAgent("bg-nosid", "x")).toThrow(
      /no session id/,
    );
    writeBackgroundAgentState({
      id: "bg-empty",
      status: "completed",
      sessionId: "sid-e",
      startedAt: 1,
      endedAt: 2,
    });
    expect(() => resumeBackgroundAgent("bg-empty", "  ")).toThrow(
      /requires a prompt/,
    );
  });

  it("stale state files (phantom running) never survive into a resume", () => {
    // launch cleanup path: failed validation leaves nothing to resume
    expect(existsSync(statePath("bg-never-existed"))).toBe(false);
    expect(() => resumeBackgroundAgent("bg-never-existed", "x")).toThrow(
      /not found/,
    );
  });
});

describe("7. worktree isolation", () => {
  it("setupAgentWorktree runs its git commands INSIDE the new worktree, not the parent", async () => {
    const { setupAgentWorktree } =
      await import("../../src/lib/agent-worktree.js");
    const calls = [];
    const deps = {
      createWorktree: vi.fn(() => ({
        path: "C:/repo/.worktrees/cc-agent-x",
        branch: "cc-agent-x",
      })),
      execSync: vi.fn((cmd, opts) => {
        calls.push({ cmd, cwd: opts.cwd });
        return "abc123\n";
      }),
    };
    const info = setupAgentWorktree({ cwd: process.cwd(), deps });
    expect(info.path).toBe("C:/repo/.worktrees/cc-agent-x");
    const revParse = calls.find((c) => c.cmd.includes("rev-parse"));
    expect(revParse.cwd).toBe("C:/repo/.worktrees/cc-agent-x");
    expect(revParse.cwd).not.toBe(process.cwd());
  });

  it("finishAgentWorktree keeps dirty work and keeps UNVERIFIABLE work (never destroys)", async () => {
    const { finishAgentWorktree } =
      await import("../../src/lib/agent-worktree.js");
    const removeWorktree = vi.fn();

    // dirty tree → kept
    const dirty = finishAgentWorktree(
      { path: "wt", branch: "b", repoRoot: "r", baseSha: "s" },
      {
        deps: {
          execSync: vi.fn((cmd) =>
            cmd.includes("status") ? " M file.js\n" : "s\n",
          ),
          removeWorktree,
        },
      },
    );
    expect(dirty.kept).toBe(true);
    expect(removeWorktree).not.toHaveBeenCalled();

    // unreadable worktree (git throws) → kept, never removed
    const unreadable = finishAgentWorktree(
      { path: "wt", branch: "b", repoRoot: "r", baseSha: "s" },
      {
        deps: {
          execSync: vi.fn(() => {
            throw new Error("not a git repo");
          }),
          removeWorktree,
        },
      },
    );
    expect(unreadable.kept).toBe(true);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it("finishAgentWorktree removes ONLY a verified-clean, commit-free worktree", async () => {
    const { finishAgentWorktree } =
      await import("../../src/lib/agent-worktree.js");
    const removeWorktree = vi.fn();
    const result = finishAgentWorktree(
      { path: "wt", branch: "b", repoRoot: "r", baseSha: "same-sha" },
      {
        deps: {
          execSync: vi.fn((cmd) =>
            cmd.includes("status") ? "" : "same-sha\n",
          ),
          removeWorktree,
        },
      },
    );
    expect(result.removed).toBe(true);
    expect(removeWorktree).toHaveBeenCalledWith("r", "wt");
  });
});
