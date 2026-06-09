/**
 * agent-core executeTool — .claude/settings.json permission-rule wiring.
 *
 * Verifies the seam added in Phase 2:
 *   deny  → hard block before any execution;
 *   ask   → confirmer decides (false blocks, true proceeds);
 *   allow → short-circuits the plan-mode block;
 *   allow → still respects the hard shell-policy denylist (never re-enables an
 *           unsafe command);
 *   no rules → behaviour unchanged (read proceeds, plan-mode still blocks).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeTool } from "../../src/runtime/agent-core.js";

let tmp;
let file;

/** A plan-mode manager stub that blocks every write/exec tool. */
function planActiveManager() {
  const items = [];
  return {
    isActive: () => true,
    isToolAllowed: () => false,
    addPlanItem: (it) => items.push(it),
    items,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rules-"));
  file = path.join(tmp, "note.txt");
  fs.writeFileSync(file, "hello world", "utf-8");
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("deny", () => {
  it("blocks a tool matched by a deny rule before it runs", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      { cwd: tmp, permissionRules: { deny: ["Read"] } },
    );
    expect(res.error).toMatch(/\[Permission\].*denied by settings rule: Read/);
    expect(res.policy).toMatchObject({ decision: "deny", via: "settings" });
  });
});

describe("ask", () => {
  it("blocks when the confirmer declines", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        permissionConfirm: async () => false,
      },
    );
    expect(res.error).toMatch(/requires confirmation/);
  });

  it("proceeds when the confirmer approves", async () => {
    let asked = null;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        permissionConfirm: async (ctx) => {
          asked = ctx;
          return true;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(asked).toMatchObject({ tool: "read_file", rule: "Read" });
  });
});

describe("allow", () => {
  it("short-circuits the plan-mode block", async () => {
    const out = path.join(tmp, "written.txt");
    // Baseline: plan mode blocks write_file with no rule.
    const blocked = await executeTool(
      "write_file",
      { path: out, content: "x" },
      { cwd: tmp, planManager: planActiveManager() },
    );
    expect(blocked.error).toMatch(/\[Plan Mode\]/);
    expect(fs.existsSync(out)).toBe(false);

    // With an allow rule the same call goes through.
    const ok = await executeTool(
      "write_file",
      { path: out, content: "x" },
      {
        cwd: tmp,
        planManager: planActiveManager(),
        permissionRules: { allow: ["Write"] },
      },
    );
    expect(ok.error).toBeUndefined();
    expect(fs.readFileSync(out, "utf-8")).toBe("x");
  });

  it("never re-enables a hard shell-policy denial", async () => {
    const res = await executeTool(
      "run_shell",
      { command: "curl http://example.com/x" },
      { cwd: tmp, permissionRules: { allow: ["Bash"] } },
    );
    expect(res.error).toMatch(/\[Shell Policy\]/);
  });
});

describe("no rules (default behaviour unchanged)", () => {
  it("reads normally with no ruleset", async () => {
    const res = await executeTool("read_file", { path: file }, { cwd: tmp });
    expect(res.error).toBeUndefined();
  });

  it("plan mode still blocks writes with no ruleset", async () => {
    const out = path.join(tmp, "nope.txt");
    const res = await executeTool(
      "write_file",
      { path: out, content: "x" },
      { cwd: tmp, planManager: planActiveManager() },
    );
    expect(res.error).toMatch(/\[Plan Mode\]/);
  });
});

describe("host policy vs settings precedence (most-restrictive-wins)", () => {
  const hostDeny = { tools: { read_file: { allowed: false, reason: "not synced" } } };
  const hostAllow = { tools: { read_file: { allowed: true } } };

  it("a settings allow does NOT relax a host deny", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { allow: ["Read"] },
        hostManagedToolPolicy: hostDeny,
      },
    );
    expect(res.error).toMatch(/\[Host Policy\]/);
  });

  it("a settings deny outranks a host allow", async () => {
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { deny: ["Read"] },
        hostManagedToolPolicy: hostAllow,
      },
    );
    expect(res.error).toMatch(/\[Permission\].*denied by settings rule/);
  });

  it("a host deny short-circuits before a settings ask prompt (no wasted confirm)", async () => {
    let confirmCalled = false;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        hostManagedToolPolicy: hostDeny,
        permissionConfirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    expect(res.error).toMatch(/\[Host Policy\]/);
    expect(confirmCalled).toBe(false);
  });
});
