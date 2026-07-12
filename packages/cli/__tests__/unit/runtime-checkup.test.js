/**
 * Runtime Checkup evaluators for `cc doctor` (P2) — stale sessions/worktrees/
 * agenda, orphan processes, slow/broken hooks, dead plugins/LSP, verbose
 * instruction files. Pure + clock-injected.
 */
import { describe, it, expect } from "vitest";
import {
  runRuntimeCheckup,
  checkStaleSessions,
  checkStaleWorktrees,
  checkAgenda,
  checkOrphanProcesses,
  checkHooks,
  checkPluginsAndLsp,
  checkInstructionFiles,
  DEFAULT_CHECKUP_THRESHOLDS,
} from "../../src/lib/runtime-checkup.js";

const DAY = 24 * 60 * 60 * 1000;
const T = DEFAULT_CHECKUP_THRESHOLDS;
const NOW = 1_000 * DAY;

describe("checkStaleSessions", () => {
  it("flags sessions idle past the threshold", () => {
    const out = checkStaleSessions(
      [
        { id: "fresh", lastActiveAt: NOW - DAY },
        { id: "old", lastActiveAt: NOW - 40 * DAY },
      ],
      NOW,
      T,
    );
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe("old");
  });
});

describe("checkStaleWorktrees", () => {
  it("flags merged worktrees (warn) and old unused ones (info)", () => {
    const out = checkStaleWorktrees(
      [
        { path: "/wt/merged", createdAt: NOW - DAY, merged: true },
        { path: "/wt/old", createdAt: NOW - 10 * DAY },
        { path: "/wt/fresh", createdAt: NOW - DAY },
      ],
      NOW,
      T,
    );
    expect(out.map((f) => f.id).sort()).toEqual([
      "merged-worktree",
      "stale-worktree",
    ]);
  });
});

describe("checkAgenda", () => {
  it("flags a due-but-never-fired entry as an error", () => {
    const out = checkAgenda(
      [{ id: "a1", dueAt: NOW - 2 * 60 * 60 * 1000 }],
      NOW,
      T,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("agenda-missed");
    expect(out[0].severity).toBe("error");
  });
  it("does not flag a recently-due entry within the grace window", () => {
    expect(checkAgenda([{ id: "a2", dueAt: NOW - 60_000 }], NOW, T)).toEqual(
      [],
    );
  });
  it("retires long-fired non-recurring entries but keeps recurring ones", () => {
    const out = checkAgenda(
      [
        { id: "done", firedAt: NOW - 40 * DAY },
        { id: "cron", firedAt: NOW - 40 * DAY, recurring: true },
      ],
      NOW,
      T,
    );
    expect(out.map((f) => f.ref)).toEqual(["done"]);
  });
});

describe("checkOrphanProcesses", () => {
  it("flags alive processes whose parent died or session is gone", () => {
    const out = checkOrphanProcesses(
      [
        { pid: 1, alive: true, parentAlive: false },
        { pid: 2, alive: true, sessionId: "gone" },
        { pid: 3, alive: true, sessionId: "live", parentAlive: true },
        { pid: 4, alive: false, parentAlive: false },
      ],
      ["live"],
    );
    expect(out.map((f) => f.ref).sort()).toEqual([1, 2]);
    expect(out.every((f) => f.severity === "error")).toBe(true);
  });
});

describe("checkHooks", () => {
  it("flags open circuits, failing hooks and slow hooks", () => {
    const out = checkHooks(
      [
        { id: "broken", circuitOpen: true, failures: 5 },
        { id: "flaky", failures: 4 },
        { id: "slow", avgMs: 8000 },
        { id: "ok", avgMs: 10, failures: 0 },
      ],
      T,
    );
    const ids = out.map((f) => f.id);
    expect(ids).toContain("hook-circuit-open");
    expect(ids).toContain("hook-failing");
    expect(ids).toContain("hook-slow");
    // an open-circuit hook reports once (circuit), not also failing/slow
    expect(out.filter((f) => f.ref === "broken")).toHaveLength(1);
  });
});

describe("checkPluginsAndLsp", () => {
  it("separates dead LSP servers from dead plugins", () => {
    const out = checkPluginsAndLsp([
      { id: "pyright", kind: "lsp", healthy: false },
      { id: "myplugin", healthy: false },
      { id: "fine", healthy: true },
    ]);
    expect(out.map((f) => f.id).sort()).toEqual(["lsp-dead", "plugin-dead"]);
  });
});

describe("checkInstructionFiles", () => {
  it("flags oversized and code-derivable instruction files", () => {
    const out = checkInstructionFiles(
      [
        { path: "cc.md", bytes: 40 * 1024, derivableRatio: 0.8 },
        { path: "lean.md", bytes: 500, derivableRatio: 0.1 },
      ],
      T,
    );
    expect(out.map((f) => f.id).sort()).toEqual([
      "instructions-derivable",
      "instructions-verbose",
    ]);
  });
});

describe("runRuntimeCheckup (aggregate)", () => {
  it("sorts most-severe first and rolls up by category/severity", () => {
    const report = runRuntimeCheckup({
      now: NOW,
      sessions: [{ id: "old", lastActiveAt: NOW - 40 * DAY }],
      agenda: [{ id: "a1", dueAt: NOW - 2 * 60 * 60 * 1000 }],
      processes: [{ pid: 9, alive: true, parentAlive: false }],
      hooks: [{ id: "slow", avgMs: 8000 }],
      instructionFiles: [{ path: "cc.md", bytes: 40 * 1024 }],
    });
    expect(report.summary.total).toBeGreaterThanOrEqual(4);
    expect(report.findings[0].severity).toBe("error"); // errors first
    expect(report.ok).toBe(false); // has errors
    expect(report.summary.bySeverity.error).toBeGreaterThanOrEqual(1);
  });

  it("tolerates a partial snapshot (missing sections) without crashing", () => {
    const report = runRuntimeCheckup({ hooks: [{ id: "x", avgMs: 9000 }] });
    expect(report.summary.total).toBe(1);
    expect(report.ok).toBe(true); // no errors
  });

  it("skips time-based checks when now is absent", () => {
    const report = runRuntimeCheckup({
      sessions: [{ id: "old", lastActiveAt: 0 }],
    });
    expect(report.summary.total).toBe(0);
  });
});
