/**
 * CC_SESSION_ID in shell children (Claude-Code CLAUDE_CODE_SESSION_ID parity,
 * 2.1.132): run_shell foreground + background children can correlate work to
 * the agent session. Script files (not inline `node -e "(...)"`) per the
 * dash-syntax CI lesson.
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
  fs.writeFileSync(
    script,
    "process.stdout.write(process.env.CC_SESSION_ID || 'none');",
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
    expect(res.stdout).toBe("sess-fg-42");
  });

  it("foreground without a session stays unset", async () => {
    const res = await executeTool(
      "run_shell",
      { command: `${NODE} "${script}"` },
      { cwd: tmp },
    );
    expect(res.stdout).toBe("none");
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
    expect(out).toContain("sess-bg-7");
  });
});
