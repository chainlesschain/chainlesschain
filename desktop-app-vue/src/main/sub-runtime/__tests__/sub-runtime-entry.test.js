/**
 * Unit tests for the sub-runtime JSON-lines dispatcher. Exercises the
 * handler loop directly — no real stdin/stdout, no real child process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

const entryMod = require("../index.js");
const {
  SessionStateManager,
} = require("../../ai-engine/code-agent/session-state-manager.js");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-subrt-"));
}
function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("sub-runtime entry dispatcher", () => {
  let projectRoot;
  let written;
  let exited;
  const parentId = "parent";

  beforeEach(() => {
    projectRoot = makeTmp();
    written = [];
    exited = null;
    entryMod._deps.write = (obj) => written.push(obj);
    entryMod._deps.exit = (code) => {
      exited = code;
    };
    entryMod._deps.SessionStateManager = SessionStateManager;

    // Seed an approved parent plan so createMemberSession succeeds.
    const mgr = new SessionStateManager({ projectRoot });
    mgr.writeIntent(parentId, { goal: "parallel" });
    mgr.writePlan(parentId, { title: "p", steps: ["x"] });
    mgr.approvePlan(parentId);
  });
  afterEach(() => cleanup(projectRoot));

  it("answers unknown cmd with an error and stays alive", async () => {
    const dispatch = entryMod.createDispatcher();
    await dispatch({ cmd: "nope" });
    expect(written).toEqual([{ type: "error", error: `unknown cmd "nope"` }]);
    expect(exited).toBeNull();
  });

  it("run cmd creates member session and streams progress + done", async () => {
    const dispatch = entryMod.createDispatcher();
    await dispatch({
      cmd: "run",
      projectRoot,
      sessionId: parentId,
      assignment: {
        memberIdx: 0,
        role: "executor",
        steps: ["alpha", "beta"],
      },
    });
    const types = written.map((m) => m.type);
    expect(types).toEqual(["progress", "progress", "done"]);
    expect(written[0]).toMatchObject({
      type: "progress",
      memberId: `${parentId}.m0-executor`,
      step: "alpha",
      index: 0,
      total: 2,
    });
    expect(written[2]).toMatchObject({ type: "done", success: true });

    // Member's own progress.log must contain both steps.
    const memberLog = fs.readFileSync(
      path.join(
        projectRoot,
        ".chainlesschain",
        "sessions",
        `${parentId}.m0-executor`,
        "progress.log",
      ),
      "utf-8",
    );
    expect(memberLog).toContain("[executor] alpha");
    expect(memberLog).toContain("[executor] beta");
  });

  it("run cmd without assignment returns an error", async () => {
    const dispatch = entryMod.createDispatcher();
    await dispatch({ cmd: "run", projectRoot, sessionId: parentId });
    expect(written[0].type).toBe("error");
    expect(written[0].error).toMatch(/assignment/);
  });

  it("run cmd against non-existent parent reports createMemberSession failure", async () => {
    const dispatch = entryMod.createDispatcher();
    await dispatch({
      cmd: "run",
      projectRoot,
      sessionId: "does-not-exist",
      assignment: { memberIdx: 0, role: "executor", steps: ["x"] },
    });
    expect(written).toHaveLength(1);
    expect(written[0].type).toBe("error");
    expect(written[0].error).toMatch(/createMemberSession failed/);
  });

  it("shutdown cmd writes bye and calls exit(0)", async () => {
    const dispatch = entryMod.createDispatcher();
    await dispatch({ cmd: "shutdown" });
    expect(written).toEqual([{ type: "bye" }]);
    expect(exited).toBe(0);
  });

  it("malformed (non-object) message returns error", async () => {
    const dispatch = entryMod.createDispatcher();
    await dispatch(null);
    expect(written[0]).toEqual({ type: "error", error: "malformed message" });
  });
});
