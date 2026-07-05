/**
 * agent-core executeTool — settings.json `PermissionRequest` hooks
 * (Claude-Code parity, Phase 6 event).
 *
 * PermissionRequest fires at the exact moment a tool call would prompt the user
 * for approval — at EVERY interactive permission gate (settings-rule `ask`,
 * sensitive-file, destructive-git, credential, PreToolUse-hook `ask`). A hook
 * can:
 *   - auto-APPROVE (`decision:allow` / `permissionDecision:allow`) → tool runs,
 *     the confirmer is NEVER called.
 *   - auto-DENY (`decision:deny|block` / `permissionDecision:deny` / exit 2) →
 *     tool blocked, the confirmer is NEVER called.
 *   - DEFER (`ask` / no decision / no matching hook) → fall through to the
 *     normal confirmer, byte-identical to before.
 *
 * Hook commands are real `node -e` invocations (deterministic, cross-platform),
 * matching the existing agent-core-hooks.test.js style.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeTool } from "../../src/runtime/agent-core.js";

let tmp, file;

const perm = (command, matcher = "*") => ({
  PermissionRequest: [{ matcher, hooks: [{ type: "command", command }] }],
});

// Cross-platform node one-liners (double-quoted so Windows cmd is happy;
// single-quoted JSON inside).
const HOOK_ALLOW =
  "node -e \"console.log(JSON.stringify({decision:'allow'}))\"";
const HOOK_DENY = "node -e \"console.log(JSON.stringify({decision:'deny'}))\"";
const HOOK_DENY_PD =
  "node -e \"console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny'}}))\"";
const HOOK_ASK =
  "node -e \"console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'ask'}}))\"";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-permreq-"));
  file = path.join(tmp, "note.txt");
  fs.writeFileSync(file, "hello", "utf-8");
});
afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("PermissionRequest at the settings-rule ask gate", () => {
  it("auto-APPROVES: tool runs and the confirmer is never called", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        settingsHooks: perm(HOOK_ALLOW),
        permissionConfirm: async () => {
          confirmerCalls++;
          return false; // would deny if reached — proves it isn't
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(confirmerCalls).toBe(0);
  });

  it("auto-DENIES (decision:deny): blocked and the confirmer is never called", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        settingsHooks: perm(HOOK_DENY),
        permissionConfirm: async () => {
          confirmerCalls++;
          return true; // would allow if reached — proves it isn't
        },
      },
    );
    expect(res.error).toMatch(/\[Permission\]/);
    expect(confirmerCalls).toBe(0);
  });

  it("auto-DENIES via hookSpecificOutput.permissionDecision:deny", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        settingsHooks: perm(HOOK_DENY_PD),
        permissionConfirm: async () => {
          confirmerCalls++;
          return true;
        },
      },
    );
    expect(res.error).toMatch(/\[Permission\]/);
    expect(confirmerCalls).toBe(0);
  });

  it("DEFERS on `ask`: falls through to the confirmer (approve → runs)", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        settingsHooks: perm(HOOK_ASK),
        permissionConfirm: async () => {
          confirmerCalls++;
          return true;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(confirmerCalls).toBe(1); // deferred to the prompt
  });

  it("only fires for a matching tool (matcher Edit misses read_file → confirmer runs)", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        settingsHooks: perm(HOOK_ALLOW, "Edit"), // wrong tool
        permissionConfirm: async () => {
          confirmerCalls++;
          return true;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(confirmerCalls).toBe(1); // hook didn't match → normal prompt
  });
});

describe("no PermissionRequest hook → default behaviour is byte-identical", () => {
  it("confirmer is called exactly as before (decline → denied)", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        permissionConfirm: async () => {
          confirmerCalls++;
          return false;
        },
      },
    );
    expect(res.error).toMatch(/\[Permission\]/);
    expect(confirmerCalls).toBe(1);
  });
});

describe("precedence across multiple hooks: deny wins over allow", () => {
  it("an allow hook followed by a deny hook still blocks (deny wins, safety)", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "read_file",
      { path: file },
      {
        cwd: tmp,
        permissionRules: { ask: ["Read"] },
        settingsHooks: {
          PermissionRequest: [
            {
              matcher: "*",
              hooks: [
                { type: "command", command: HOOK_ALLOW },
                { type: "command", command: HOOK_DENY },
              ],
            },
          ],
        },
        permissionConfirm: async () => {
          confirmerCalls++;
          return true;
        },
      },
    );
    expect(res.error).toMatch(/\[Permission\]/);
    expect(confirmerCalls).toBe(0);
  });
});

describe("PermissionRequest covers other gates, not just settings-rule ask", () => {
  // Destructive-git gate: a `reset --hard` prompts. A PermissionRequest deny
  // blocks it without ever consulting the confirmer — proving the hook is wired
  // at the git gate too, not only the settings-rule gate.
  it("auto-DENIES a destructive git command without calling the confirmer", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "git",
      { command: "reset --hard HEAD~1" },
      {
        cwd: tmp,
        settingsHooks: perm(HOOK_DENY),
        permissionConfirm: async () => {
          confirmerCalls++;
          return true; // would allow if reached
        },
      },
    );
    expect(res.error).toMatch(/\[Destructive Git\]/);
    expect(confirmerCalls).toBe(0);
  });
});
