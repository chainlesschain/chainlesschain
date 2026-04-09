import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useWorkflowSessionStore } from "../workflow-session";

function makeBridge(overrides: Record<string, any> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ success: true, sessions: [] as any[] }),
    get: vi.fn().mockResolvedValue({ success: false, error: "not set" }),
    listMembers: vi
      .fn()
      .mockResolvedValue({ success: true, members: [] as any[] }),
    classifyIntake: vi.fn().mockResolvedValue({
      success: true,
      classification: {
        decision: "ralph",
        confidence: "medium",
        complexity: "simple",
        scopeCount: 0,
        boundaries: [],
        testHeavy: false,
        signals: [],
        reason: "default",
        recommendedConcurrency: 1,
        suggestedRoles: ["executor"],
      },
    }),
    ...overrides,
  };
}

function installBridge(bridge: Record<string, any>) {
  (globalThis as any).window = {
    electronAPI: { workflowSession: bridge },
  };
}

describe("useWorkflowSessionStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).window;
  });

  it("starts with empty state", () => {
    installBridge(makeBridge());
    const store = useWorkflowSessionStore();
    expect(store.sessions).toEqual([]);
    expect(store.currentSessionId).toBeNull();
    expect(store.currentState).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("throws friendly error when preload bridge is missing", async () => {
    (globalThis as any).window = { electronAPI: {} };
    const store = useWorkflowSessionStore();
    await store.refreshList();
    expect(store.error).toMatch(/workflowSession IPC bridge not available/);
    expect(store.sessions).toEqual([]);
  });

  it("refreshList populates sessions on success", async () => {
    const bridge = makeBridge({
      list: vi.fn().mockResolvedValue({
        success: true,
        sessions: [
          {
            sessionId: "s1",
            stage: "plan",
            updatedAt: "t1",
            retries: 0,
            maxRetries: 3,
            failureReason: null,
          },
          {
            sessionId: "s2",
            stage: "verify",
            updatedAt: "t2",
            retries: 1,
            maxRetries: 3,
            failureReason: null,
          },
        ],
      }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.refreshList();

    expect(bridge.list).toHaveBeenCalledTimes(1);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0].sessionId).toBe("s1");
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("refreshList captures IPC-level failure", async () => {
    const bridge = makeBridge({
      list: vi.fn().mockResolvedValue({ success: false, error: "boom" }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.refreshList();
    expect(store.error).toBe("boom");
    expect(store.sessions).toEqual([]);
  });

  it("refreshList catches thrown errors", async () => {
    const bridge = makeBridge({
      list: vi.fn().mockRejectedValue(new Error("kaboom")),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.refreshList();
    expect(store.error).toBe("kaboom");
    expect(store.sessions).toEqual([]);
  });

  it("selectSession loads full state on success", async () => {
    const state = {
      sessionId: "s1",
      stage: "verify",
      mode: { stage: "verify", retries: 0 },
      intent: "# Intent\n",
      plan: { approved: true, updated: "t", raw: "# Plan\n" },
      tasks: {
        sessionId: "s1",
        version: 1,
        stage: "execute",
        tasks: [
          { id: "t1", status: "completed" },
          { id: "t2", status: "running" },
          { id: "t3", status: "pending" },
        ],
        updatedAt: "t",
      },
      verify: {
        sessionId: "s1",
        status: "passed" as const,
        checks: [
          { id: "unit", command: "npm test", status: "passed" as const },
        ],
        nextAction: "complete" as const,
        updatedAt: "t",
      },
      progress: "[t] started",
      summary: null,
      artifacts: [],
    };
    const bridge = makeBridge({
      get: vi.fn().mockResolvedValue({ success: true, state }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.selectSession("s1");

    expect(bridge.get).toHaveBeenCalledWith("s1");
    expect(store.currentSessionId).toBe("s1");
    expect(store.currentState).toEqual(state);
    expect(store.loadingDetail).toBe(false);
    expect(store.hasVerifyResult).toBe(true);
    expect(store.verifyPassed).toBe(true);
    expect(store.taskReadiness).toEqual({
      total: 3,
      pending: 1,
      running: 1,
      completed: 1,
      failed: 0,
    });
  });

  it("selectSession records error when session not found", async () => {
    const bridge = makeBridge({
      get: vi.fn().mockResolvedValue({ success: false, error: "not found" }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.selectSession("nope");
    expect(store.error).toBe("not found");
    expect(store.currentState).toBeNull();
    expect(store.currentSessionId).toBe("nope");
  });

  it("loadMembers pulls $team fan-out summaries", async () => {
    const bridge = makeBridge({
      listMembers: vi.fn().mockResolvedValue({
        success: true,
        members: [
          {
            sessionId: "parent.m0-executor",
            stage: "execute",
            updatedAt: "t",
            retries: 0,
            maxRetries: 3,
            failureReason: null,
          },
        ],
      }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.loadMembers("parent");
    expect(bridge.listMembers).toHaveBeenCalledWith("parent");
    expect(store.members).toHaveLength(1);
    expect(store.members[0].sessionId).toBe("parent.m0-executor");
  });

  it("clearSelection resets detail state but keeps the list", async () => {
    const bridge = makeBridge({
      list: vi.fn().mockResolvedValue({
        success: true,
        sessions: [
          {
            sessionId: "s1",
            stage: "plan",
            updatedAt: "t",
            retries: 0,
            maxRetries: 3,
            failureReason: null,
          },
        ],
      }),
      get: vi.fn().mockResolvedValue({
        success: true,
        state: {
          sessionId: "s1",
          stage: "plan",
          mode: null,
          intent: null,
          plan: null,
          tasks: null,
          verify: null,
          progress: null,
          summary: null,
          artifacts: [],
        },
      }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    await store.refreshList();
    await store.selectSession("s1");
    expect(store.currentSessionId).toBe("s1");

    store.clearSelection();
    expect(store.currentSessionId).toBeNull();
    expect(store.currentState).toBeNull();
    expect(store.members).toEqual([]);
    expect(store.sessions).toHaveLength(1); // list preserved
  });

  it("classifyIntake stores classification on success", async () => {
    const classification = {
      decision: "team" as const,
      confidence: "high" as const,
      complexity: "moderate" as const,
      scopeCount: 2,
      boundaries: ["desktop-app-vue/src/main", "desktop-app-vue/src/renderer"],
      testHeavy: false,
      signals: ["multi-scope"],
      reason: "2 distinct scopes",
      recommendedConcurrency: 2,
      suggestedRoles: ["executor/main", "executor/ui"],
    };
    const bridge = makeBridge({
      classifyIntake: vi
        .fn()
        .mockResolvedValue({ success: true, classification }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    const result = await store.classifyIntake({
      request: "wire IPC and store",
      scopePaths: [
        "desktop-app-vue/src/main/x.js",
        "desktop-app-vue/src/renderer/y.ts",
      ],
    });
    expect(result).toEqual(classification);
    expect(store.lastClassification).toEqual(classification);
    expect(store.error).toBeNull();
  });

  it("classifyIntake records error when IPC reports failure", async () => {
    const bridge = makeBridge({
      classifyIntake: vi
        .fn()
        .mockResolvedValue({ success: false, error: "bad input" }),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    const result = await store.classifyIntake({ request: "anything" });
    expect(result).toBeNull();
    expect(store.error).toBe("bad input");
    expect(store.lastClassification).toBeNull();
  });

  it("classifyIntake catches thrown errors", async () => {
    const bridge = makeBridge({
      classifyIntake: vi.fn().mockRejectedValue(new Error("ipc down")),
    });
    installBridge(bridge);

    const store = useWorkflowSessionStore();
    const result = await store.classifyIntake({ request: "anything" });
    expect(result).toBeNull();
    expect(store.error).toBe("ipc down");
  });

  it("taskReadiness is all-zero when no tasks loaded", () => {
    installBridge(makeBridge());
    const store = useWorkflowSessionStore();
    expect(store.taskReadiness).toEqual({
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    });
    expect(store.hasVerifyResult).toBe(false);
    expect(store.verifyPassed).toBe(false);
  });
});
