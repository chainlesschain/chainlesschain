import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  registerWorkflowSessionIPC,
  CHANNELS,
  summarizeSession,
} = require("../workflow-session-ipc.js");
const { SessionStateManager } = require("../session-state-manager.js");

let tmpRoot;
let manager;
let ipcMain;
let invokers;

function makeFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel);
      if (!fn) {
        throw new Error(`no handler for "${channel}"`);
      }
      return fn({}, ...args);
    },
  };
}

function seedApprovedPlan(sessionId) {
  manager.writeIntent(sessionId, { goal: "ship feature X" });
  manager.writePlan(sessionId, {
    title: "Feature X",
    steps: ["a", "b"],
  });
  manager.approvePlan(sessionId);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wsipc-"));
  manager = new SessionStateManager({ projectRoot: tmpRoot });
  ipcMain = makeFakeIpcMain();
  registerWorkflowSessionIPC({ ipcMain, projectRoot: tmpRoot });
  invokers = {
    list: () => ipcMain.invoke("workflow-session:list"),
    get: (id) => ipcMain.invoke("workflow-session:get", id),
    listMembers: (id) => ipcMain.invoke("workflow-session:list-members", id),
    classify: (input) =>
      ipcMain.invoke("workflow-session:classify-intake", input),
  };
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("workflow-session-ipc", () => {
  it("exposes the 4 canonical channels", () => {
    expect(CHANNELS).toEqual([
      "workflow-session:list",
      "workflow-session:get",
      "workflow-session:list-members",
      "workflow-session:classify-intake",
    ]);
    for (const ch of CHANNELS) {
      expect(ipcMain.handlers.has(ch)).toBe(true);
    }
  });

  it("throws if ipcMain is missing", () => {
    expect(() => registerWorkflowSessionIPC({})).toThrow(
      /ipcMain with .handle\(\) is required/,
    );
  });

  it("list returns empty array when no sessions exist", async () => {
    const res = await invokers.list();
    expect(res).toEqual({ success: true, sessions: [] });
  });

  it("list returns summaries for every session with mode.json", async () => {
    seedApprovedPlan("sess-alpha");
    seedApprovedPlan("sess-beta");
    manager.writeVerify("sess-beta", {
      status: "passed",
      checks: [],
      nextAction: null,
    });

    const res = await invokers.list();
    expect(res.success).toBe(true);
    expect(res.sessions).toHaveLength(2);
    const byId = Object.fromEntries(res.sessions.map((s) => [s.sessionId, s]));
    expect(byId["sess-alpha"].stage).toBe("plan");
    expect(byId["sess-beta"].stage).toBe("verify");
    for (const s of res.sessions) {
      expect(s.updatedAt).toBeTruthy();
      expect(s.retries).toBe(0);
    }
  });

  it("list tolerates sessions without mode.json (stage=null)", async () => {
    // A bare directory with no mode.json — simulates a hand-created folder
    fs.mkdirSync(path.join(tmpRoot, ".chainlesschain", "sessions", "bare"), {
      recursive: true,
    });
    const res = await invokers.list();
    expect(res.success).toBe(true);
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0]).toMatchObject({
      sessionId: "bare",
      stage: null,
      retries: 0,
    });
  });

  it("get returns error when sessionId missing", async () => {
    const res = await invokers.get("");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId is required/);
  });

  it("get returns error for unknown session", async () => {
    const res = await invokers.get("nope");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it("get returns full bundle (intent/plan/tasks/verify/progress/mode)", async () => {
    seedApprovedPlan("sess-full");
    manager.writeTasks("sess-full", {
      tasks: [{ id: "t1", status: "pending", scopePaths: ["src/main"] }],
    });
    manager.appendProgress("sess-full", "started executor");
    manager.writeVerify("sess-full", {
      status: "passed",
      checks: [{ id: "unit", command: "npm test", status: "passed" }],
      nextAction: "complete",
    });

    const res = await invokers.get("sess-full");
    expect(res.success).toBe(true);
    const s = res.state;
    expect(s.sessionId).toBe("sess-full");
    expect(s.stage).toBe("verify");
    expect(s.intent).toMatch(/ship feature X/);
    expect(s.plan.approved).toBe(true);
    expect(s.plan.raw).toMatch(/# Plan: Feature X/);
    expect(s.tasks.tasks).toHaveLength(1);
    expect(s.tasks.tasks[0].id).toBe("t1");
    expect(s.verify.status).toBe("passed");
    expect(s.verify.checks[0].id).toBe("unit");
    expect(s.progress).toMatch(/started executor/);
    expect(s.summary).toBeNull();
    expect(Array.isArray(s.artifacts)).toBe(true);
  });

  it("get reports null fields when files are missing", async () => {
    manager.markIntake("sess-empty"); // only mode.json
    const res = await invokers.get("sess-empty");
    expect(res.success).toBe(true);
    expect(res.state.stage).toBe("intake");
    expect(res.state.intent).toBeNull();
    expect(res.state.plan).toBeNull();
    expect(res.state.tasks).toBeNull();
    expect(res.state.verify).toBeNull();
    expect(res.state.summary).toBeNull();
    expect(res.state.progress).toBeNull();
  });

  it("list-members surfaces $team fan-out sessions", async () => {
    seedApprovedPlan("sess-parent");
    const { memberId: m0 } = manager.createMemberSession("sess-parent", 0, {
      role: "executor",
      steps: ["do a"],
    });
    const { memberId: m1 } = manager.createMemberSession("sess-parent", 1, {
      role: "tester",
      steps: ["run tests"],
    });

    const res = await invokers.listMembers("sess-parent");
    expect(res.success).toBe(true);
    expect(res.members.map((m) => m.sessionId).sort()).toEqual([m0, m1].sort());
    // Each member should carry a stage (execute, set by createMemberSession)
    for (const m of res.members) {
      expect(m.stage).toBe("execute");
    }
  });

  it("list-members returns empty when parent has no members", async () => {
    seedApprovedPlan("sess-lonely");
    const res = await invokers.listMembers("sess-lonely");
    expect(res).toEqual({ success: true, members: [] });
  });

  it("list-members errors cleanly when parentId missing", async () => {
    const res = await invokers.listMembers("");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/parentId is required/);
  });

  it("projectRoot may be a function (resolved per call)", async () => {
    let current = tmpRoot;
    const ipc2 = makeFakeIpcMain();
    registerWorkflowSessionIPC({ ipcMain: ipc2, projectRoot: () => current });

    seedApprovedPlan("sess-dyn");
    let res = await ipc2.invoke("workflow-session:list");
    expect(res.sessions.map((s) => s.sessionId)).toContain("sess-dyn");

    // Switch to an empty directory — the next call should return 0 sessions
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "cc-wsipc2-"));
    current = tmp2;
    res = await ipc2.invoke("workflow-session:list");
    expect(res.sessions).toEqual([]);
    fs.rmSync(tmp2, { recursive: true, force: true });
  });

  it("classify-intake returns a pure decision for text-only input", async () => {
    const res = await invokers.classify({
      request: "fix a typo in README",
    });
    expect(res.success).toBe(true);
    expect(res.classification.decision).toBe("ralph");
    expect(res.classification.complexity).toBe("trivial");
  });

  it("classify-intake routes multi-scope requests to team", async () => {
    const res = await invokers.classify({
      request: "wire IPC and store",
      scopePaths: [
        "desktop-app-vue/src/main/x.js",
        "desktop-app-vue/src/renderer/y.ts",
      ],
    });
    expect(res.success).toBe(true);
    expect(res.classification.decision).toBe("team");
    expect(res.classification.scopeCount).toBe(2);
  });

  it("classify-intake enriches with tasks.json when sessionId provided", async () => {
    seedApprovedPlan("sess-tasked");
    manager.writeTasks("sess-tasked", {
      tasks: [
        {
          id: "t1",
          status: "pending",
          scopePaths: ["desktop-app-vue/src/main/a.js"],
        },
        {
          id: "t2",
          status: "pending",
          scopePaths: ["backend/project-service/b.java"],
        },
      ],
    });

    const res = await invokers.classify({
      sessionId: "sess-tasked",
      request: "continue execution",
    });
    expect(res.success).toBe(true);
    expect(res.classification.decision).toBe("team");
    expect(res.classification.scopeCount).toBe(2);
    expect(res.classification.boundaries.sort()).toEqual(
      ["backend/project-service", "desktop-app-vue/src/main"].sort(),
    );
  });

  it("classify-intake tolerates unknown sessionId (falls back to text)", async () => {
    const res = await invokers.classify({
      sessionId: "missing",
      request: "fix a typo",
    });
    expect(res.success).toBe(true);
    expect(res.classification.decision).toBe("ralph");
  });

  it("summarizeSession helper returns the documented shape", () => {
    seedApprovedPlan("sess-shape");
    const summary = summarizeSession(manager, "sess-shape");
    expect(summary).toMatchObject({
      sessionId: "sess-shape",
      stage: "plan",
      retries: 0,
    });
    expect(summary).toHaveProperty("updatedAt");
    expect(summary).toHaveProperty("maxRetries");
    expect(summary).toHaveProperty("failureReason");
  });
});
