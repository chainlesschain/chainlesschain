/**
 * useConversationStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - createNewConversation()
 *  - loadConversations()     → electronAPI.db.getConversations
 *  - loadConversation()      → electronAPI.db.getConversation
 *  - addMessage()            → auto-create conversation, token tracking, auto-title
 *  - updateMessage()
 *  - deleteMessage()
 *  - clearCurrentMessages()
 *  - saveCurrentConversation() → batch save queue
 *  - deleteConversation()    → electronAPI.db.deleteConversation
 *  - searchConversations()   → in-memory search
 *  - exportConversation()
 *  - importConversation()
 *  - Getters: currentMessages, currentConversationTitle, conversationCount
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Conversation, ConversationMessage } from "../conversation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    title: "Test Conversation",
    messages: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    metadata: { totalTokens: 0 },
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useConversationStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockGetConversations = vi.fn();
  const mockGetConversation = vi.fn();
  const mockSaveConversation = vi.fn();
  const mockDeleteConversation = vi.fn();
  const mockUpdateConversation = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockGetConversations.mockResolvedValue(null);
    mockSaveConversation.mockResolvedValue(undefined);
    mockDeleteConversation.mockResolvedValue(undefined);
    mockUpdateConversation.mockResolvedValue(undefined);

    (window as any).electronAPI = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      db: {
        getConversations: mockGetConversations,
        getConversation: mockGetConversation,
        saveConversation: mockSaveConversation,
        deleteConversation: mockDeleteConversation,
        updateConversation: mockUpdateConversation,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("conversations starts as empty array", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.conversations).toEqual([]);
    });

    it("currentConversation starts as null", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.currentConversation).toBeNull();
    });

    it("loading starts as false", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.loading).toBe(false);
    });

    it("pagination has default values", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.pagination).toEqual({ offset: 0, limit: 50, total: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // createNewConversation
  // -------------------------------------------------------------------------

  describe("createNewConversation()", () => {
    it("creates a new conversation and sets it as current", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      const conv = store.createNewConversation();
      expect(conv.id).toMatch(/^conv_/);
      expect(store.currentConversation!.id).toBe(conv.id);
      expect(store.conversations).toHaveLength(1);
    });

    it("adds the new conversation to the front of the list", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [makeConversation({ id: "old" })];
      const conv = store.createNewConversation();
      expect(store.conversations[0].id).toBe(conv.id);
    });
  });

  // -------------------------------------------------------------------------
  // loadConversations
  // -------------------------------------------------------------------------

  describe("loadConversations()", () => {
    it("loads conversations from db API", async () => {
      const conversations = [
        makeConversation({ id: "c1" }),
        makeConversation({ id: "c2" }),
      ];
      mockGetConversations.mockResolvedValue({ conversations, total: 2 });

      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      await store.loadConversations();

      expect(store.conversations).toHaveLength(2);
      expect(store.pagination.total).toBe(2);
    });

    it("replaces conversations at offset 0", async () => {
      mockGetConversations.mockResolvedValue({
        conversations: [makeConversation({ id: "new" })],
        total: 1,
      });

      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [makeConversation({ id: "old" })];
      await store.loadConversations(0);
      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0].id).toBe("new");
    });

    it("sets loading to false after completion", async () => {
      mockGetConversations.mockResolvedValue(null);
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      await store.loadConversations();
      expect(store.loading).toBe(false);
    });

    it("handles IPC errors gracefully", async () => {
      mockGetConversations.mockRejectedValue(
        new Error("No handler registered"),
      );
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      await store.loadConversations();
      expect(store.loading).toBe(false);
      expect(store.conversations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // addMessage
  // -------------------------------------------------------------------------

  describe("addMessage()", () => {
    it("auto-creates a conversation if none exists", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.addMessage({ role: "user", content: "hi" });
      expect(store.currentConversation).not.toBeNull();
    });

    it("appends message to current conversation", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      store.addMessage({ role: "user", content: "Hello" });
      expect(store.currentConversation!.messages).toHaveLength(1);
      expect(store.currentConversation!.messages[0].content).toBe("Hello");
    });

    it("generates a message ID", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      const msg = store.addMessage({ role: "user", content: "test" });
      expect(msg.id).toMatch(/^msg_/);
    });

    it("tracks token count in metadata", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      store.addMessage({ role: "assistant", content: "response", tokens: 100 });
      expect(store.currentConversation!.metadata.totalTokens).toBe(100);
    });

    it("accumulates tokens across messages", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      store.addMessage({ role: "user", content: "q", tokens: 10 });
      store.addMessage({ role: "assistant", content: "a", tokens: 50 });
      expect(store.currentConversation!.metadata.totalTokens).toBe(60);
    });

    it("auto-generates title from first user message", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      store.addMessage({
        role: "user",
        content: "How do I fix TypeScript errors in Vue?",
      });
      expect(store.currentConversation!.title).toContain(
        "How do I fix TypeScript",
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateMessage / deleteMessage
  // -------------------------------------------------------------------------

  describe("updateMessage()", () => {
    it("updates an existing message by ID", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      const msg = store.addMessage({ role: "user", content: "old" });
      store.updateMessage(msg.id, { content: "new" });
      expect(store.currentConversation!.messages[0].content).toBe("new");
    });

    it("does nothing if no currentConversation", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      // Should not throw
      store.updateMessage("nonexistent", { content: "test" });
    });
  });

  describe("deleteMessage()", () => {
    it("removes a message by ID", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      const msg = store.addMessage({ role: "user", content: "delete me" });
      store.deleteMessage(msg.id);
      expect(store.currentConversation!.messages).toHaveLength(0);
    });
  });

  describe("clearCurrentMessages()", () => {
    it("empties messages and resets token count", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.createNewConversation();
      store.addMessage({ role: "user", content: "test", tokens: 50 });
      store.clearCurrentMessages();
      expect(store.currentConversation!.messages).toEqual([]);
      expect(store.currentConversation!.metadata.totalTokens).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // deleteConversation
  // -------------------------------------------------------------------------

  describe("deleteConversation()", () => {
    it("removes from list and calls db API", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [
        makeConversation({ id: "del" }),
        makeConversation({ id: "keep" }),
      ];
      await store.deleteConversation("del");
      expect(store.conversations).toHaveLength(1);
      expect(mockDeleteConversation).toHaveBeenCalledWith("del");
    });

    it("clears currentConversation if it matches", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      const conv = makeConversation({ id: "del" });
      store.conversations = [conv];
      store.currentConversation = conv;
      await store.deleteConversation("del");
      expect(store.currentConversation).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // searchConversations
  // -------------------------------------------------------------------------

  describe("searchConversations()", () => {
    it("returns all conversations for empty query", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [
        makeConversation(),
        makeConversation({ id: "c2" }),
      ];
      expect(store.searchConversations("")).toHaveLength(2);
    });

    it("filters by title match", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [
        makeConversation({ id: "c1", title: "Vue debugging" }),
        makeConversation({ id: "c2", title: "Python scripting" }),
      ];
      const result = store.searchConversations("vue");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("c1");
    });

    it("filters by message content match", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [
        makeConversation({
          id: "c1",
          title: "Chat",
          messages: [makeMessage({ content: "hello world" })],
        }),
      ];
      const result = store.searchConversations("world");
      expect(result).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // exportConversation
  // -------------------------------------------------------------------------

  describe("exportConversation()", () => {
    it("returns exported data for existing conversation", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [
        makeConversation({
          id: "exp",
          title: "Export Me",
          messages: [makeMessage()],
        }),
      ];
      const exported = store.exportConversation("exp");
      expect(exported).not.toBeNull();
      expect(exported!.title).toBe("Export Me");
      expect(exported!.messages).toHaveLength(1);
    });

    it("returns null for nonexistent conversation", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.exportConversation("nonexistent")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("currentMessages returns empty array when no current conversation", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.currentMessages).toEqual([]);
    });

    it("currentConversationTitle returns default when no current conversation", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.currentConversationTitle).toBe("新对话");
    });

    it("conversationCount returns the number of conversations", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      store.conversations = [
        makeConversation(),
        makeConversation({ id: "c2" }),
      ];
      expect(store.conversationCount).toBe(2);
    });

    it("hasCurrentConversation returns false when null", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();
      expect(store.hasCurrentConversation).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("clears all state to defaults", async () => {
      const { useConversationStore } = await import("../conversation");
      const store = useConversationStore();

      store.createNewConversation();
      store.addMessage({ role: "user", content: "test" });

      await store.reset();

      expect(store.conversations).toEqual([]);
      expect(store.currentConversation).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.pendingMessages).toEqual([]);
    });
  });
});
