import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("useCodingAgentStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  let codingAgentApi: Record<string, any>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    codingAgentApi = {
      respondApproval: vi.fn().mockResolvedValue({ success: true }),
      interrupt: vi.fn().mockResolvedValue({ success: true }),
      getSessionState: vi.fn().mockResolvedValue({
        success: true,
        session: {
          sessionId: "session-1",
          lastPlanSummary: "Review diff",
          planModeState: "plan_ready",
          requiresHighRiskConfirmation: false,
          highRiskToolNames: [],
        },
      }),
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
      listBackgroundTasks: vi.fn().mockResolvedValue({
        success: true,
        tasks: [{ id: "task-1", status: "running" }],
      }),
      getBackgroundTask: vi.fn().mockResolvedValue({
        success: true,
        task: { id: "task-1", status: "running" },
      }),
      getBackgroundTaskHistory: vi.fn().mockResolvedValue({
        success: true,
        taskId: "task-1",
        history: { items: [{ event: "created" }], total: 1 },
      }),
      stopBackgroundTask: vi.fn().mockResolvedValue({
        success: true,
        taskId: "task-1",
      }),
      getStatus: vi.fn().mockResolvedValue({
        success: true,
        server: {
          connected: true,
          host: "127.0.0.1",
          port: 4317,
        },
        tools: [],
        toolSummary: null,
        permissionPolicy: null,
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
      listSessions: vi.fn().mockResolvedValue({
        success: true,
        sessions: [{ id: "session-1", status: "ready" }],
      }),
      listSubAgents: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        active: [
          {
            id: "sub-1",
            parentId: "session-1",
            role: "reviewer",
            status: "active",
          },
        ],
        history: [],
        stats: { active: 1, completed: 0 },
      }),
      getSubAgent: vi.fn().mockResolvedValue({
        success: true,
        subAgent: {
          id: "sub-1",
          parentId: "session-1",
          role: "reviewer",
          status: "active",
        },
      }),
      enterReview: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        reviewState: {
          reviewId: "review-1",
          status: "pending",
          reason: "gate",
          requestedBy: "user",
          blocking: true,
          comments: [],
          checklist: [{ id: "a", title: "Item A", done: false }],
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
            {
              id: "c-1",
              author: "alice",
              content: "ok",
              timestamp: "t",
            },
          ],
          checklist: [{ id: "a", title: "Item A", done: true }],
        },
      }),
      resolveReview: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        reviewState: {
          reviewId: "review-1",
          status: "approved",
          decision: "approved",
          blocking: false,
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
          origin: "tool",
          reason: null,
          requestId: null,
          proposedAt: "t0",
          resolvedAt: null,
          resolvedBy: null,
          files: [
            {
              index: 0,
              path: "src/a.js",
              op: "modify",
              before: "old",
              after: "new",
              diff: null,
              stats: { added: 1, removed: 1 },
            },
          ],
          stats: { fileCount: 1, added: 1, removed: 1 },
        },
      }),
      applyPatch: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        patch: {
          patchId: "patch-1",
          status: "applied",
          origin: "tool",
          reason: null,
          requestId: null,
          proposedAt: "t0",
          resolvedAt: "t1",
          resolvedBy: "user",
          files: [],
          stats: { fileCount: 1, added: 1, removed: 1 },
        },
      }),
      rejectPatch: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        patch: {
          patchId: "patch-1",
          status: "rejected",
          origin: "tool",
          reason: null,
          requestId: null,
          proposedAt: "t0",
          resolvedAt: "t1",
          resolvedBy: "user",
          rejectionReason: "no",
          files: [],
          stats: { fileCount: 1, added: 1, removed: 1 },
        },
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
          title: "Plan",
          description: null,
          status: "active",
          createdAt: "t0",
          updatedAt: "t0",
          completedAt: null,
          order: ["a", "b"],
          nodes: {
            a: {
              id: "a",
              title: "a",
              description: null,
              status: "pending",
              dependsOn: [],
              metadata: {},
              createdAt: "t0",
              updatedAt: "t0",
              startedAt: null,
              completedAt: null,
              result: null,
              error: null,
            },
            b: {
              id: "b",
              title: "b",
              description: null,
              status: "pending",
              dependsOn: ["a"],
              metadata: {},
              createdAt: "t0",
              updatedAt: "t0",
              startedAt: null,
              completedAt: null,
              result: null,
              error: null,
            },
          },
        },
      }),
      addTaskNode: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session-1",
        nodeId: "c",
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a", "b", "c"],
          nodes: {
            a: { id: "a", status: "pending", dependsOn: [] },
            b: { id: "b", status: "pending", dependsOn: ["a"] },
            c: { id: "c", status: "pending", dependsOn: ["b"] },
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
      subscribeEvents: vi.fn(),
      onEvent: vi.fn(),
    };

    (globalThis as any).window = {
      electronAPI: {
        codingAgent: codingAgentApi,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).window;
  });

  it("approvePlan routes through respondApproval with plan granted", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    await store.approvePlan();

    expect(codingAgentApi.respondApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalType: "plan",
      decision: "granted",
    });
    expect(codingAgentApi.getSessionState).toHaveBeenCalledWith("session-1");
  });

  it("rejectPlan routes through respondApproval with plan denied", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    await store.rejectPlan();

    expect(codingAgentApi.respondApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalType: "plan",
      decision: "denied",
    });
    expect(codingAgentApi.getSessionState).toHaveBeenCalledWith("session-1");
  });

  it("confirmHighRiskExecution routes through respondApproval with high-risk granted", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    await store.confirmHighRiskExecution();

    expect(codingAgentApi.respondApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalType: "high-risk",
      decision: "granted",
    });
    expect(codingAgentApi.getSessionState).toHaveBeenCalledWith("session-1");
  });

  it("interrupt routes through the interrupt IPC handler", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    await store.interrupt();

    expect(codingAgentApi.interrupt).toHaveBeenCalledWith("session-1");
  });

  it("initEventListeners prefers subscribeEvents when available", async () => {
    const unsubscribe = vi.fn();
    codingAgentApi.subscribeEvents.mockImplementation((handler: any) => {
      handler({
        id: "evt-1",
        type: "server-ready",
        payload: {
          host: "127.0.0.1",
          port: 4317,
        },
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();

    store.initEventListeners();

    expect(codingAgentApi.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(codingAgentApi.onEvent).not.toHaveBeenCalled();
    expect(store.status.connected).toBe(true);
    expect(store.status.host).toBe("127.0.0.1");
    expect(store.status.port).toBe(4317);
    expect(store.unsubscribe).toBe(unsubscribe);
  });

  it("initEventListeners falls back to onEvent when subscribeEvents is unavailable", async () => {
    const unsubscribe = vi.fn();
    delete codingAgentApi.subscribeEvents;
    codingAgentApi.onEvent.mockImplementation((handler: any) => {
      handler({
        id: "evt-2",
        type: "server-stopped",
        payload: {},
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.status.connected = true;

    store.initEventListeners();

    expect(codingAgentApi.onEvent).toHaveBeenCalledTimes(1);
    expect(store.status.connected).toBe(false);
    expect(store.unsubscribe).toBe(unsubscribe);
  });

  it("understands unified dot-case event types in derived getters", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";
    store.currentSession = {
      sessionId: "session-1",
      status: "ready",
      history: [],
    } as any;
    store.events = [
      {
        id: "evt-1",
        type: "assistant.final",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        payload: { content: "Done." },
      },
      {
        id: "evt-2",
        type: "approval.requested",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        payload: { summary: "Approve plan" },
      },
      {
        id: "evt-3",
        type: "tool.call.failed",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        payload: { toolName: "run_shell" },
      },
      {
        id: "evt-4",
        type: "approval.denied",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        payload: {
          toolName: "run_shell",
          source: "approval-gate",
          policy: "strict",
          via: "strict",
          riskLevel: "HIGH",
          reason: "ApprovalGate denied (strict)",
        },
      },
    ] as any;

    expect(store.latestAssistantMessage).toBe("Done.");
    expect(store.latestApprovalRequest?.type).toBe("approval.requested");
    expect(store.latestBlockedToolEvent?.type).toBe("tool.call.failed");
    expect(store.latestApprovalDeniedEvent?.type).toBe("approval.denied");
    expect(store.latestApprovalDeniedEvent?.payload?.policy).toBe("strict");
    expect(store.latestApprovalDeniedEvent?.payload?.source).toBe(
      "approval-gate",
    );
  });

  it("latestApprovalDeniedEvent returns null when no deny event in session", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";
    store.currentSession = {
      sessionId: "session-1",
      status: "ready",
      history: [],
    } as any;
    store.events = [
      {
        id: "evt-1",
        type: "assistant.final",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        payload: { content: "Done." },
      },
      // A blocked-tool event without an approval.denied event MUST NOT bleed
      // into latestApprovalDeniedEvent — they have different recovery flows.
      {
        id: "evt-2",
        type: "tool.call.failed",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        payload: { toolName: "run_shell" },
      },
    ] as any;

    expect(store.latestApprovalDeniedEvent).toBeNull();
    expect(store.latestBlockedToolEvent?.type).toBe("tool.call.failed");
  });

  it("latestApprovalDeniedEvent ignores legacy plan/high-risk approval rejections", async () => {
    // Phase J+ regression guard: coding-agent-session-service.js has TWO
    // emitters that share `CODING_AGENT_EVENT_TYPES.APPROVAL_DENIED`:
    //   1. Legacy: plan/high-risk rejection — payload `{ approvalType, tools }`
    //   2. Phase J+: ApprovalGate auto-deny — payload includes
    //      `source: "approval-gate"` plus `policy/via/riskLevel/reason`
    // The new getter must ONLY surface (2), since the recovery flow for (1)
    // is "approve the plan" (handled by latestApprovalRequest) while (2) is
    // "relax session policy" (handled by the new alert + button).
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";
    store.currentSession = {
      sessionId: "session-1",
      status: "ready",
      history: [],
    } as any;
    store.events = [
      {
        id: "evt-1",
        type: "approval.denied",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        // Legacy shape — NO `source` field
        payload: {
          approvalType: "high-risk",
          tools: ["run_shell"],
        },
      },
      {
        id: "evt-2",
        type: "approval.denied",
        timestamp: new Date().toISOString(),
        sessionId: "session-1",
        // Another legacy variant — `source` is something else
        payload: {
          approvalType: "plan",
          source: "plan-mode",
        },
      },
    ] as any;

    // Both legacy events present, but neither carries `source: "approval-gate"`
    expect(store.latestApprovalDeniedEvent).toBeNull();
  });

  it("reacts to unified dot-case runtime and session events", async () => {
    const unsubscribe = vi.fn();
    codingAgentApi.subscribeEvents.mockImplementation((handler: any) => {
      handler({
        id: "evt-1",
        type: "runtime.server.ready",
        payload: {
          host: "127.0.0.1",
          port: 4317,
        },
      });
      handler({
        id: "evt-2",
        type: "session.started",
        sessionId: "session-1",
        payload: { sessionId: "session-1" },
      });
      handler({
        id: "evt-3",
        type: "approval.requested",
        sessionId: "session-1",
        payload: { summary: "Approve plan" },
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    store.initEventListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.status.connected).toBe(true);
    expect(store.status.host).toBe("127.0.0.1");
    expect(store.status.port).toBe(4317);
    expect(codingAgentApi.listSessions).toHaveBeenCalledTimes(1);
    expect(codingAgentApi.getStatus).toHaveBeenCalledTimes(1);
    expect(codingAgentApi.getSessionState).toHaveBeenCalledWith("session-1");
    expect(store.unsubscribe).toBe(unsubscribe);
  });

  it("loads harness status and background tasks through the store", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();

    await store.refreshHarnessStatus();
    await store.loadBackgroundTasks();
    await store.fetchBackgroundTask("task-1");
    await store.fetchBackgroundTaskHistory("task-1");

    expect(codingAgentApi.getHarnessStatus).toHaveBeenCalledTimes(1);
    expect(codingAgentApi.listBackgroundTasks).toHaveBeenCalledWith({});
    expect(codingAgentApi.getBackgroundTask).toHaveBeenCalledWith("task-1");
    expect(codingAgentApi.getBackgroundTaskHistory).toHaveBeenCalledWith({
      taskId: "task-1",
    });
    expect(store.harnessStatus?.backgroundTasks.running).toBe(1);
    expect(store.backgroundTasks[0]?.id).toBe("task-1");
    expect(store.selectedBackgroundTask?.id).toBe("task-1");
    expect(store.selectedBackgroundTaskHistory).toMatchObject({
      items: [{ event: "created" }],
      total: 1,
    });
  });

  it("loadSubAgents populates the per-session bucket", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const bucket = await store.loadSubAgents("session-1");

    expect(codingAgentApi.listSubAgents).toHaveBeenCalledWith("session-1");
    expect(bucket?.active[0]?.id).toBe("sub-1");
    expect(store.subAgents["session-1"]?.active).toHaveLength(1);
    expect(store.currentSessionSubAgents.active).toHaveLength(1);
  });

  it("fetchSubAgent delegates to getSubAgent with scoped session id", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const sub = await store.fetchSubAgent("sub-1");

    expect(codingAgentApi.getSubAgent).toHaveBeenCalledWith({
      subAgentId: "sub-1",
      sessionId: "session-1",
    });
    expect(sub?.id).toBe("sub-1");
  });

  it("reacts to sub-agent lifecycle events and moves them to history", async () => {
    const unsubscribe = vi.fn();
    codingAgentApi.subscribeEvents.mockImplementation((handler: any) => {
      handler({
        id: "evt-started",
        type: "sub-agent.started",
        sessionId: "session-1",
        payload: {
          subAgentId: "sub-1",
          parentSessionId: "session-1",
          role: "reviewer",
          task: "Review diff",
        },
      });
      handler({
        id: "evt-completed",
        type: "sub-agent.completed",
        sessionId: "session-1",
        payload: {
          subAgentId: "sub-1",
          parentSessionId: "session-1",
          role: "reviewer",
          summary: "All good",
          durationMs: 123,
        },
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    store.initEventListeners();
    await Promise.resolve();

    const bucket = store.subAgents["session-1"];
    expect(bucket?.active).toHaveLength(0);
    expect(bucket?.history).toHaveLength(1);
    expect(bucket?.history[0]?.id).toBe("sub-1");
    expect(bucket?.history[0]?.status).toBe("completed");
    expect(bucket?.history[0]?.summary).toBe("All good");
  });

  it("enterReview stores the pending state and marks the session blocked", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const state = await store.enterReview({
      reason: "gate",
      checklist: [{ id: "a", title: "Item A" }],
    });

    expect(codingAgentApi.enterReview).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: "gate",
      requestedBy: "user",
      checklist: [{ id: "a", title: "Item A" }],
      blocking: true,
    });
    expect(state?.status).toBe("pending");
    expect(store.reviewStates["session-1"]?.status).toBe("pending");
    expect(store.currentSessionReviewState?.reviewId).toBe("review-1");
    expect(store.isCurrentSessionBlockedByReview).toBe(true);
  });

  it("submitReviewComment appends the returned comment", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const state = await store.submitReviewComment({
      comment: { author: "alice", content: "ok" },
      checklistItemId: "a",
      checklistItemDone: true,
    });

    expect(codingAgentApi.submitReviewComment).toHaveBeenCalledWith({
      sessionId: "session-1",
      comment: { author: "alice", content: "ok" },
      checklistItemId: "a",
      checklistItemDone: true,
      checklistItemNote: undefined,
    });
    expect(state?.comments).toHaveLength(1);
    expect(store.reviewStates["session-1"]?.checklist[0]?.done).toBe(true);
  });

  it("resolveReview unblocks the session", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";
    // Seed a pending state first
    await store.enterReview({ reason: "check" });
    expect(store.isCurrentSessionBlockedByReview).toBe(true);

    const state = await store.resolveReview({ decision: "approved" });

    expect(codingAgentApi.resolveReview).toHaveBeenCalledWith({
      sessionId: "session-1",
      decision: "approved",
      resolvedBy: "user",
      summary: null,
    });
    expect(state?.status).toBe("approved");
    expect(store.isCurrentSessionBlockedByReview).toBe(false);
  });

  it("fetchReviewStatus normalizes null results", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const state = await store.fetchReviewStatus();

    expect(codingAgentApi.getReviewState).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(state).toBeNull();
    expect(store.currentSessionReviewState).toBeNull();
  });

  it("applies review lifecycle events to per-session state", async () => {
    const unsubscribe = vi.fn();
    codingAgentApi.subscribeEvents.mockImplementation((handler: any) => {
      handler({
        id: "evt-review-1",
        type: "review.requested",
        sessionId: "session-1",
        payload: {
          sessionId: "session-1",
          reviewState: {
            reviewId: "review-2",
            status: "pending",
            blocking: true,
            comments: [],
            checklist: [],
          },
        },
      });
      handler({
        id: "evt-review-2",
        type: "review.resolved",
        sessionId: "session-1",
        payload: {
          sessionId: "session-1",
          reviewState: {
            reviewId: "review-2",
            status: "approved",
            decision: "approved",
            blocking: false,
            comments: [],
            checklist: [],
          },
        },
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    store.initEventListeners();
    await Promise.resolve();

    expect(store.reviewStates["session-1"]?.status).toBe("approved");
    expect(store.isCurrentSessionBlockedByReview).toBe(false);
  });

  it("proposePatch stores the returned patch as pending", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const patch = await store.proposePatch({
      files: [{ path: "src/a.js", op: "modify", before: "old", after: "new" }],
    });

    expect(codingAgentApi.proposePatch).toHaveBeenCalledWith({
      sessionId: "session-1",
      files: [{ path: "src/a.js", op: "modify", before: "old", after: "new" }],
      origin: "tool",
      reason: null,
      requestId: null,
    });
    expect(patch?.patchId).toBe("patch-1");
    expect(store.currentSessionPendingPatches).toHaveLength(1);
    expect(store.currentSessionHasPendingPatches).toBe(true);
    expect(store.currentSessionPatchSummary?.totals.fileCount).toBe(1);
  });

  it("applyPatch moves the patch from pending to history", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";
    await store.proposePatch({
      files: [{ path: "src/a.js", op: "modify", before: "old", after: "new" }],
    });
    expect(store.currentSessionHasPendingPatches).toBe(true);

    const patch = await store.applyPatch({ patchId: "patch-1" });

    expect(codingAgentApi.applyPatch).toHaveBeenCalledWith({
      sessionId: "session-1",
      patchId: "patch-1",
      resolvedBy: "user",
      note: null,
    });
    expect(patch?.status).toBe("applied");
    expect(store.currentSessionHasPendingPatches).toBe(false);
    expect(store.currentSessionPatchSummary?.history[0]?.patchId).toBe(
      "patch-1",
    );
  });

  it("rejectPatch marks the patch as rejected", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";
    await store.proposePatch({
      files: [{ path: "src/a.js", op: "modify" }],
    });

    const patch = await store.rejectPatch({
      patchId: "patch-1",
      reason: "no",
    });

    expect(codingAgentApi.rejectPatch).toHaveBeenCalledWith({
      sessionId: "session-1",
      patchId: "patch-1",
      resolvedBy: "user",
      reason: "no",
    });
    expect(patch?.status).toBe("rejected");
    expect(store.currentSessionHasPendingPatches).toBe(false);
  });

  it("fetchPatchSummary replaces the local summary", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const summary = await store.fetchPatchSummary();

    expect(codingAgentApi.getPatchSummary).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(summary?.pending).toEqual([]);
    expect(store.currentSessionPatchSummary?.totals.fileCount).toBe(0);
  });

  it("applies patch lifecycle events to per-session summaries", async () => {
    const unsubscribe = vi.fn();
    codingAgentApi.subscribeEvents.mockImplementation((handler: any) => {
      handler({
        id: "evt-patch-1",
        type: "patch.proposed",
        sessionId: "session-1",
        payload: {
          patch: {
            patchId: "patch-9",
            status: "pending",
            origin: "tool",
            reason: null,
            requestId: null,
            proposedAt: "t0",
            resolvedAt: null,
            resolvedBy: null,
            files: [],
            stats: { fileCount: 2, added: 5, removed: 3 },
          },
        },
      });
      handler({
        id: "evt-patch-2",
        type: "patch.applied",
        sessionId: "session-1",
        payload: {
          patch: {
            patchId: "patch-9",
            status: "applied",
            origin: "tool",
            reason: null,
            requestId: null,
            proposedAt: "t0",
            resolvedAt: "t1",
            resolvedBy: "user",
            files: [],
            stats: { fileCount: 2, added: 5, removed: 3 },
          },
        },
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    store.initEventListeners();
    await Promise.resolve();

    expect(store.currentSessionHasPendingPatches).toBe(false);
    expect(store.currentSessionPatchSummary?.history[0]?.patchId).toBe(
      "patch-9",
    );
    expect(store.currentSessionPatchSummary?.history[0]?.status).toBe(
      "applied",
    );
  });

  it("createTaskGraph stores the graph for the current session", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const graph = await store.createTaskGraph({
      title: "Plan",
      nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }],
    });

    expect(codingAgentApi.createTaskGraph).toHaveBeenCalledWith({
      sessionId: "session-1",
      graphId: null,
      title: "Plan",
      description: null,
      nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }],
    });
    expect(graph?.graphId).toBe("graph-1");
    expect(store.currentSessionTaskGraph?.order).toEqual(["a", "b"]);
  });

  it("addTaskNode appends a node to the current graph", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    await store.addTaskNode({ node: { id: "c", dependsOn: ["b"] } });

    expect(codingAgentApi.addTaskNode).toHaveBeenCalledWith({
      sessionId: "session-1",
      node: { id: "c", dependsOn: ["b"] },
    });
    expect(store.currentSessionTaskGraph?.order).toEqual(["a", "b", "c"]);
  });

  it("updateTaskNode forwards updates and refreshes the graph", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    await store.updateTaskNode({
      nodeId: "a",
      updates: { status: "completed" },
    });

    expect(codingAgentApi.updateTaskNode).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "a",
      updates: { status: "completed" },
    });
    expect(store.currentSessionTaskGraph?.nodes.a.status).toBe("completed");
  });

  it("advanceTaskGraph promotes ready nodes and exposes them via getter", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    const result = await store.advanceTaskGraph();

    expect(codingAgentApi.advanceTaskGraph).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(result.becameReady).toEqual(["b"]);
    expect(store.currentSessionReadyTaskNodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("applies task graph lifecycle events to the per-session graph", async () => {
    const unsubscribe = vi.fn();
    codingAgentApi.subscribeEvents.mockImplementation((handler: any) => {
      handler({
        id: "evt-tg-1",
        type: "task-graph.created",
        sessionId: "session-1",
        payload: {
          graph: {
            graphId: "graph-evt",
            status: "active",
            order: ["x"],
            nodes: { x: { id: "x", status: "pending", dependsOn: [] } },
          },
        },
      });
      handler({
        id: "evt-tg-2",
        type: "task-graph.node.completed",
        sessionId: "session-1",
        payload: {
          nodeId: "x",
          graph: {
            graphId: "graph-evt",
            status: "active",
            order: ["x"],
            nodes: { x: { id: "x", status: "completed", dependsOn: [] } },
          },
        },
      });
      return unsubscribe;
    });

    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();
    store.currentSessionId = "session-1";

    store.initEventListeners();
    await Promise.resolve();

    expect(store.currentSessionTaskGraph?.graphId).toBe("graph-evt");
    expect(store.currentSessionTaskGraph?.nodes.x.status).toBe("completed");
  });

  it("stopBackgroundTask refreshes tasks and harness state", async () => {
    const { useCodingAgentStore } = await import("../coding-agent");
    const store = useCodingAgentStore();

    await store.stopBackgroundTask("task-1");

    expect(codingAgentApi.stopBackgroundTask).toHaveBeenCalledWith("task-1");
    expect(codingAgentApi.listBackgroundTasks).toHaveBeenCalledWith({});
    expect(codingAgentApi.getHarnessStatus).toHaveBeenCalledTimes(1);
  });
});
