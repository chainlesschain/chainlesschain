import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  CODING_AGENT_EVENT_CHANNEL,
} = require("../../src/main/ai-engine/code-agent/coding-agent-events.js");
const {
  CodingAgentSessionService,
} = require("../../src/main/ai-engine/code-agent/coding-agent-session-service.js");
const {
  registerCodingAgentIPCV3,
} = require("../../src/main/ai-engine/code-agent/coding-agent-ipc-v3.js");

class MockBridge extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.host = "127.0.0.1";
    this.port = 4318;
    this.sentMessages = [];
    this.policyUpdates = [];
    this.closedSessions = [];
    this.resumed = [];
    this.worktreeListResult = {
      worktrees: [
        {
          branch: "agent/coding-1",
          path: "/repo/.worktrees/agent-coding-1",
          baseBranch: "main",
        },
      ],
    };
    this.diffResult = {
      filePath: null,
      files: [{ path: "src/a.js", changes: 4 }],
      summary: { additions: 4, deletions: 0 },
      diff: "diff --git ...",
    };
    this.mergeResult = {
      success: true,
      strategy: "merge",
      message: "merged",
      conflicts: [],
    };
    this.previewResult = {
      success: true,
      previewOnly: true,
      conflicts: [],
    };
    this.applyResult = {
      success: true,
      filePath: "src/a.js",
      candidateId: "auto-1",
    };
  }

  async ensureReady() {
    return { host: this.host, port: this.port };
  }

  async createSession(options = {}) {
    const message = {
      id: "session-create-req",
      type: "session-created",
      sessionId: "session-x",
      record: {
        provider: options.provider || "openai",
        model: options.model || "gpt-4o-mini",
        projectRoot: options.projectRoot || "/repo",
        worktree: options.worktreeIsolation
          ? {
              branch: "agent/coding-1",
              path: "/repo/.worktrees/agent-coding-1",
            }
          : null,
        worktreeIsolation: options.worktreeIsolation === true,
      },
    };
    this.emit("message", message);
    return message;
  }

  async resumeSession(sessionId) {
    const history = [
      { role: "user", content: "earlier message" },
      { role: "assistant", content: "earlier reply" },
    ];
    const message = {
      id: "session-resume-req",
      type: "session-resumed",
      sessionId,
      history,
      record: {
        projectRoot: "/repo",
        worktreeIsolation: false,
      },
    };
    this.resumed.push(sessionId);
    this.emit("message", message);
    return message;
  }

  async listSessions() {
    return {
      id: "session-list-req",
      type: "session-list-result",
      sessions: [{ sessionId: "session-x", status: "ready" }],
    };
  }

  async closeSession(sessionId) {
    this.closedSessions.push(sessionId);
    return { id: "session-close-req", type: "result", success: true };
  }

  async updateSessionPolicy(sessionId, hostManagedToolPolicy) {
    this.policyUpdates.push({ sessionId, hostManagedToolPolicy });
    return {
      id: "session-policy-req",
      type: "session-policy-updated",
      success: true,
      sessionId,
    };
  }

  async listWorktrees() {
    return {
      id: "worktree-list-req",
      type: "worktree-list",
      ...this.worktreeListResult,
    };
  }

  async diffWorktree(branch, options) {
    return {
      id: "worktree-diff-req",
      type: "worktree-diff",
      branch,
      ...this.diffResult,
    };
  }

  async mergeWorktree(branch, options) {
    return {
      id: "worktree-merge-req",
      type: "worktree-merged",
      branch,
      ...this.mergeResult,
    };
  }

  async previewWorktreeMerge(branch, options) {
    return {
      id: "worktree-merge-preview-req",
      type: "worktree-merge-preview",
      branch,
      ...this.previewResult,
    };
  }

  async applyWorktreeAutomationCandidate(branch, options) {
    return {
      id: "worktree-automation-req",
      type: "worktree-automation-applied",
      branch,
      ...this.applyResult,
    };
  }

  send(message) {
    this.sentMessages.push(message);
  }

  async shutdown() {
    return undefined;
  }
}

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Coding agent lifecycle integration", () => {
  let bridge;
  let ipcMainMock;
  let mainWindow;
  let service;

  beforeEach(() => {
    bridge = new MockBridge();
    ipcMainMock = createMockIpcMain();
    mainWindow = {
      webContents: { send: vi.fn() },
      isDestroyed: vi.fn(() => false),
    };

    service = new CodingAgentSessionService({
      bridge,
      mainWindow,
      repoRoot: "/repo",
      projectRoot: "/repo",
    });

    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });
  });

  it("registers all expected IPC channels", () => {
    expect(Object.keys(ipcMainMock.handlers).sort()).toEqual(
      [
        "coding-agent:apply-worktree-automation",
        "coding-agent:approve-plan",
        "coding-agent:cancel-session",
        "coding-agent:close-session",
        "coding-agent:confirm-high-risk-execution",
        "coding-agent:create-session",
        "coding-agent:enter-plan-mode",
        "coding-agent:get-session-events",
        "coding-agent:get-session-state",
        "coding-agent:get-status",
        "coding-agent:get-worktree-diff",
        "coding-agent:list-sessions",
        "coding-agent:list-worktrees",
        "coding-agent:merge-worktree",
        "coding-agent:preview-worktree-merge",
        "coding-agent:reject-plan",
        "coding-agent:resume-session",
        "coding-agent:send-message",
        "coding-agent:show-plan",
      ].sort(),
    );
  });

  it("handles plan-mode lifecycle: enter → show → approve → reject", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const enter = await ipcMainMock.handlers["coding-agent:enter-plan-mode"](
      {},
      "session-x",
    );
    expect(enter).toMatchObject({ success: true, command: "/plan" });

    const show = await ipcMainMock.handlers["coding-agent:show-plan"](
      {},
      "session-x",
    );
    expect(show.command).toBe("/plan show");

    const approve = await ipcMainMock.handlers["coding-agent:approve-plan"](
      {},
      "session-x",
    );
    expect(approve.command).toBe("/plan approve");

    const reject = await ipcMainMock.handlers["coding-agent:reject-plan"](
      {},
      "session-x",
    );
    expect(reject.command).toBe("/plan reject");

    // All four slash commands were forwarded over the bridge.
    const slashCommands = bridge.sentMessages
      .filter((msg) => msg.type === "slash-command")
      .map((msg) => msg.command);
    expect(slashCommands).toEqual([
      "/plan",
      "/plan show",
      "/plan approve",
      "/plan reject",
    ]);
  });

  it("blocks sendMessage until high-risk execution is confirmed", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    // A plan-ready event with high-risk tool items flips the session into
    // requiresHighRiskConfirmation=true. This is the real production trigger.
    bridge.emit("message", {
      type: "plan-ready",
      sessionId: "session-x",
      summary: "Run dangerous shell",
      items: [{ toolName: "run_shell", riskLevel: "high", title: "rm -rf" }],
    });
    await flushMicrotasks();

    // sendMessage should be rejected with an explanatory error.
    await expect(
      ipcMainMock.handlers["coding-agent:send-message"](
        {},
        { sessionId: "session-x", content: "rm -rf /" },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/high-risk/i),
    });

    // Confirm and try again.
    const confirmResult = await ipcMainMock.handlers[
      "coding-agent:confirm-high-risk-execution"
    ]({}, "session-x");
    expect(confirmResult.success).toBe(true);

    const sendResult = await ipcMainMock.handlers["coding-agent:send-message"](
      {},
      { sessionId: "session-x", content: "now go" },
    );
    expect(sendResult.success).toBe(true);

    // The bridge should have received the actual session-message.
    const sessionMessages = bridge.sentMessages.filter(
      (msg) => msg.type === "session-message",
    );
    expect(sessionMessages).toHaveLength(1);
    expect(sessionMessages[0]).toMatchObject({
      sessionId: "session-x",
      content: "now go",
    });
  });

  it("resumes a previous session and restores history", async () => {
    const result = await ipcMainMock.handlers["coding-agent:resume-session"](
      {},
      "session-x",
    );
    expect(result).toMatchObject({
      success: true,
      sessionId: "session-x",
    });
    expect(result.history).toEqual([
      { role: "user", content: "earlier message" },
      { role: "assistant", content: "earlier reply" },
    ]);

    const stateResult = await ipcMainMock.handlers[
      "coding-agent:get-session-state"
    ]({}, "session-x");
    expect(stateResult.session.status).toBe("ready");
    expect(stateResult.session.history).toHaveLength(2);
  });

  it("drives the worktree flow: list → preview → diff → merge → apply", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"](
      {},
      { worktreeIsolation: true },
    );

    const list = await ipcMainMock.handlers["coding-agent:list-worktrees"]({});
    expect(list.success).toBe(true);
    expect(list.worktrees).toHaveLength(1);

    const preview = await ipcMainMock.handlers[
      "coding-agent:preview-worktree-merge"
    ]({}, { sessionId: "session-x" });
    expect(preview.success).toBe(true);
    expect(preview.previewOnly).toBe(true);

    const diff = await ipcMainMock.handlers["coding-agent:get-worktree-diff"](
      {},
      { sessionId: "session-x" },
    );
    expect(diff.success).toBe(true);
    expect(diff.files).toHaveLength(1);

    const merge = await ipcMainMock.handlers["coding-agent:merge-worktree"](
      {},
      { sessionId: "session-x" },
    );
    expect(merge.success).toBe(true);
    expect(merge.strategy).toBe("merge");

    const apply = await ipcMainMock.handlers[
      "coding-agent:apply-worktree-automation"
    ](
      {},
      {
        sessionId: "session-x",
        filePath: "src/a.js",
        candidateId: "auto-1",
      },
    );
    expect(apply.success).toBe(true);
    expect(apply.candidateId).toBe("auto-1");
  });

  it("returns a non-throwing failure when sending without a session", async () => {
    const result = await ipcMainMock.handlers["coding-agent:send-message"](
      {},
      { sessionId: "no-such-session", content: "hi" },
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not found/);
  });

  it("close-session marks the session as closed locally", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});
    const closeResult = await ipcMainMock.handlers[
      "coding-agent:close-session"
    ]({}, "session-x");
    expect(closeResult).toMatchObject({
      success: true,
      sessionId: "session-x",
    });
    expect(bridge.closedSessions).toContain("session-x");

    const stateAfterClose = await ipcMainMock.handlers[
      "coding-agent:get-session-state"
    ]({}, "session-x");
    expect(stateAfterClose.session.status).toBe("closed");
  });

  it("cancel-session is an alias of close-session", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});
    const result = await ipcMainMock.handlers["coding-agent:cancel-session"](
      {},
      "session-x",
    );
    expect(result.success).toBe(true);
    expect(bridge.closedSessions).toContain("session-x");
  });

  it("get-status surfaces bridge connectivity and tool summary", async () => {
    const status = await ipcMainMock.handlers["coding-agent:get-status"]({});
    expect(status.success).toBe(true);
    expect(status.server).toMatchObject({
      connected: true,
      host: "127.0.0.1",
      port: 4318,
    });
    expect(status.permissionPolicy).toBeDefined();
    expect(Array.isArray(status.tools)).toBe(true);
  });

  it("emits session events to the renderer via webContents.send", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});
    const renderedTypes = mainWindow.webContents.send.mock.calls
      .filter(([channel]) => channel === CODING_AGENT_EVENT_CHANNEL)
      .map(([, event]) => event.type);
    expect(renderedTypes).toContain("session-created");
  });
});
