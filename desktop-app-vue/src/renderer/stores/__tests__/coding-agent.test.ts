import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

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
      subscribeEvents: vi.fn(),
      onEvent: vi.fn(),
    };

    (window as any).electronAPI = {
      codingAgent: codingAgentApi,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
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
});
