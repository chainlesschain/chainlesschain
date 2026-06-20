/**
 * useSocialStore — loadMessages stale-response race guard
 *
 * Regression: loadMessages awaited chat:get-messages then wrote currentMessages
 * unconditionally. currentMessages always belongs to the current chat session,
 * so switching friends/chats during the await showed the old chat's messages in
 * the new chat. Guard discards the response when the current session changed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../utils/ipc", () => ({
  createRetryableIPC: () => ({ invoke: mockInvoke }),
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useSocialStore } from "../social";

describe("loadMessages stale-response race", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  it("discards messages when the chat switched during the await", async () => {
    const store = useSocialStore();
    store.currentChatSession = { id: "A" } as any;
    store.currentMessages = [];

    let resolve: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );

    const p = store.loadMessages("A", 50, 0);

    // User opens a different chat before A's messages return.
    store.currentChatSession = { id: "B" } as any;
    store.currentMessages = [];

    resolve([{ id: "a1" }, { id: "a2" }]);
    await p;

    expect(store.currentMessages).toHaveLength(0); // B's chat not clobbered
  });

  it("applies messages when still on the same chat", async () => {
    const store = useSocialStore();
    store.currentChatSession = { id: "A" } as any;
    store.currentMessages = [];
    mockInvoke.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    await store.loadMessages("A", 50, 0);

    expect(store.currentMessages).toHaveLength(2);
  });

  it("prepend (pagination) path also guards on a chat switch", async () => {
    const store = useSocialStore();
    store.currentChatSession = { id: "A" } as any;
    store.currentMessages = [{ id: "a-live" } as any];

    let resolve: (v: unknown) => void = () => {};
    mockInvoke.mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );

    const p = store.loadMessages("A", 50, 50); // offset > 0 → prepend

    store.currentChatSession = { id: "B" } as any;
    store.currentMessages = [{ id: "b-live" } as any];

    resolve([{ id: "a-old" }]);
    await p;

    expect(store.currentMessages.map((m: any) => m.id)).toEqual(["b-live"]);
  });
});
