/**
 * agent-core executeTool — session-store write guard (transcript tamper
 * protection). Writes aimed at ~/.chainlesschain/sessions confirm first,
 * exactly like the sensitive-file guard: an explicit settings `allow` rule is
 * the only bypass, headless without a confirmer fails closed.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeTool } from "../../src/runtime/agent-core.js";
import { sessionStoreDir } from "../../src/lib/session-store-guard.js";

// Unique per-run filename inside the REAL session store — only the
// confirmer-approved / allow-rule cases actually create it; cleaned up after.
const storeTarget = path.join(
  sessionStoreDir(),
  `guard-test-${process.pid}-${Date.now()}.jsonl`,
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-store-guard-"));

afterEach(() => {
  try {
    fs.rmSync(storeTarget, { force: true });
  } catch {
    /* best-effort */
  }
});

describe("session-store write guard", () => {
  it("denies a write into the session store when the confirmer refuses", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "write_file",
      { path: storeTarget, content: '{"forged":true}\n' },
      {
        cwd: tmp,
        permissionConfirm: async () => {
          confirmerCalls++;
          return false;
        },
      },
    );
    expect(res.error).toMatch(/\[Session Store\]/);
    expect(confirmerCalls).toBe(1);
    expect(fs.existsSync(storeTarget)).toBe(false);
  });

  it("fails closed headless (no confirmer)", async () => {
    const res = await executeTool(
      "write_file",
      { path: storeTarget, content: "x" },
      { cwd: tmp },
    );
    expect(res.error).toMatch(/\[Session Store\]/);
    expect(fs.existsSync(storeTarget)).toBe(false);
  });

  it("proceeds when the confirmer approves", async () => {
    const res = await executeTool(
      "write_file",
      { path: storeTarget, content: "approved\n" },
      {
        cwd: tmp,
        permissionConfirm: async () => true,
      },
    );
    expect(res.error).toBeUndefined();
    expect(fs.existsSync(storeTarget)).toBe(true);
  });

  it("an explicit settings allow rule bypasses the prompt", async () => {
    let confirmerCalls = 0;
    const res = await executeTool(
      "write_file",
      { path: storeTarget, content: "allowed\n" },
      {
        cwd: tmp,
        permissionRules: { allow: ["Write"] },
        permissionConfirm: async () => {
          confirmerCalls++;
          return false; // would deny if reached — proves the bypass
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(confirmerCalls).toBe(0);
    expect(fs.existsSync(storeTarget)).toBe(true);
  });

  it("does not gate writes outside the session store", async () => {
    let confirmerCalls = 0;
    const outside = path.join(tmp, "normal.txt");
    const res = await executeTool(
      "write_file",
      { path: outside, content: "plain" },
      {
        cwd: tmp,
        permissionConfirm: async () => {
          confirmerCalls++;
          return false;
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(confirmerCalls).toBe(0);
    expect(fs.readFileSync(outside, "utf-8")).toBe("plain");
  });
});
