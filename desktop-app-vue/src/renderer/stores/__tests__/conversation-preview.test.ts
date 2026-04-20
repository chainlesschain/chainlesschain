/**
 * useConversationPreviewStore — Pinia store unit tests
 *
 * Covers:
 *  - restore() seeds a welcome conversation on empty storage
 *  - restore() hydrates from valid persisted state
 *  - restore() rejects invalid schema versions / malformed entries
 *  - createBlank() prepends a new conversation and becomes active
 *  - appendMessage() updates preview / title / updatedAt + persists
 *  - appendMessage() ignores empty / whitespace input
 *  - select() only accepts known ids
 *  - remove() drops conversation + picks new active
 *  - clearAll() wipes state and storage
 *  - Persistence survives a new store instance (reload sim)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  useConversationPreviewStore,
  __testing,
} from "../conversation-preview";

const { STORAGE_KEY, SCHEMA_VERSION } = __testing;

function rawState() {
  return localStorage.getItem(STORAGE_KEY);
}

describe("useConversationPreviewStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("seeds a welcome conversation when storage is empty", () => {
    const store = useConversationPreviewStore();
    store.restore();
    expect(store.conversations).toHaveLength(1);
    expect(store.activeId).toBe(store.conversations[0].id);
    expect(store.conversations[0].messages.length).toBeGreaterThan(0);
    expect(store.restored).toBe(true);
    expect(rawState()).toBeTruthy();
  });

  it("hydrates from previously persisted state", () => {
    const first = useConversationPreviewStore();
    first.restore();
    first.appendMessage("user", "hello world");
    const firstId = first.activeId;

    setActivePinia(createPinia());
    const second = useConversationPreviewStore();
    second.restore();
    expect(second.activeId).toBe(firstId);
    expect(second.active?.messages.at(-1)?.content).toBe("hello world");
  });

  it("rejects an invalid schema version and re-seeds", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 999, conversations: [] }),
    );
    const store = useConversationPreviewStore();
    store.restore();
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].title).toBe("欢迎使用 v6 预览");
  });

  it("rejects malformed JSON without throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const store = useConversationPreviewStore();
    expect(() => store.restore()).not.toThrow();
    expect(store.conversations).toHaveLength(1);
  });

  it("createBlank() prepends and becomes active", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const seededId = store.activeId;
    const newId = store.createBlank();
    expect(store.conversations[0].id).toBe(newId);
    expect(store.activeId).toBe(newId);
    expect(store.activeId).not.toBe(seededId);
    expect(store.conversations).toHaveLength(2);
  });

  it("appendMessage() updates preview, title on first user message, and persists", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const before = store.active!.updatedAt;
    store.appendMessage("user", "the quick brown fox jumps over the lazy dog");
    const conv = store.active!;
    expect(conv.messages.at(-1)?.content).toBe(
      "the quick brown fox jumps over the lazy dog",
    );
    expect(conv.title).toBe("the quick brown fox "); // slice(0, 20)
    expect(conv.preview.length).toBeLessThanOrEqual(40);
    expect(conv.updatedAt).toBeGreaterThanOrEqual(before);
    expect(rawState()).toContain("the quick brown fox");
  });

  it("appendMessage() ignores empty / whitespace-only input", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const beforeLen = store.active!.messages.length;
    store.appendMessage("user", "");
    store.appendMessage("user", "   \t\n ");
    expect(store.active!.messages.length).toBe(beforeLen);
  });

  it("select() only accepts known ids", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const seededId = store.activeId!;
    store.createBlank();
    store.select(seededId);
    expect(store.activeId).toBe(seededId);
    store.select("unknown-id");
    expect(store.activeId).toBe(seededId);
  });

  it("remove() drops a conversation and picks new active when active is removed", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const seededId = store.activeId!;
    const secondId = store.createBlank();
    expect(store.activeId).toBe(secondId);
    store.remove(secondId);
    expect(store.conversations.map((c) => c.id)).toEqual([seededId]);
    expect(store.activeId).toBe(seededId);
  });

  it("remove() keeps active when a different conversation is removed", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const seededId = store.activeId!;
    const secondId = store.createBlank();
    store.select(seededId);
    store.remove(secondId);
    expect(store.activeId).toBe(seededId);
  });

  it("clearAll() wipes state and storage", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.appendMessage("user", "keep me");
    store.clearAll();
    expect(store.conversations).toHaveLength(0);
    expect(store.activeId).toBeNull();
    expect(rawState()).toBeNull();
  });

  it("persisted state uses the declared schema version", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const raw = JSON.parse(rawState()!);
    expect(raw.version).toBe(SCHEMA_VERSION);
    expect(Array.isArray(raw.conversations)).toBe(true);
  });

  it("appendMessage() on empty store auto-creates a conversation then appends", () => {
    const store = useConversationPreviewStore();
    // no restore; state is empty
    store.appendMessage("user", "first ever");
    expect(store.conversations.length).toBe(1);
    expect(store.active?.messages.at(-1)?.content).toBe("first ever");
  });

  it("appendAssistantMessage() appends without overwriting the title", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    expect(store.active!.title).toBe("新会话");
    store.appendAssistantMessage("assistant says hi from a brand new chat");
    expect(store.active!.title).toBe("新会话");
    expect(store.active!.messages.at(-1)?.role).toBe("assistant");
    expect(store.active!.messages.at(-1)?.content).toBe(
      "assistant says hi from a brand new chat",
    );
  });

  it("setGenerating() toggles the generating flag", () => {
    const store = useConversationPreviewStore();
    expect(store.isGenerating).toBe(false);
    store.setGenerating(true);
    expect(store.isGenerating).toBe(true);
    store.setGenerating(false);
    expect(store.isGenerating).toBe(false);
  });

  it("beginStreamingAssistant() seeds an empty assistant bubble and returns its id", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const before = store.active!.messages.length;
    const id = store.beginStreamingAssistant();
    expect(id).toBeTruthy();
    const conv = store.active!;
    expect(conv.messages.length).toBe(before + 1);
    const last = conv.messages.at(-1)!;
    expect(last.id).toBe(id);
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("");
  });

  it("updateAssistantContent() updates the target bubble without persisting on every tick", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const id = store.beginStreamingAssistant()!;
    store.updateAssistantContent(id, "partial");
    expect(store.active!.messages.find((m) => m.id === id)?.content).toBe(
      "partial",
    );
    expect(store.active!.preview).toBe("partial");
  });

  it("updateAssistantContent() is a no-op for unknown id / non-assistant role", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    store.appendMessage("user", "hello");
    const userMsgId = store.active!.messages.at(-1)!.id;
    store.updateAssistantContent(userMsgId, "hijacked");
    expect(
      store.active!.messages.find((m) => m.id === userMsgId)?.content,
    ).toBe("hello");
    store.updateAssistantContent("nope", "also hijacked");
    expect(
      store.active!.messages.some((m) => m.content === "also hijacked"),
    ).toBe(false);
  });

  it("finalizeStreamingAssistant() sets final content and persists", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const id = store.beginStreamingAssistant()!;
    store.finalizeStreamingAssistant(id, "Hello world");
    expect(store.active!.messages.find((m) => m.id === id)?.content).toBe(
      "Hello world",
    );
    const persisted = JSON.parse(rawState()!);
    const conv = persisted.conversations.find(
      (c: { id: string }) => c.id === store.activeId,
    );
    expect(conv.messages.at(-1).content).toBe("Hello world");
  });

  it("removeMessage() drops a specific message by id", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    store.appendMessage("user", "one");
    const userId = store.active!.messages.at(-1)!.id;
    const streamId = store.beginStreamingAssistant()!;
    store.removeMessage(streamId);
    expect(store.active!.messages.some((m) => m.id === streamId)).toBe(false);
    expect(store.active!.messages.some((m) => m.id === userId)).toBe(true);
  });
});
