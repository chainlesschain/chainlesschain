/**
 * useSessionStore — loadSessionDetail stale-response race guard
 *
 * Regression: loadSessionDetail awaited session:load then set currentSession
 * unconditionally. Fast-switching sessions let a slower load overwrite a newer
 * session. A monotonic token now applies the result only if still the latest
 * (the stale caller still gets its own result back).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockInvoke = vi.fn();

describe("loadSessionDetail stale-response race", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  it("does not clobber the newer session when an older load resolves late", async () => {
    const { useSessionStore } = await import("../session");
    const store = useSessionStore();

    const resolvers: Record<string, (v: unknown) => void> = {};
    mockInvoke.mockImplementation(
      (_channel: string, id: string) =>
        new Promise((resolve) => {
          resolvers[id] = resolve;
        }),
    );

    const pA = store.loadSessionDetail("A"); // older
    const pB = store.loadSessionDetail("B"); // newer claims the token

    resolvers["B"]({ id: "B" });
    await pB;
    expect(store.currentSession?.id).toBe("B");

    resolvers["A"]({ id: "A" });
    const aResult = await pA;
    // currentSession stays B, but the stale caller still receives its own result.
    expect(store.currentSession?.id).toBe("B");
    expect((aResult as any)?.id).toBe("A");
  });

  it("still sets currentSession for a normal single load and clears the spinner", async () => {
    const { useSessionStore } = await import("../session");
    const store = useSessionStore();
    mockInvoke.mockResolvedValue({ id: "X" });

    await store.loadSessionDetail("X");

    expect(store.currentSession?.id).toBe("X");
    expect(store.loadingDetail).toBe(false);
  });
});
