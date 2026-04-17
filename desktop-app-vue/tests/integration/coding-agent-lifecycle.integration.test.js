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
    this.interruptedSessions = [];
    this.resumed = [];
    this.backgroundTasks = [
      { id: "task-1", status: "running", title: "Analyze project" },
      { id: "task-2", status: "completed", title: "Summarize diff" },
    ];
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
    this.subAgentRecords = {
      "session-x": {
        active: [
          {
            id: "sub-1",
            parentId: "session-x",
            role: "reviewer",
            status: "active",
            task: "Review diff",
          },
        ],
        history: [
          {
            id: "sub-old",
            parentId: "session-x",
            role: "helper",
            status: "completed",
            task: "Find TODOs",
          },
        ],
        stats: { active: 1, completed: 1 },
      },
    };
  }

  async listSubAgents(sessionId) {
    const record = this.subAgentRecords[sessionId] || {
      active: [],
      history: [],
      stats: null,
    };
    return {
      id: "sub-agent-list-req",
      type: "sub-agent.list",
      ...record,
    };
  }

  async getSubAgent(subAgentId, sessionId) {
    const record = this.subAgentRecords[sessionId];
    if (!record) {
      return {
        id: "sub-agent-get-req",
        type: "sub-agent.list",
        subAgent: null,
      };
    }
    const match =
      record.active.find((a) => a.id === subAgentId) ||
      record.history.find((a) => a.id === subAgentId) ||
      null;
    return {
      id: "sub-agent-get-req",
      type: "sub-agent.list",
      subAgent: match,
    };
  }

  _reviewStateFor(sessionId) {
    this.reviewStates = this.reviewStates || {};
    return this.reviewStates[sessionId] || null;
  }

  async enterReview(sessionId, options = {}) {
    this.reviewStates = this.reviewStates || {};
    const state = {
      reviewId: "review-x",
      status: "pending",
      reason: options.reason || null,
      requestedBy: options.requestedBy || "user",
      requestedAt: "t0",
      resolvedAt: null,
      resolvedBy: null,
      decision: null,
      blocking: options.blocking !== false,
      comments: [],
      checklist: options.checklist || [],
    };
    this.reviewStates[sessionId] = state;
    return {
      id: "review-enter-req",
      type: "review.requested",
      sessionId,
      reviewState: state,
    };
  }

  async submitReviewComment(sessionId, update = {}) {
    const state = this._reviewStateFor(sessionId);
    if (!state) {
      return {
        id: "review-submit-req",
        type: "review.updated",
        sessionId,
        reviewState: null,
      };
    }
    if (update.comment) {
      state.comments.push({
        id: `c-${state.comments.length + 1}`,
        author: update.comment.author || "user",
        content: update.comment.content || "",
        timestamp: "t1",
      });
    }
    return {
      id: "review-submit-req",
      type: "review.updated",
      sessionId,
      reviewState: state,
    };
  }

  async resolveReview(sessionId, payload = {}) {
    const state = this._reviewStateFor(sessionId);
    if (!state) {
      return {
        id: "review-resolve-req",
        type: "review.resolved",
        sessionId,
        reviewState: null,
      };
    }
    state.status = payload.decision || "approved";
    state.decision = payload.decision || "approved";
    state.resolvedBy = payload.resolvedBy || "user";
    state.resolvedAt = "t2";
    state.blocking = false;
    if (payload.summary) {
      state.summary = payload.summary;
    }
    return {
      id: "review-resolve-req",
      type: "review.resolved",
      sessionId,
      reviewState: state,
    };
  }

  async getReviewState(sessionId) {
    return {
      id: "review-status-req",
      type: "review.state",
      sessionId,
      reviewState: this._reviewStateFor(sessionId),
    };
  }

  _patchStateFor(sessionId) {
    this.patchStates = this.patchStates || {};
    if (!this.patchStates[sessionId]) {
      this.patchStates[sessionId] = {
        pending: new Map(),
        history: [],
        nextId: 1,
      };
    }
    return this.patchStates[sessionId];
  }

  async proposePatch(sessionId, payload = {}) {
    const store = this._patchStateFor(sessionId);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) {
      return {
        id: "patch-propose-req",
        type: "patch.proposed",
        sessionId,
        patch: null,
      };
    }
    const patchId = `patch-${store.nextId++}`;
    const patch = {
      patchId,
      status: "pending",
      origin: payload.origin || "tool",
      reason: payload.reason || null,
      requestId: payload.requestId || null,
      proposedAt: "t0",
      resolvedAt: null,
      resolvedBy: null,
      files: files.map((f, i) => ({
        index: i,
        path: f.path,
        op: f.op || "modify",
        before: f.before || null,
        after: f.after || null,
        diff: f.diff || null,
        stats: { added: 1, removed: 0 },
      })),
      stats: { fileCount: files.length, added: files.length, removed: 0 },
    };
    store.pending.set(patchId, patch);
    return {
      id: "patch-propose-req",
      type: "patch.proposed",
      sessionId,
      patch,
    };
  }

  async applyPatch(sessionId, patchId, options = {}) {
    const store = this._patchStateFor(sessionId);
    const patch = store.pending.get(patchId);
    if (!patch) {
      return {
        id: "patch-apply-req",
        type: "patch.applied",
        sessionId,
        patch: null,
      };
    }
    patch.status = "applied";
    patch.resolvedBy = options.resolvedBy || "user";
    patch.resolvedAt = "t1";
    if (options.note) {
      patch.note = options.note;
    }
    store.pending.delete(patchId);
    store.history.push(patch);
    return {
      id: "patch-apply-req",
      type: "patch.applied",
      sessionId,
      patch,
    };
  }

  async rejectPatch(sessionId, patchId, options = {}) {
    const store = this._patchStateFor(sessionId);
    const patch = store.pending.get(patchId);
    if (!patch) {
      return {
        id: "patch-reject-req",
        type: "patch.rejected",
        sessionId,
        patch: null,
      };
    }
    patch.status = "rejected";
    patch.resolvedBy = options.resolvedBy || "user";
    patch.resolvedAt = "t2";
    if (options.reason) {
      patch.rejectionReason = options.reason;
    }
    store.pending.delete(patchId);
    store.history.push(patch);
    return {
      id: "patch-reject-req",
      type: "patch.rejected",
      sessionId,
      patch,
    };
  }

  async getPatchSummary(sessionId) {
    const store = this._patchStateFor(sessionId);
    const pending = Array.from(store.pending.values());
    const history = store.history;
    return {
      id: "patch-summary-req",
      type: "patch.summary",
      sessionId,
      summary: {
        pending,
        history,
        totals: {
          fileCount: pending.length + history.length,
          added: pending.length + history.length,
          removed: 0,
        },
      },
    };
  }

  _taskGraphFor(sessionId) {
    this.taskGraphs = this.taskGraphs || {};
    return this.taskGraphs[sessionId] || null;
  }

  _normalizeTaskNode(raw) {
    return {
      id: raw.id,
      title: raw.title || raw.id,
      description: raw.description || null,
      status: raw.status || "pending",
      dependsOn: Array.isArray(raw.dependsOn) ? [...raw.dependsOn] : [],
      metadata: raw.metadata || {},
      createdAt: "t0",
      updatedAt: "t0",
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };
  }

  async createTaskGraph(sessionId, payload = {}) {
    this.taskGraphs = this.taskGraphs || {};
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const order = nodes.map((n) => n.id);
    const nodeMap = {};
    for (const n of nodes) {
      nodeMap[n.id] = this._normalizeTaskNode(n);
    }
    const graph = {
      graphId: payload.graphId || "graph-1",
      title: payload.title || null,
      description: payload.description || null,
      status: "active",
      createdAt: "t0",
      updatedAt: "t0",
      completedAt: null,
      order,
      nodes: nodeMap,
    };
    this.taskGraphs[sessionId] = graph;
    return {
      id: "task-graph-create-req",
      type: "task-graph.created",
      sessionId,
      graph,
    };
  }

  async addTaskNode(sessionId, node) {
    const graph = this._taskGraphFor(sessionId);
    if (!graph) {
      return {
        id: "task-graph-add-req",
        type: "task-graph.node.added",
        sessionId,
        graph: null,
        nodeId: node && node.id,
      };
    }
    graph.nodes[node.id] = this._normalizeTaskNode(node);
    graph.order.push(node.id);
    return {
      id: "task-graph-add-req",
      type: "task-graph.node.added",
      sessionId,
      graph,
      nodeId: node.id,
    };
  }

  async updateTaskNode(sessionId, nodeId, updates = {}) {
    const graph = this._taskGraphFor(sessionId);
    if (!graph || !graph.nodes[nodeId]) {
      return {
        id: "task-graph-update-req",
        type: "task-graph.node.updated",
        sessionId,
        graph,
        nodeId,
      };
    }
    Object.assign(graph.nodes[nodeId], updates);
    graph.nodes[nodeId].updatedAt = "t1";
    return {
      id: "task-graph-update-req",
      type: "task-graph.node.updated",
      sessionId,
      graph,
      nodeId,
    };
  }

  async advanceTaskGraph(sessionId) {
    const graph = this._taskGraphFor(sessionId);
    const becameReady = [];
    if (graph) {
      for (const id of graph.order) {
        const node = graph.nodes[id];
        if (node.status !== "pending") {
          continue;
        }
        const ready = node.dependsOn.every((dep) => {
          const d = graph.nodes[dep];
          return d && (d.status === "completed" || d.status === "skipped");
        });
        if (ready) {
          node.status = "ready";
          becameReady.push(id);
        }
      }
    }
    return {
      id: "task-graph-advance-req",
      type: "task-graph.advanced",
      sessionId,
      graph,
      becameReady,
    };
  }

  async getTaskGraph(sessionId) {
    return {
      id: "task-graph-state-req",
      type: "task-graph.state",
      sessionId,
      graph: this._taskGraphFor(sessionId),
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

  async interruptSession(sessionId) {
    this.interruptedSessions.push(sessionId);
    const message = {
      id: "session-interrupt-req",
      type: "session.interrupted",
      sessionId,
      interrupted: true,
      wasProcessing: true,
      interruptedRequestId: "session-message-req",
    };
    this.emit("message", message);
    return message;
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

  async listBackgroundTasks() {
    return {
      id: "tasks-list-req",
      type: "tasks-list",
      tasks: [...this.backgroundTasks],
    };
  }

  async getBackgroundTask(taskId) {
    return {
      id: "tasks-detail-req",
      type: "tasks-detail",
      task: this.backgroundTasks.find((task) => task.id === taskId) || null,
    };
  }

  async getBackgroundTaskHistory(taskId) {
    return {
      id: "tasks-history-req",
      type: "tasks-history",
      taskId,
      history: {
        items: [
          { id: `${taskId}-1`, event: "created" },
          { id: `${taskId}-2`, event: "started" },
        ],
        total: 2,
      },
    };
  }

  async stopBackgroundTask(taskId) {
    this.backgroundTasks = this.backgroundTasks.map((task) =>
      task.id === taskId ? { ...task, status: "stopped" } : task,
    );
    return {
      id: "tasks-stop-req",
      type: "tasks-stopped",
      taskId,
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
        "coding-agent:add-task-node",
        "coding-agent:advance-task-graph",
        "coding-agent:apply-patch",
        "coding-agent:apply-worktree-automation",
        "coding-agent:approve-plan",
        "coding-agent:cancel-session",
        "coding-agent:check-workflow-command",
        "coding-agent:close-session",
        "coding-agent:confirm-high-risk-execution",
        "coding-agent:create-session",
        "coding-agent:create-task-graph",
        "coding-agent:enter-plan-mode",
        "coding-agent:enter-review",
        "coding-agent:get-background-task",
        "coding-agent:get-background-task-history",
        "coding-agent:get-harness-status",
        "coding-agent:get-patch-summary",
        "coding-agent:get-review-state",
        "coding-agent:get-session-events",
        "coding-agent:get-session-state",
        "coding-agent:get-status",
        "coding-agent:get-sub-agent",
        "coding-agent:get-task-graph",
        "coding-agent:get-worktree-diff",
        "coding-agent:interrupt",
        "coding-agent:list-background-tasks",
        "coding-agent:list-sessions",
        "coding-agent:list-sub-agents",
        "coding-agent:list-worktrees",
        "coding-agent:merge-worktree",
        "coding-agent:preview-worktree-merge",
        "coding-agent:propose-patch",
        "coding-agent:reject-patch",
        "coding-agent:reject-plan",
        "coding-agent:resolve-review",
        "coding-agent:respond-approval",
        "coding-agent:resume-session",
        "coding-agent:run-workflow-command",
        "coding-agent:send-message",
        "coding-agent:show-plan",
        "coding-agent:start-session",
        "coding-agent:stop-background-task",
        "coding-agent:submit-review-comment",
        "coding-agent:update-task-node",
      ].sort(),
    );
  });

  it("supports start-session alias and interrupt alias through the IPC layer", async () => {
    const startResult = await ipcMainMock.handlers[
      "coding-agent:start-session"
    ]({}, {});
    expect(startResult).toMatchObject({
      success: true,
      sessionId: "session-x",
    });

    const interruptResult = await ipcMainMock.handlers[
      "coding-agent:interrupt"
    ]({}, "session-x");
    expect(interruptResult).toMatchObject({
      success: true,
      sessionId: "session-x",
      interrupted: true,
    });
    expect(bridge.interruptedSessions).toContain("session-x");
    expect(bridge.closedSessions).not.toContain("session-x");
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

  it("routes generic high-risk approval through respond-approval", async () => {
    await ipcMainMock.handlers["coding-agent:start-session"]({}, {});

    bridge.emit("message", {
      type: "plan-ready",
      sessionId: "session-x",
      summary: "Run dangerous shell",
      items: [{ toolName: "run_shell", riskLevel: "high", title: "rm -rf" }],
    });
    await flushMicrotasks();

    const approvalResult = await ipcMainMock.handlers[
      "coding-agent:respond-approval"
    ](
      {},
      {
        sessionId: "session-x",
        approvalType: "high-risk",
        decision: "granted",
      },
    );
    expect(approvalResult).toMatchObject({
      success: true,
      sessionId: "session-x",
      approvalType: "high-risk",
      decision: "granted",
    });

    const sendResult = await ipcMainMock.handlers["coding-agent:send-message"](
      {},
      { sessionId: "session-x", content: "continue" },
    );
    expect(sendResult.success).toBe(true);

    const eventsResult = await ipcMainMock.handlers[
      "coding-agent:get-session-events"
    ]({}, "session-x");
    expect(
      eventsResult.events.some((event) => event.type === "approval.granted"),
    ).toBe(true);
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

  it("exposes harness background task APIs through IPC", async () => {
    const harness = await ipcMainMock.handlers[
      "coding-agent:get-harness-status"
    ]({});
    const tasks = await ipcMainMock.handlers[
      "coding-agent:list-background-tasks"
    ]({}, {});
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

    expect(harness).toMatchObject({
      success: true,
      harness: {
        backgroundTasks: {
          total: 2,
          running: 1,
          completed: 1,
        },
      },
    });
    expect(tasks).toEqual({
      success: true,
      tasks: expect.arrayContaining([
        expect.objectContaining({ id: "task-1" }),
      ]),
    });
    expect(task).toMatchObject({
      success: true,
      task: expect.objectContaining({ id: "task-1", status: "running" }),
    });
    expect(history).toMatchObject({
      success: true,
      taskId: "task-1",
      history: expect.objectContaining({ total: 2 }),
    });
    expect(stop).toEqual({
      success: true,
      taskId: "task-1",
    });
  });

  it("lists sub-agents scoped to a parent session through IPC", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const list = await ipcMainMock.handlers["coding-agent:list-sub-agents"](
      {},
      { sessionId: "session-x" },
    );

    expect(list).toMatchObject({
      success: true,
      sessionId: "session-x",
    });
    expect(list.active).toHaveLength(1);
    expect(list.active[0]).toMatchObject({
      id: "sub-1",
      parentId: "session-x",
      role: "reviewer",
    });
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({
      id: "sub-old",
      status: "completed",
    });
  });

  it("fetches a single sub-agent snapshot through IPC", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const result = await ipcMainMock.handlers["coding-agent:get-sub-agent"](
      {},
      { subAgentId: "sub-1", sessionId: "session-x" },
    );

    expect(result).toMatchObject({
      success: true,
      subAgent: expect.objectContaining({
        id: "sub-1",
        parentId: "session-x",
      }),
    });
  });

  it("rejects get-sub-agent without subAgentId", async () => {
    const result = await ipcMainMock.handlers["coding-agent:get-sub-agent"](
      {},
      {},
    );
    expect(result).toEqual({
      success: false,
      error: "subAgentId is required",
    });
  });

  it("runs the review lifecycle through IPC: enter → submit → resolve → status", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const entered = await ipcMainMock.handlers["coding-agent:enter-review"](
      {},
      {
        sessionId: "session-x",
        reason: "gate",
        checklist: [{ id: "a", title: "Item A" }],
      },
    );
    expect(entered).toMatchObject({
      success: true,
      reviewState: expect.objectContaining({
        status: "pending",
        blocking: true,
      }),
    });

    const submitted = await ipcMainMock.handlers[
      "coding-agent:submit-review-comment"
    ](
      {},
      {
        sessionId: "session-x",
        comment: { author: "alice", content: "LGTM" },
      },
    );
    expect(submitted.reviewState.comments).toHaveLength(1);
    expect(submitted.reviewState.comments[0].author).toBe("alice");

    const resolved = await ipcMainMock.handlers["coding-agent:resolve-review"](
      {},
      { sessionId: "session-x", decision: "approved", summary: "Ship it" },
    );
    expect(resolved).toMatchObject({
      success: true,
      reviewState: expect.objectContaining({
        status: "approved",
        decision: "approved",
        blocking: false,
        summary: "Ship it",
      }),
    });

    const status = await ipcMainMock.handlers["coding-agent:get-review-state"](
      {},
      { sessionId: "session-x" },
    );
    expect(status.reviewState.status).toBe("approved");
  });

  it("rejects review handlers without a sessionId", async () => {
    const enter = await ipcMainMock.handlers["coding-agent:enter-review"](
      {},
      {},
    );
    expect(enter).toEqual({ success: false, error: "sessionId is required" });

    const resolve = await ipcMainMock.handlers["coding-agent:resolve-review"](
      {},
      { decision: "approved" },
    );
    expect(resolve).toEqual({
      success: false,
      error: "sessionId is required",
    });
  });

  it("runs the patch lifecycle through IPC: propose → apply → summary", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const proposed = await ipcMainMock.handlers["coding-agent:propose-patch"](
      {},
      {
        sessionId: "session-x",
        origin: "tool",
        reason: "add helper",
        files: [{ path: "src/a.js", op: "create", after: "console.log(1)" }],
      },
    );
    expect(proposed).toMatchObject({
      success: true,
      patch: expect.objectContaining({
        patchId: expect.any(String),
        status: "pending",
      }),
    });
    const patchId = proposed.patch.patchId;

    const applied = await ipcMainMock.handlers["coding-agent:apply-patch"](
      {},
      { sessionId: "session-x", patchId, note: "looks good" },
    );
    expect(applied.patch.status).toBe("applied");
    expect(applied.patch.note).toBe("looks good");

    const summary = await ipcMainMock.handlers[
      "coding-agent:get-patch-summary"
    ]({}, { sessionId: "session-x" });
    expect(summary).toMatchObject({
      success: true,
      summary: expect.objectContaining({
        pending: [],
        history: expect.arrayContaining([
          expect.objectContaining({ patchId, status: "applied" }),
        ]),
      }),
    });
  });

  it("runs patch rejection through IPC", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const proposed = await ipcMainMock.handlers["coding-agent:propose-patch"](
      {},
      {
        sessionId: "session-x",
        files: [{ path: "src/b.js", after: "risky" }],
      },
    );
    const patchId = proposed.patch.patchId;

    const rejected = await ipcMainMock.handlers["coding-agent:reject-patch"](
      {},
      { sessionId: "session-x", patchId, reason: "too risky" },
    );
    expect(rejected.patch.status).toBe("rejected");
    expect(rejected.patch.rejectionReason).toBe("too risky");
  });

  it("rejects patch handlers without a sessionId", async () => {
    const propose = await ipcMainMock.handlers["coding-agent:propose-patch"](
      {},
      { files: [{ path: "a.js" }] },
    );
    expect(propose).toEqual({
      success: false,
      error: "sessionId is required",
    });

    const apply = await ipcMainMock.handlers["coding-agent:apply-patch"](
      {},
      { patchId: "p" },
    );
    expect(apply).toEqual({ success: false, error: "sessionId is required" });

    const summary = await ipcMainMock.handlers[
      "coding-agent:get-patch-summary"
    ]({}, {});
    expect(summary).toEqual({
      success: false,
      error: "sessionId is required",
    });
  });

  it("runs the task graph lifecycle through IPC: create → add → update → advance → state", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const created = await ipcMainMock.handlers[
      "coding-agent:create-task-graph"
    ](
      {},
      {
        sessionId: "session-x",
        title: "Plan",
        nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }],
      },
    );
    expect(created).toMatchObject({
      success: true,
      sessionId: "session-x",
      graph: expect.objectContaining({
        graphId: "graph-1",
        title: "Plan",
        order: ["a", "b"],
      }),
    });

    const added = await ipcMainMock.handlers["coding-agent:add-task-node"](
      {},
      { sessionId: "session-x", node: { id: "c", dependsOn: ["b"] } },
    );
    expect(added).toMatchObject({
      success: true,
      nodeId: "c",
      graph: expect.objectContaining({ order: ["a", "b", "c"] }),
    });

    const updated = await ipcMainMock.handlers["coding-agent:update-task-node"](
      {},
      {
        sessionId: "session-x",
        nodeId: "a",
        updates: { status: "completed" },
      },
    );
    expect(updated.graph.nodes.a.status).toBe("completed");

    const advanced = await ipcMainMock.handlers[
      "coding-agent:advance-task-graph"
    ]({}, "session-x");
    expect(advanced.becameReady).toEqual(["b"]);
    expect(advanced.graph.nodes.b.status).toBe("ready");

    const state = await ipcMainMock.handlers["coding-agent:get-task-graph"](
      {},
      "session-x",
    );
    expect(state.graph.nodes.a.status).toBe("completed");
    expect(state.graph.nodes.b.status).toBe("ready");
    expect(state.graph.nodes.c.status).toBe("pending");
  });

  it("rejects task graph handlers without a sessionId", async () => {
    const create = await ipcMainMock.handlers["coding-agent:create-task-graph"](
      {},
      { nodes: [] },
    );
    expect(create).toEqual({
      success: false,
      error: "sessionId is required",
    });

    const advance = await ipcMainMock.handlers[
      "coding-agent:advance-task-graph"
    ]({}, {});
    expect(advance).toEqual({
      success: false,
      error: "sessionId is required",
    });
  });

  it("rejects add-task-node when node.id is missing", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});

    const result = await ipcMainMock.handlers["coding-agent:add-task-node"](
      {},
      { sessionId: "session-x", node: {} },
    );
    expect(result).toEqual({ success: false, error: "node.id is required" });
  });

  it("emits session events to the renderer via webContents.send", async () => {
    await ipcMainMock.handlers["coding-agent:create-session"]({}, {});
    const renderedTypes = mainWindow.webContents.send.mock.calls
      .filter(([channel]) => channel === CODING_AGENT_EVENT_CHANNEL)
      .map(([, event]) => event.type);
    expect(renderedTypes).toContain("session.started");
  });
});
