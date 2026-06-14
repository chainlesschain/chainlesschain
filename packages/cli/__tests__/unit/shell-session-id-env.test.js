/**
 * Agent identity env in shell children (Claude-Code 2.1.132 parity): run_shell
 * foreground + background children get CLAUDECODE=1 ("running under the agent")
 * plus CC_SESSION_ID and its CLAUDE_CODE_SESSION_ID mirror (what CC-targeting
 * scripts/hooks expect) so they can correlate work to the agent session. Script
 * files (not inline `node -e "(...)"`) per the dash-syntax CI lesson.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeTool,
  killAllBackgroundShellTasks,
} from "../../src/runtime/agent-core.js";

const NODE = `"${process.execPath}"`;
let tmp;
let script;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sessenv-"));
  script = path.join(tmp, "echo-session.js");
  // Emit "<CC_SESSION_ID>|<CLAUDE_CODE_SESSION_ID>|<CLAUDECODE>" so one child
  // covers the native var, its Claude-Code mirror, and the under-agent marker.
  fs.writeFileSync(
    script,
    "const e = process.env;" +
      "process.stdout.write(" +
      "(e.CC_SESSION_ID || 'none') + '|' +" +
      "(e.CLAUDE_CODE_SESSION_ID || 'none') + '|' +" +
      "(e.CLAUDECODE || 'none'));",
    "utf-8",
  );
});

afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

afterEach(() => {
  try {
    killAllBackgroundShellTasks();
  } catch {
    /* none running */
  }
});

describe("CC_SESSION_ID env", () => {
  it("foreground run_shell child sees the session id", async () => {
    const res = await executeTool(
      "run_shell",
      { command: `${NODE} "${script}"` },
      { cwd: tmp, sessionId: "sess-fg-42" },
    );
    expect(res.error).toBeUndefined();
    // CC_SESSION_ID + CLAUDE_CODE_SESSION_ID mirror + CLAUDECODE marker
    expect(res.stdout).toBe("sess-fg-42|sess-fg-42|1");
  });

  it("foreground without a session: ids unset but CLAUDECODE still marks the run", async () => {
    // The child inherits process.env; clear any ambient session ids (this suite
    // may itself run under an agent) so "no session" truly yields no id.
    const savedCc = process.env.CC_SESSION_ID;
    const savedClaude = process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.CC_SESSION_ID;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    try {
      const res = await executeTool(
        "run_shell",
        { command: `${NODE} "${script}"` },
        { cwd: tmp },
      );
      expect(res.stdout).toBe("none|none|1");
    } finally {
      if (savedCc !== undefined) process.env.CC_SESSION_ID = savedCc;
      if (savedClaude !== undefined)
        process.env.CLAUDE_CODE_SESSION_ID = savedClaude;
    }
  });

  it("background run_shell child sees the session id", async () => {
    const start = await executeTool(
      "run_shell",
      { command: `${NODE} "${script}"`, run_in_background: true },
      { cwd: tmp, sessionId: "sess-bg-7" },
    );
    expect(start.background).toBe(true);
    // poll until the child exits and the marker is in the stream
    let out = "";
    for (let i = 0; i < 40; i++) {
      const chk = await executeTool(
        "check_shell",
        { task_id: start.task_id },
        {},
      );
      out += chk.stdout || "";
      if (chk.status && chk.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(out).toContain("sess-bg-7|sess-bg-7|1");
  });
});
