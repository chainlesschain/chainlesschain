/**
 * agent-core executeTool — destructive-git guard (Claude-Code 2.1.183 parity:
 * "destructive git commands blocked when unintended").
 *
 * The `git` tool otherwise runs any command unguarded in auto mode. The guard:
 *   - destructive git + no confirmer (headless) → fails closed (denied, NOT run);
 *   - destructive git + confirmer declines       → denied;
 *   - destructive git + confirmer approves        → proceeds to execution;
 *   - destructive git + explicit settings allow   → proceeds without prompting;
 *   - benign/recoverable git                      → unaffected (no prompt).
 *
 * Execution is exercised inside a throwaway git repo so the "approved" path
 * does real, harmless work (a `reset --hard` on a clean repo is a no-op).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { executeTool } from "../../src/runtime/agent-core.js";

let tmp;

function git(cmd) {
  execSync(`git ${cmd}`, { cwd: tmp, stdio: "ignore" });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dgit-"));
  git("init -q");
  git("config user.email t@t.t");
  git("config user.name t");
  fs.writeFileSync(path.join(tmp, "a.txt"), "v1\n", "utf-8");
  git("add -A");
  git("commit -q -m init");
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("destructive-git guard", () => {
  it("fails closed for a destructive git command with no confirmer (headless)", async () => {
    const res = await executeTool(
      "git",
      { command: "reset --hard HEAD~1" },
      { cwd: tmp },
    );
    expect(res.error).toMatch(/\[Destructive Git\]/);
    expect(res.policy).toMatchObject({
      decision: "ask",
      via: "destructive-git",
    });
  });

  it("blocks when the confirmer declines", async () => {
    let asked = null;
    const res = await executeTool(
      "git",
      { command: "clean -fd" },
      {
        cwd: tmp,
        permissionConfirm: async (ctx) => {
          asked = ctx;
          return false;
        },
      },
    );
    expect(res.error).toMatch(/\[Destructive Git\]/);
    expect(asked).toMatchObject({ tool: "git" });
    expect(asked.reason).toMatch(/destructive git command: git clean -fd/);
  });

  it("proceeds to execution when the confirmer approves", async () => {
    // `reset --hard` on a clean repo is a harmless no-op but exercises the path.
    const res = await executeTool(
      "git",
      { command: "reset --hard" },
      { cwd: tmp, permissionConfirm: async () => true },
    );
    expect(res.error).toBeUndefined();
    expect(res.command).toBe("reset --hard");
  });

  it("proceeds without prompting when an explicit settings allow rule matches", async () => {
    let prompted = false;
    const res = await executeTool(
      "git",
      { command: "reset --hard" },
      {
        cwd: tmp,
        permissionRules: { allow: ["git"] },
        permissionConfirm: async () => {
          prompted = true;
          return false;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(prompted).toBe(false);
  });

  it("does NOT guard a benign/recoverable git command", async () => {
    let prompted = false;
    const res = await executeTool(
      "git",
      { command: "status --short" },
      {
        cwd: tmp,
        permissionConfirm: async () => {
          prompted = true;
          return false;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(prompted).toBe(false);
    expect(res.readOnly).toBe(true);
  });
});
