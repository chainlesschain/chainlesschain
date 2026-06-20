/**
 * useConversationStore — loadConversation stale-response race guard
 *
 * Regression: when a conversation isn't cached, loadConversation awaits
 * electronAPI.db.getConversation then set this.currentConversation
 * unconditionally. A fast switch to another conversation got clobbered when the
 * slower DB load resolved. A monotonic token now discards superseded results.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockGetConversation = vi.fn();

describe("loadConversation stale-response race", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockGetConversation.mockReset();
    (window as any).electronAPI = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      db: { getConversation: mockGetConversation },
    };
  });

  it("discards an older DB load that resolves after a newer one", async () => {
    const { useConversationStore } = await import("../conversation");
    const store = useConversationStore();

    const resolvers: Record<string, (v: unknown) => void> = {};
    mockGetConversation.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          resolvers[id] = resolve;
        }),
    );

    const pA = store.loadConversation("A"); // older
    const pB = store.loadConversation("B"); // newer claims the token

    resolvers["B"]({ id: "B", title: "B", messages: [] });
    await pB;
    expect(store.currentConversation?.id).toBe("B");

    resolvers["A"]({ id: "A", title: "A", messages: [] });
    await pA;
    expect(store.currentConversation?.id).toBe("B"); // stale A discarded
  });

  it("a cached (sync) newer load is not overwritten by a stale DB load", async () => {
    const { useConversationStore } = await import("../conversation");
    const store = useConversationStore();
    store.conversations = [{ id: "A", title: "A", messages: [] } as any];

    let resolveB: (v: unknown) => void = () => {};
    mockGetConversation.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          if (id === "B") resolveB = resolve;
        }),
    );

    const pB = store.loadConversation("B"); // older, awaits DB
    await store.loadConversation("A"); // newer, in-memory → sets current=A
    expect(store.currentConversation?.id).toBe("A");

    resolveB({ id: "B", title: "B", messages: [] });
    await pB;
    expect(store.currentConversation?.id).toBe("A"); // stale B discarded
  });

  it("still sets currentConversation for a normal single load", async () => {
    const { useConversationStore } = await import("../conversation");
    const store = useConversationStore();
    mockGetConversation.mockResolvedValue({ id: "X", title: "X", messages: [] });

    await store.loadConversation("X");

    expect(store.currentConversation?.id).toBe("X");
  });
});
