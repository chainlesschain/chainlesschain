import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useWorkflowSessionStore } from "../workflow-session";

function makeBridge(overrides: Record<string, any> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
    get: vi.fn().mockResolvedValue({ success: false, error: "not set" }),
    listMembers: vi.fn().mockResolvedValue({ success: true, members: [] }),
    classifyIntake: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function installBridge(bridge: Record<string, any>) {
  (globalThis as any).window = { electronAPI: { workflowSession: bridge } };
}

describe("workflow-session selectSession stale-response race", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).window;
  });

  it("does not show a newer session with an older session's state", async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};
    installBridge(
      makeBridge({
        get: vi.fn(
          (id: string) => new Promise((resolve) => (resolvers[id] = resolve)),
        ),
      }),
    );
    const store = useWorkflowSessionStore();

    const pA = store.selectSession("A"); // older
    const pB = store.selectSession("B"); // newer → currentSessionId = B

    resolvers["B"]({ success: true, state: { id: "B" } });
    await pB;
    expect(store.currentSessionId).toBe("B");
    expect(store.currentState).toEqual({ id: "B" });

    resolvers["A"]({ success: true, state: { id: "A" } });
    await pA;
    // currentSessionId stays B and currentState is NOT overwritten by A.
    expect(store.currentSessionId).toBe("B");
    expect(store.currentState).toEqual({ id: "B" });
  });

  it("a stale failure does not wipe the newer session's state", async () => {
    let resolveB: (v: unknown) => void = () => {};
    let rejectA: (e: unknown) => void = () => {};
    installBridge(
      makeBridge({
        get: vi.fn(
          (id: string) =>
            new Promise((resolve, reject) => {
              if (id === "A") rejectA = reject;
              else resolveB = resolve;
            }),
        ),
      }),
    );
    const store = useWorkflowSessionStore();

    const pA = store.selectSession("A");
    const pB = store.selectSession("B");

    resolveB({ success: true, state: { id: "B" } });
    await pB;
    expect(store.currentState).toEqual({ id: "B" });

    rejectA(new Error("late fail"));
    await pA;
    expect(store.currentState).toEqual({ id: "B" }); // not nulled
    expect(store.currentSessionId).toBe("B");
  });

  it("still applies state for a normal single select", async () => {
    installBridge(
      makeBridge({
        get: vi
          .fn()
          .mockResolvedValue({ success: true, state: { id: "solo" } }),
      }),
    );
    const store = useWorkflowSessionStore();

    await store.selectSession("solo");

    expect(store.currentState).toEqual({ id: "solo" });
    expect(store.loadingDetail).toBe(false);
  });
});
