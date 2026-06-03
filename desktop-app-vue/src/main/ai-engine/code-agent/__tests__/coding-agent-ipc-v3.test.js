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
      interruptSession: vi
        .fn()
        .mockResolvedValue({ success: true, interrupted: true }),
      getSessionState: vi.fn().mockReturnValue({
        success: true,
        session: { sessionId: "session-1" },
      }),
      getSessionEvents: vi.fn().mockReturnValue({ success: true, events: [] }),
      getHarnessStatus: vi.fn().mockResolvedValue({
        success: true,
        harness: {
          sessions: { total: 1, running: 0, waitingApproval: 0, active: 1 },
          worktrees: { tracked: 0, isolated: 0, dirty: 0 },
          backgroundTasks: {
            total: 1,
            pending: 0,
            running: 1,
            completed: 0,
            failed: 0,
            timeout: 0,
          },
        },
      }),
      listBackgroundTasks: vi
        .fn()
        .mockResolvedValue({ success: true, tasks: [{ id: "task-1" }] }),
      getBackgroundTask: vi
        .fn()
        .mockResolvedValue({ success: true, task: { id: "task-1" } }),
      getBackgroundTaskHistory: vi.fn().mockResolvedValue({
        success: true,
        taskId: "task-1",
        history: { items: [] },
      }),
      stopBackgroundTask: vi
        .fn()
        .mockResolvedValue({ success: true, taskId: "task-1" }),
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
      listSubAgents: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        active: [{ id: "sub-1", parentId: "session-1", status: "active" }],
        history: [],
        stats: { active: 1, completed: 0 },
      }),
      getSubAgent: vi.fn().mockResolvedValue({
        success: true,
        subAgent: { id: "sub-1", parentId: "session-1", status: "active" },
      }),
      enterReview: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        reviewState: {
          reviewId: "review-1",
          status: "pending",
          blocking: true,
          comments: [],
          checklist: [],
        },
      }),
      submitReviewComment: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        reviewState: {
          reviewId: "review-1",
          status: "pending",
          blocking: true,
          comments: [
            { id: "c-1", author: "alice", content: "ok", timestamp: "t" },
          ],
          checklist: [],
        },
      }),
      resolveReview: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        reviewState: {
          reviewId: "review-1",
          status: "approved",
          blocking: false,
          decision: "approved",
          comments: [],
          checklist: [],
        },
      }),
      getReviewState: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        reviewState: null,
      }),
      proposePatch: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        patch: {
          patchId: "patch-1",
          status: "pending",
          files: [
            {
              index: 0,
              path: "a.js",
              op: "create",
              stats: { added: 1, removed: 0 },
            },
          ],
          stats: { fileCount: 1, added: 1, removed: 0 },
        },
      }),
      applyPatch: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        patch: { patchId: "patch-1", status: "applied" },
      }),
      rejectPatch: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        patch: { patchId: "patch-1", status: "rejected" },
      }),
      getPatchSummary: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        summary: {
          pending: [],
          history: [],
          totals: { fileCount: 0, added: 0, removed: 0 },
        },
      }),
      createTaskGraph: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a"],
          nodes: { a: { id: "a", status: "pending", dependsOn: [] } },
        },
      }),
      addTaskNode: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        nodeId: "b",
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a", "b"],
          nodes: {
            a: { id: "a", status: "pending", dependsOn: [] },
            b: { id: "b", status: "pending", dependsOn: ["a"] },
          },
        },
      }),
      updateTaskNode: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        nodeId: "a",
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a", "b"],
          nodes: {
            a: { id: "a", status: "completed", dependsOn: [] },
            b: { id: "b", status: "pending", dependsOn: ["a"] },
          },
        },
      }),
      advanceTaskGraph: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        becameReady: ["b"],
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a", "b"],
          nodes: {
            a: { id: "a", status: "completed", dependsOn: [] },
            b: { id: "b", status: "ready", dependsOn: ["a"] },
          },
        },
      }),
      getTaskGraph: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        graph: null,
      }),
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

  it("routes interrupt to the dedicated interruptSession service call", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:interrupt"](
      {},
      "session-1",
    );

    expect(service.interruptSession).toHaveBeenCalledWith("session-1");
    expect(service.cancelSession).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, interrupted: true });
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

  it("delegates harness background-task requests to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const harness = await ipcMainMock.handlers[
      "coding-agent:get-harness-status"
    ]({});
    const tasks = await ipcMainMock.handlers[
      "coding-agent:list-background-tasks"
    ]({}, { status: "running" });
    const task = await ipcMainMock.handlers["coding-agent:get-background-task"](
      {},
      "task-1",
    );
    const history = await ipcMainMock.handlers[
      "coding-agent:get-background-task-history"
    ]({}, { taskId: "task-1", limit: 10 });
    const stop = await ipcMainMock.handlers[
      "coding-agent:stop-background-task"
    ]({}, "task-1");

    expect(service.getHarnessStatus).toHaveBeenCalled();
    expect(service.listBackgroundTasks).toHaveBeenCalledWith({
      status: "running",
    });
    expect(service.getBackgroundTask).toHaveBeenCalledWith("task-1");
    expect(service.getBackgroundTaskHistory).toHaveBeenCalledWith("task-1", {
      taskId: "task-1",
      limit: 10,
    });
    expect(service.stopBackgroundTask).toHaveBeenCalledWith("task-1");
    expect(harness.success).toBe(true);
    expect(tasks).toEqual({ success: true, tasks: [{ id: "task-1" }] });
    expect(task).toEqual({ success: true, task: { id: "task-1" } });
    expect(history).toEqual({
      success: true,
      taskId: "task-1",
      history: { items: [] },
    });
    expect(stop).toEqual({ success: true, taskId: "task-1" });
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

  it("delegates list-sub-agents to the service with a scoped session id", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:list-sub-agents"](
      {},
      { sessionId: "session-1" },
    );

    expect(service.ensureReady).toHaveBeenCalled();
    expect(service.listSubAgents).toHaveBeenCalledWith("session-1");
    expect(result).toEqual({
      success: true,
      sessionId: "session-1",
      active: [{ id: "sub-1", parentId: "session-1", status: "active" }],
      history: [],
      stats: { active: 1, completed: 0 },
    });
  });

  it("supports a string payload for list-sub-agents", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:list-sub-agents"]({}, "session-1");

    expect(service.listSubAgents).toHaveBeenCalledWith("session-1");
  });

  it("passes null sessionId to listSubAgents when omitted", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:list-sub-agents"]({}, {});

    expect(service.listSubAgents).toHaveBeenCalledWith(null);
  });

  it("delegates get-sub-agent to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:get-sub-agent"](
      {},
      { subAgentId: "sub-1", sessionId: "session-1" },
    );

    expect(service.getSubAgent).toHaveBeenCalledWith("sub-1", "session-1");
    expect(result).toEqual({
      success: true,
      subAgent: { id: "sub-1", parentId: "session-1", status: "active" },
    });
  });

  it("supports a string payload for get-sub-agent", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:get-sub-agent"]({}, "sub-1");

    expect(service.getSubAgent).toHaveBeenCalledWith("sub-1", null);
  });

  it("rejects get-sub-agent without a subAgentId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:get-sub-agent"](
      {},
      {},
    );

    expect(service.getSubAgent).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "subAgentId is required",
    });
  });

  it("delegates enter-review to the service with normalized options", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:enter-review"](
      {},
      {
        sessionId: "session-1",
        reason: "gate",
        checklist: [{ id: "a", title: "Item A" }],
        blocking: true,
      },
    );

    expect(service.enterReview).toHaveBeenCalledWith("session-1", {
      reason: "gate",
      requestedBy: undefined,
      checklist: [{ id: "a", title: "Item A" }],
      blocking: true,
    });
    expect(result.success).toBe(true);
    expect(result.reviewState.status).toBe("pending");
  });

  it("rejects enter-review without a sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:enter-review"](
      {},
      {},
    );

    expect(service.enterReview).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "sessionId is required",
    });
  });

  it("delegates submit-review-comment with the update shape", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers[
      "coding-agent:submit-review-comment"
    ](
      {},
      {
        sessionId: "session-1",
        comment: { author: "alice", content: "ok" },
        checklistItemId: "a",
        checklistItemDone: true,
      },
    );

    expect(service.submitReviewComment).toHaveBeenCalledWith("session-1", {
      comment: { author: "alice", content: "ok" },
      checklistItemId: "a",
      checklistItemDone: true,
      checklistItemNote: undefined,
    });
    expect(result.reviewState.comments).toHaveLength(1);
  });

  it("delegates resolve-review and returns the unblocked state", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:resolve-review"](
      {},
      {
        sessionId: "session-1",
        decision: "approved",
        summary: "Ship it",
      },
    );

    expect(service.resolveReview).toHaveBeenCalledWith("session-1", {
      decision: "approved",
      resolvedBy: undefined,
      summary: "Ship it",
    });
    expect(result.reviewState.status).toBe("approved");
    expect(result.reviewState.blocking).toBe(false);
  });

  it("delegates get-review-state and supports a string sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:get-review-state"](
      {},
      "session-1",
    );
    expect(service.getReviewState).toHaveBeenCalledWith("session-1");

    await ipcMainMock.handlers["coding-agent:get-review-state"](
      {},
      { sessionId: "session-1" },
    );
    expect(service.getReviewState).toHaveBeenCalledTimes(2);
  });

  it("rejects review handlers without a sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const submit = await ipcMainMock.handlers[
      "coding-agent:submit-review-comment"
    ]({}, {});
    expect(submit).toEqual({
      success: false,
      error: "sessionId is required",
    });

    const resolve = await ipcMainMock.handlers["coding-agent:resolve-review"](
      {},
      { decision: "approved" },
    );
    expect(resolve).toEqual({
      success: false,
      error: "sessionId is required",
    });

    const state = await ipcMainMock.handlers["coding-agent:get-review-state"](
      {},
      {},
    );
    expect(state).toEqual({
      success: false,
      error: "sessionId is required",
    });
  });

  it("delegates propose-patch to the service with normalized payload", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:propose-patch"](
      {},
      {
        sessionId: "session-1",
        origin: "tool",
        reason: "add helper",
        files: [{ path: "a.js", op: "create", after: "hi" }],
      },
    );

    expect(service.proposePatch).toHaveBeenCalledWith("session-1", {
      files: [{ path: "a.js", op: "create", after: "hi" }],
      origin: "tool",
      reason: "add helper",
      requestId: undefined,
    });
    expect(result.success).toBe(true);
    expect(result.patch.patchId).toBe("patch-1");
  });

  it("delegates apply-patch to the service with patchId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:apply-patch"](
      {},
      { sessionId: "session-1", patchId: "patch-1", note: "ok" },
    );

    expect(service.applyPatch).toHaveBeenCalledWith("session-1", "patch-1", {
      resolvedBy: undefined,
      note: "ok",
    });
    expect(result.patch.status).toBe("applied");
  });

  it("delegates reject-patch to the service with reason", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:reject-patch"](
      {},
      { sessionId: "session-1", patchId: "patch-1", reason: "risky" },
    );

    expect(service.rejectPatch).toHaveBeenCalledWith("session-1", "patch-1", {
      resolvedBy: undefined,
      reason: "risky",
    });
    expect(result.patch.status).toBe("rejected");
  });

  it("delegates get-patch-summary and supports a string sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:get-patch-summary"](
      {},
      "session-1",
    );
    expect(service.getPatchSummary).toHaveBeenCalledWith("session-1");

    await ipcMainMock.handlers["coding-agent:get-patch-summary"](
      {},
      { sessionId: "session-1" },
    );
    expect(service.getPatchSummary).toHaveBeenCalledTimes(2);
  });

  it("rejects patch handlers without a sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const propose = await ipcMainMock.handlers["coding-agent:propose-patch"](
      {},
      {},
    );
    expect(propose).toEqual({ success: false, error: "sessionId is required" });

    const apply = await ipcMainMock.handlers["coding-agent:apply-patch"](
      {},
      { patchId: "p" },
    );
    expect(apply).toEqual({ success: false, error: "sessionId is required" });

    const reject = await ipcMainMock.handlers["coding-agent:reject-patch"](
      {},
      { patchId: "p" },
    );
    expect(reject).toEqual({ success: false, error: "sessionId is required" });

    const summary = await ipcMainMock.handlers[
      "coding-agent:get-patch-summary"
    ]({}, {});
    expect(summary).toEqual({
      success: false,
      error: "sessionId is required",
    });
  });

  it("rejects apply-patch / reject-patch without a patchId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const apply = await ipcMainMock.handlers["coding-agent:apply-patch"](
      {},
      { sessionId: "session-1" },
    );
    expect(apply).toEqual({ success: false, error: "patchId is required" });

    const reject = await ipcMainMock.handlers["coding-agent:reject-patch"](
      {},
      { sessionId: "session-1" },
    );
    expect(reject).toEqual({ success: false, error: "patchId is required" });
  });

  it("delegates create-task-graph to the service with normalized payload", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:create-task-graph"](
      {},
      {
        sessionId: "session-1",
        title: "Plan",
        nodes: [{ id: "a" }],
      },
    );

    expect(service.ensureReady).toHaveBeenCalled();
    expect(service.createTaskGraph).toHaveBeenCalledWith("session-1", {
      graphId: undefined,
      title: "Plan",
      description: undefined,
      nodes: [{ id: "a" }],
    });
    expect(result.success).toBe(true);
    expect(result.graph.graphId).toBe("graph-1");
  });

  it("delegates add-task-node to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:add-task-node"](
      {},
      { sessionId: "session-1", node: { id: "b", dependsOn: ["a"] } },
    );

    expect(service.addTaskNode).toHaveBeenCalledWith("session-1", {
      id: "b",
      dependsOn: ["a"],
    });
    expect(result.nodeId).toBe("b");
  });

  it("delegates update-task-node to the service", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:update-task-node"](
      {},
      {
        sessionId: "session-1",
        nodeId: "a",
        updates: { status: "completed" },
      },
    );

    expect(service.updateTaskNode).toHaveBeenCalledWith("session-1", "a", {
      status: "completed",
    });
    expect(result.graph.nodes.a.status).toBe("completed");
  });

  it("delegates advance-task-graph and supports a string sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:advance-task-graph"](
      {},
      "session-1",
    );
    expect(service.advanceTaskGraph).toHaveBeenCalledWith("session-1");

    await ipcMainMock.handlers["coding-agent:advance-task-graph"](
      {},
      { sessionId: "session-1" },
    );
    expect(service.advanceTaskGraph).toHaveBeenCalledTimes(2);
  });

  it("delegates get-task-graph and supports a string sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    await ipcMainMock.handlers["coding-agent:get-task-graph"]({}, "session-1");
    expect(service.getTaskGraph).toHaveBeenCalledWith("session-1");
  });

  it("rejects task graph handlers without a sessionId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const create = await ipcMainMock.handlers["coding-agent:create-task-graph"](
      {},
      {},
    );
    expect(create).toEqual({ success: false, error: "sessionId is required" });

    const add = await ipcMainMock.handlers["coding-agent:add-task-node"](
      {},
      { node: { id: "x" } },
    );
    expect(add).toEqual({ success: false, error: "sessionId is required" });

    const update = await ipcMainMock.handlers["coding-agent:update-task-node"](
      {},
      { nodeId: "x" },
    );
    expect(update).toEqual({ success: false, error: "sessionId is required" });

    const advance = await ipcMainMock.handlers[
      "coding-agent:advance-task-graph"
    ]({}, {});
    expect(advance).toEqual({ success: false, error: "sessionId is required" });

    const state = await ipcMainMock.handlers["coding-agent:get-task-graph"](
      {},
      {},
    );
    expect(state).toEqual({ success: false, error: "sessionId is required" });
  });

  it("rejects add-task-node without node.id", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const missingNode = await ipcMainMock.handlers[
      "coding-agent:add-task-node"
    ]({}, { sessionId: "session-1" });
    expect(missingNode).toEqual({
      success: false,
      error: "node.id is required",
    });

    const missingId = await ipcMainMock.handlers["coding-agent:add-task-node"](
      {},
      { sessionId: "session-1", node: {} },
    );
    expect(missingId).toEqual({
      success: false,
      error: "node.id is required",
    });
  });

  it("rejects update-task-node without nodeId", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    const result = await ipcMainMock.handlers["coding-agent:update-task-node"](
      {},
      { sessionId: "session-1" },
    );
    expect(result).toEqual({ success: false, error: "nodeId is required" });
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

  it("registers workflow command channels", () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });

    expect(
      ipcMainMock.handlers["coding-agent:check-workflow-command"],
    ).toBeTypeOf("function");
    expect(
      ipcMainMock.handlers["coding-agent:run-workflow-command"],
    ).toBeTypeOf("function");
    expect(CODING_AGENT_IPC_CHANNELS).toContain(
      "coding-agent:check-workflow-command",
    );
    expect(CODING_AGENT_IPC_CHANNELS).toContain(
      "coding-agent:run-workflow-command",
    );
  });

  it("check-workflow-command matches $deep-interview and rejects plain text", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });
    const handler = ipcMainMock.handlers["coding-agent:check-workflow-command"];

    expect(await handler({}, "$deep-interview build a CLI")).toEqual({
      matched: true,
    });
    expect(await handler({}, "  $ralplan --approve ")).toEqual({
      matched: true,
    });
    expect(await handler({}, "hello world")).toEqual({ matched: false });
    expect(await handler({}, "")).toEqual({ matched: false });
  });

  it("run-workflow-command validates text payload", async () => {
    registerCodingAgentIPCV3({ service, ipcMain: ipcMainMock });
    const handler = ipcMainMock.handlers["coding-agent:run-workflow-command"];

    expect(await handler({}, {})).toEqual({
      success: false,
      matched: false,
      error: "text is required",
    });
    expect(await handler({}, { text: 123 })).toEqual({
      success: false,
      matched: false,
      error: "text is required",
    });
  });
});
