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
  checkHookConfig,
  checkSandbox,
  checkDuplicateSkills,
  DEFAULT_CHECKUP_THRESHOLDS,
} from "../../src/lib/runtime-checkup.js";

const VALID_EVENTS = ["PreToolUse", "PostToolUse", "SessionStart"];

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

describe("checkHookConfig (static settings.json hook validation)", () => {
  it("flags an unknown event whose hooks would never fire", () => {
    const out = checkHookConfig(
      { PreToolYuse: [{ matcher: "Bash", hooks: [{ command: "x" }] }] },
      { validEvents: VALID_EVENTS },
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("hook-unknown-event");
    expect(out[0].severity).toBe("warn");
  });

  it("flags an uncompilable regex matcher", () => {
    const out = checkHookConfig(
      { PreToolUse: [{ matcher: "/[unclosed/", hooks: [{ command: "x" }] }] },
      { validEvents: VALID_EVENTS },
    );
    expect(out.some((f) => f.id === "hook-bad-matcher")).toBe(true);
  });

  it("flags a hook entry with no command", () => {
    const out = checkHookConfig(
      { PostToolUse: [{ matcher: "*", hooks: [{ command: "  " }] }] },
      { validEvents: VALID_EVENTS },
    );
    expect(out.some((f) => f.id === "hook-no-command")).toBe(true);
  });

  it("flags non-positive and over-cap timeouts", () => {
    const out = checkHookConfig(
      {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { command: "a", timeout: 0 },
              { command: "b", timeout: 9999 },
            ],
          },
        ],
      },
      { validEvents: VALID_EVENTS, maxTimeoutSec: 600 },
    );
    const badTimeouts = out.filter((f) => f.id === "hook-bad-timeout");
    expect(badTimeouts).toHaveLength(2);
    expect(badTimeouts.every((f) => f.severity === "info")).toBe(true);
  });

  it("passes a well-formed hook block clean", () => {
    const out = checkHookConfig(
      {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ command: "./guard.sh", timeout: 60 }] },
        ],
        SessionStart: [{ hooks: [{ command: "echo hi" }] }],
      },
      { validEvents: VALID_EVENTS },
    );
    expect(out).toHaveLength(0);
  });

  it("no-ops on a missing / non-object block", () => {
    expect(checkHookConfig(null, { validEvents: VALID_EVENTS })).toEqual([]);
    expect(checkHookConfig("nope", { validEvents: VALID_EVENTS })).toEqual([]);
  });

  it("skips the unknown-event check when no validEvents are supplied", () => {
    const out = checkHookConfig({
      AnythingGoes: [{ hooks: [{ command: "x" }] }],
    });
    expect(out).toHaveLength(0);
  });
});

describe("checkSandbox (real capability / silent degradation)", () => {
  it("flags an ERROR when configured but unavailable and not fail-closed", () => {
    const out = checkSandbox({
      configured: true,
      engine: "docker",
      available: false,
      reason: "docker is not installed",
      failIfUnavailable: false,
      isolationLevel: "container",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sandbox-silent-degrade");
    expect(out[0].severity).toBe("error");
    expect(out[0].message).toMatch(/WITHOUT isolation/);
  });

  it("only WARNs when unavailable but fail-closed (not silent)", () => {
    const out = checkSandbox({
      configured: true,
      engine: "bubblewrap",
      available: false,
      reason: "bwrap is not installed",
      failIfUnavailable: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sandbox-strict-unavailable");
    expect(out[0].severity).toBe("warn");
  });

  it("reports an info with the isolation level when available", () => {
    const out = checkSandbox({
      configured: true,
      engine: "docker",
      available: true,
      isolationLevel: "container",
    });
    expect(out[0].id).toBe("sandbox-active");
    expect(out[0].severity).toBe("info");
    expect(out[0].message).toMatch(/container/);
  });

  it("no-ops when no sandbox is configured", () => {
    expect(checkSandbox({ configured: false })).toEqual([]);
    expect(checkSandbox({})).toEqual([]);
  });
});

describe("checkDuplicateSkills (silent skill shadowing)", () => {
  it("flags an id defined across two layers", () => {
    const out = checkDuplicateSkills([
      { id: "deploy", layer: "cli-bundled" },
      { id: "deploy", layer: "project" },
      { id: "other", layer: "user" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("skill-duplicate");
    expect(out[0].ref).toBe("deploy");
    expect(out[0].layers).toEqual(["cli-bundled", "project"]);
    expect(out[0].message).toMatch(/2 definitions/);
  });

  it("flags a same-layer duplicate too (2 definitions, 1 layer)", () => {
    const out = checkDuplicateSkills([
      { id: "dup", layer: "project" },
      { id: "dup", layer: "project" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].message).toMatch(/2 definitions/);
    expect(out[0].layers).toEqual(["project"]);
  });

  it("is clean when every id is unique", () => {
    expect(
      checkDuplicateSkills([
        { id: "a", layer: "user" },
        { id: "b", layer: "project" },
      ]),
    ).toEqual([]);
  });

  it("no-ops on empty / malformed input", () => {
    expect(checkDuplicateSkills([])).toEqual([]);
    expect(checkDuplicateSkills([null, {}, { layer: "x" }])).toEqual([]);
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
