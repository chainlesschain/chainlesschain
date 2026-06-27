/**
 * repl-denials — classify/record/format the policy denials reviewed via
 * `/permissions denials` (Claude-Code 2.1.193 recent denials).
 */
import { describe, it, expect } from "vitest";
import {
  classifyDenial,
  recordDenial,
  formatDenials,
  MAX_RECENT_DENIALS,
} from "../../src/lib/repl-denials.js";

describe("classifyDenial", () => {
  it("classifies a settings permission-rule deny (structured policy)", () => {
    const d = classifyDenial({
      tool: "run_shell",
      error:
        '[Permission] Tool "run_shell" denied by settings rule: Bash(rm:*)',
      result: {
        error: "[Permission] …",
        policy: { decision: "deny", rule: "Bash(rm:*)", via: "settings" },
      },
      argsSummary: "rm -rf build",
    });
    expect(d).toMatchObject({
      tool: "run_shell",
      via: "settings",
      rule: "Bash(rm:*)",
      summary: "rm -rf build",
    });
    expect(d.reason).toMatch(/denied by settings rule/);
  });

  it("classifies a shell-policy hard deny (allowed:false)", () => {
    const d = classifyDenial({
      tool: "run_shell",
      result: {
        error: "[Shell Policy] Destructive git command blocked.",
        shellCommandPolicy: {
          allowed: false,
          ruleId: "dangerous-git-reset",
          normalizedCommand: "git reset --hard head~1",
        },
      },
    });
    expect(d).toMatchObject({
      via: "shell-policy",
      rule: "dangerous-git-reset",
      summary: "git reset --hard head~1",
    });
  });

  it("classifies an ApprovalGate deny via the structured approval outcome", () => {
    const d = classifyDenial({
      tool: "run_shell",
      result: {
        error: "[ApprovalGate] command denied (policy)",
        approval: { decision: "deny", via: "policy", riskLevel: "medium" },
      },
      argsSummary: "curl https://x",
    });
    expect(d).toMatchObject({ via: "policy", summary: "curl https://x" });
  });

  it("falls back to the [Hook] prefix when no structured field carries via", () => {
    const d = classifyDenial({
      tool: "write_file",
      result: { error: "[Hook] PreToolUse blocked", policy: { via: "hook" } },
    });
    expect(d).toMatchObject({ tool: "write_file", via: "hook" });
  });

  it("returns null for a plain tool failure (not a policy denial)", () => {
    expect(
      classifyDenial({
        tool: "run_shell",
        result: { error: "command exited with code 1", exitCode: 1 },
      }),
    ).toBeNull();
    expect(
      classifyDenial({
        tool: "read_file",
        error: "ENOENT: no such file or directory",
      }),
    ).toBeNull();
  });

  it("returns null for a successful result", () => {
    expect(
      classifyDenial({ tool: "read_file", result: { ok: true } }),
    ).toBeNull();
    expect(classifyDenial({})).toBeNull();
  });
});

describe("recordDenial (bounded ring buffer)", () => {
  it("appends most-recent-last and caps at MAX_RECENT_DENIALS", () => {
    const log = [];
    for (let i = 0; i < MAX_RECENT_DENIALS + 5; i++) {
      recordDenial(log, {
        tool: "run_shell",
        reason: `r${i}`,
        via: "settings",
      });
    }
    expect(log.length).toBe(MAX_RECENT_DENIALS);
    // oldest 5 dropped → first kept is r5, last is the newest
    expect(log[0].reason).toBe("r5");
    expect(log[log.length - 1].reason).toBe(`r${MAX_RECENT_DENIALS + 4}`);
  });

  it("respects a custom max and ignores bad input", () => {
    const log = [];
    recordDenial(log, { tool: "a" }, 2);
    recordDenial(log, { tool: "b" }, 2);
    recordDenial(log, { tool: "c" }, 2);
    expect(log.map((d) => d.tool)).toEqual(["b", "c"]);
    expect(recordDenial(log, null, 2)).toBe(log); // no-op
    expect(log.length).toBe(2);
  });
});

describe("formatDenials", () => {
  it("renders the empty state", () => {
    expect(formatDenials([])).toMatch(/no tool calls were denied/);
    expect(formatDenials(null)).toMatch(/no tool calls were denied/);
  });

  it("renders most-recent-first with relative time, rule, and reason", () => {
    const now = 100_000;
    const log = [
      {
        tool: "run_shell",
        summary: "rm -rf build",
        reason: "[Permission] denied by settings rule: Bash(rm:*)",
        via: "settings",
        rule: "Bash(rm:*)",
        at: now - 30_000, // 30s ago
      },
      {
        tool: "run_shell",
        summary: "git push --force",
        reason: "[Shell Policy] dangerous git",
        via: "shell-policy",
        rule: null,
        at: now - 5_000, // 5s ago → most recent
      },
    ];
    const out = formatDenials(log, { now });
    // most-recent-first: git push appears before rm
    expect(out.indexOf("git push")).toBeLessThan(out.indexOf("rm -rf"));
    expect(out).toContain("Recent denials (most recent first, 2)");
    expect(out).toContain("[settings:Bash(rm:*) · 30s ago]");
    expect(out).toContain("[shell-policy · 5s ago]");
    expect(out).toContain("[Shell Policy] dangerous git");
  });
});
