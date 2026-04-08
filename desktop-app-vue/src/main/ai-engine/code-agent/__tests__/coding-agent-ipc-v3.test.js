import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  CODING_AGENT_IPC_CHANNELS,
  registerCodingAgentIPCV3,
} = require("../coding-agent-ipc-v3.js");

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

describe("registerCodingAgentIPCV3", () => {
  let ipcMainMock;
  let service;

  beforeEach(() => {
    ipcMainMock = createMockIpcMain();
    service = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      createSession: vi
        .fn()
        .mockResolvedValue({ success: true, sessionId: "session-1" }),
      resumeSession: vi.fn().mockResolvedValue({ success: true }),
      listSessions: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
      sendMessage: vi
        .fn()
        .mockResolvedValue({ success: true, requestId: "message-1" }),
      enterPlanMode: vi
        .fn()
        .mockResolvedValue({ success: true, requestId: "plan-enter" }),
      showPlan: vi
        .fn()
        .mockResolvedValue({ success: true, requestId: "plan-show" }),
      approvePlan: vi
        .fn()
        .mockResolvedValue({ success: true, requestId: "plan-approve" }),
      confirmHighRiskExecution: vi
        .fn()
        .mockReturnValue({ success: true, highRiskConfirmationGranted: true }),
      respondApproval: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        approvalType: "high-risk",
        decision: "granted",
      }),
      rejectPlan: vi
        .fn()
        .mockResolvedValue({ success: true, requestId: "plan-reject" }),
      closeSession: vi.fn().mockResolvedValue({ success: true }),
      cancelSession: vi.fn().mockResolvedValue({ success: true }),
      getSessionState: vi.fn().mockReturnValue({
        success: true,
        session: { sessionId: "session-1" },
      }),
      getSessionEvents: vi.fn().mockReturnValue({ success: true, events: [] }),
      listWorktrees: vi
        .fn()
        .mockResolvedValue({ success: true, worktrees: [] }),
      getWorktreeDiff: vi
        .fn()
        .mockResolvedValue({ success: true, branch: "coding-agent/session-1" }),
      previewWorktreeMerge: vi.fn().mockResolvedValue({
        success: false,
        branch: "coding-agent/session-1",
        previewOnly: true,
      }),
      mergeWorktree: vi
        .fn()
        .mockResolvedValue({ success: true, branch: "coding-agent/session-1" }),
      applyWorktreeAutomationCandidate: vi
        .fn()
        .mockResolvedValue({ success: true, branch: "coding-agent/session-1" }),
      getStatus: vi
        .fn()
        .mockReturnValue({ success: true, server: { connected: true } }),
    };
  });

  it("registers the full coding agent IPC surface and clears stale handlers", () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    expect(Object.keys(ipcMainMock.handlers)).toHaveLength(
      CODING_AGENT_IPC_CHANNELS.length,
    );
    expect(ipcMainMock.removeHandler).toHaveBeenCalledTimes(
      CODING_AGENT_IPC_CHANNELS.length,
    );
    expect(ipcMainMock.handlers["coding-agent:show-plan"]).toBeTypeOf(
      "function",
    );
  });

  it("delegates show-plan to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:show-plan"](
      {},
      "session-1",
    );

    expect(service.showPlan).toHaveBeenCalledWith("session-1");
    expect(result).toEqual({ success: true, requestId: "plan-show" });
  });

  it("registers start-session as an alias of create-session", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const payload = { provider: "openai" };
    const result = await ipcMainMock.handlers["coding-agent:start-session"](
      {},
      payload,
    );

    expect(service.ensureReady).toHaveBeenCalled();
    expect(service.createSession).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ success: true, sessionId: "session-1" });
  });

  it("delegates high-risk confirmation to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers[
      "coding-agent:confirm-high-risk-execution"
    ]({}, "session-1");

    expect(service.confirmHighRiskExecution).toHaveBeenCalledWith("session-1");
    expect(result).toEqual({
      success: true,
      highRiskConfirmationGranted: true,
    });
  });

  it("delegates generic approval responses to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const payload = {
      sessionId: "session-1",
      approvalType: "high-risk",
      decision: "granted",
    };
    const result = await ipcMainMock.handlers["coding-agent:respond-approval"](
      {},
      payload,
    );

    expect(service.respondApproval).toHaveBeenCalledWith("session-1", payload);
    expect(result).toEqual({
      success: true,
      sessionId: "session-1",
      approvalType: "high-risk",
      decision: "granted",
    });
  });

  it("delegates worktree diff requests to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:get-worktree-diff"](
      {},
      { sessionId: "session-1", baseBranch: "main" },
    );

    expect(service.getWorktreeDiff).toHaveBeenCalledWith("session-1", {
      sessionId: "session-1",
      baseBranch: "main",
    });
    expect(result).toEqual({
      success: true,
      branch: "coding-agent/session-1",
    });
  });

  it("registers interrupt as an alias of cancel-session", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:interrupt"](
      {},
      "session-1",
    );

    expect(service.cancelSession).toHaveBeenCalledWith("session-1");
    expect(result).toEqual({ success: true });
  });

  it("delegates worktree merge preview requests to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const payload = { sessionId: "session-1", baseBranch: "main" };
    const result = await ipcMainMock.handlers[
      "coding-agent:preview-worktree-merge"
    ]({}, payload);

    expect(service.previewWorktreeMerge).toHaveBeenCalledWith(
      "session-1",
      payload,
    );
    expect(result).toEqual({
      success: false,
      branch: "coding-agent/session-1",
      previewOnly: true,
    });
  });

  it("delegates worktree automation requests to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const payload = {
      sessionId: "session-1",
      filePath: "README.md",
      candidateId: "accept-current",
      conflictType: "both_modified",
    };
    const result = await ipcMainMock.handlers[
      "coding-agent:apply-worktree-automation"
    ]({}, payload);

    expect(service.applyWorktreeAutomationCandidate).toHaveBeenCalledWith(
      "session-1",
      payload,
    );
    expect(result).toEqual({
      success: true,
      branch: "coding-agent/session-1",
    });
  });

  it("returns a normalized failure payload when a handler throws", async () => {
    service.sendMessage.mockRejectedValue(new Error("send failed"));
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:send-message"](
      {},
      {
        sessionId: "session-1",
        content: "hello",
      },
    );

    expect(result).toEqual({ success: false, error: "send failed" });
  });
});
