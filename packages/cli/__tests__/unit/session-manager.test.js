import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  createSession,
  addMessage,
  saveMessages,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
  exportSessionMarkdown,
} from "../../src/lib/session-manager.js";

describe("session-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  afterEach(() => {
    db.close();
  });

  // ── createSession ──

  describe("createSession", () => {
    it("creates a new session with title", () => {
      const result = createSession(db, { title: "Test Chat" });
      expect(result.id).toBeDefined();
      expect(result.title).toBe("Test Chat");
    });

    it("creates with custom ID", () => {
      const result = createSession(db, { id: "custom-id", title: "Custom" });
      expect(result.id).toBe("custom-id");
    });

    it("defaults title to Untitled", () => {
      const result = createSession(db);
      expect(result.title).toBe("Untitled");
    });

    it("persists to database", () => {
      createSession(db, { id: "test", title: "Chat" });
      const rows = db.data.get("llm_sessions") || [];
      expect(rows.length).toBe(1);
    });

    it("stores provider and model", () => {
      createSession(db, {
        id: "s1",
        title: "Chat",
        provider: "ollama",
        model: "qwen2:7b",
      });
      const rows = db.data.get("llm_sessions") || [];
      expect(rows[0].provider).toBe("ollama");
      expect(rows[0].model).toBe("qwen2:7b");
    });

    it("defaults provider and model to empty string", () => {
      createSession(db, { id: "s1", title: "Chat" });
      const rows = db.data.get("llm_sessions") || [];
      expect(rows[0].provider).toBe("");
      expect(rows[0].model).toBe("");
    });

    it("stores initial messages as JSON", () => {
      const msgs = [{ role: "system", content: "You are helpful" }];
      createSession(db, { id: "s1", title: "Chat", messages: msgs });
      const rows = db.data.get("llm_sessions") || [];
      expect(JSON.parse(rows[0].messages)).toEqual(msgs);
    });

    it("defaults messages to empty array", () => {
      createSession(db, { id: "s1", title: "Chat" });
      const rows = db.data.get("llm_sessions") || [];
      expect(JSON.parse(rows[0].messages)).toEqual([]);
    });

    it("generates unique IDs when not specified", () => {
      const r1 = createSession(db, { title: "A" });
      const r2 = createSession(db, { title: "B" });
      expect(r1.id).not.toBe(r2.id);
    });

    it("creates table if not exists", () => {
      expect(db.tables.has("llm_sessions")).toBe(false);
      createSession(db, { title: "Test" });
      expect(db.tables.has("llm_sessions")).toBe(true);
    });
  });

  // ── addMessage ──

  describe("addMessage", () => {
    it("adds a message to a session", () => {
      createSession(db, { id: "s1", title: "Test" });
      const result = addMessage(db, "s1", "user", "Hello");
      expect(result.messageCount).toBe(1);
    });

    it("increments message count", () => {
      createSession(db, { id: "s1", title: "Test" });
      addMessage(db, "s1", "user", "Hello");
      const result = addMessage(db, "s1", "assistant", "Hi there");
      expect(result.messageCount).toBe(2);
    });

    it("returns null for non-existent session", () => {
      const result = addMessage(db, "nonexistent", "user", "Hello");
      expect(result).toBeNull();
    });

    it("adds message with timestamp", () => {
      createSession(db, { id: "s1", title: "Test" });
      addMessage(db, "s1", "user", "Hello");
      const session = getSession(db, "s1");
      expect(session.messages[0].timestamp).toBeDefined();
    });

    it("preserves existing messages", () => {
      createSession(db, {
        id: "s1",
        title: "Test",
        messages: [{ role: "system", content: "sys" }],
      });
      addMessage(db, "s1", "user", "Hello");
      const session = getSession(db, "s1");
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].role).toBe("system");
      expect(session.messages[1].role).toBe("user");
    });
  });

  // ── saveMessages ──

  describe("saveMessages", () => {
    it("saves all messages at once", () => {
      createSession(db, { id: "s1", title: "Test" });
      const msgs = [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ];
      const result = saveMessages(db, "s1", msgs);
      expect(result.messageCount).toBe(2);
      expect(result.updated).toBe(true);
    });

    it("returns updated: false for non-existent session", () => {
      const result = saveMessages(db, "nonexistent", [
        { role: "user", content: "hi" },
      ]);
      expect(result.updated).toBe(false);
    });

    it("replaces existing messages", () => {
      createSession(db, {
        id: "s1",
        title: "Test",
        messages: [{ role: "system", content: "old" }],
      });
      saveMessages(db, "s1", [{ role: "user", content: "new" }]);
      const session = getSession(db, "s1");
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].content).toBe("new");
    });
  });

  // ── getSession ──

  describe("getSession", () => {
    it("retrieves a session by exact ID", () => {
      createSession(db, {
        id: "s1",
        title: "Test",
        provider: "ollama",
        model: "qwen2:7b",
      });
      const session = getSession(db, "s1");
      expect(session).toBeDefined();
      expect(session.title).toBe("Test");
      expect(session.provider).toBe("ollama");
    });

    it("returns null for not found", () => {
      expect(getSession(db, "nonexistent")).toBeNull();
    });

    it("parses messages JSON", () => {
      createSession(db, {
        id: "s1",
        title: "Test",
        messages: [{ role: "user", content: "Hi" }],
      });
      const session = getSession(db, "s1");
      expect(Array.isArray(session.messages)).toBe(true);
      expect(session.messages[0].content).toBe("Hi");
    });

    it("returns empty messages array when none stored", () => {
      createSession(db, { id: "s1", title: "Test" });
      const session = getSession(db, "s1");
      expect(session.messages).toEqual([]);
    });

    it("finds session by prefix match", () => {
      createSession(db, { id: "session-12345-abcdef", title: "Prefixed" });
      const session = getSession(db, "session-12345");
      expect(session).toBeDefined();
      expect(session.title).toBe("Prefixed");
    });

    it("prefers exact match over prefix match", () => {
      createSession(db, { id: "s1", title: "Exact" });
      createSession(db, { id: "s1-extended", title: "Extended" });
      const session = getSession(db, "s1");
      expect(session.title).toBe("Exact");
    });
  });

  // ── listSessions ──

  describe("listSessions", () => {
    it("lists sessions", () => {
      createSession(db, { id: "s1", title: "First" });
      createSession(db, { id: "s2", title: "Second" });

      const sessions = listSessions(db);
      expect(sessions.length).toBe(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createSession(db, { id: `s${i}`, title: `Session ${i}` });
      }

      const sessions = listSessions(db, { limit: 3 });
      expect(sessions.length).toBe(3);
    });

    it("returns empty array when no sessions", () => {
      const sessions = listSessions(db);
      expect(sessions).toEqual([]);
    });

    it("uses default limit of 20", () => {
      for (let i = 0; i < 25; i++) {
        createSession(db, { id: `s${i}`, title: `Session ${i}` });
      }
      const sessions = listSessions(db);
      expect(sessions.length).toBe(20);
    });

    it("does not include full messages in list", () => {
      createSession(db, {
        id: "s1",
        title: "Test",
        messages: [{ role: "user", content: "long text" }],
      });
      const sessions = listSessions(db);
      // listSessions selects specific columns, not messages
      expect(sessions[0].id).toBe("s1");
      expect(sessions[0].title).toBe("Test");
    });
  });

  // ── updateSession ──

  describe("updateSession", () => {
    it("updates session title", () => {
      createSession(db, { id: "s1", title: "Old" });
      updateSession(db, "s1", { title: "New Title" });
      const session = getSession(db, "s1");
      expect(session.title).toBe("New Title");
    });

    it("updates session summary", () => {
      createSession(db, { id: "s1", title: "Test" });
      updateSession(db, "s1", { summary: "A test summary" });
      const rows = db.data.get("llm_sessions") || [];
      expect(rows[0].summary).toBe("A test summary");
    });
  });

  // ── deleteSession ──

  describe("deleteSession", () => {
    it("deletes a session", () => {
      createSession(db, { id: "s1", title: "Test" });
      const deleted = deleteSession(db, "s1");
      expect(deleted).toBe(true);
    });

    it("returns false for non-existent session", () => {
      expect(deleteSession(db, "nonexistent")).toBe(false);
    });

    it("session is gone after deletion", () => {
      createSession(db, { id: "s1", title: "Test" });
      deleteSession(db, "s1");
      const rows = db.data.get("llm_sessions") || [];
      expect(rows.length).toBe(0);
    });
  });

  // ── exportSessionMarkdown ──

  describe("exportSessionMarkdown", () => {
    it("exports session as markdown", () => {
      const session = {
        title: "Test Chat",
        created_at: "2024-01-01 12:00:00",
        provider: "ollama",
        model: "qwen2:7b",
        message_count: 2,
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      };

      const md = exportSessionMarkdown(session);
      expect(md).toContain("# Test Chat");
      expect(md).toContain("**You**");
      expect(md).toContain("**AI**");
      expect(md).toContain("Hello");
      expect(md).toContain("Hi there!");
    });

    it("excludes system messages", () => {
      const session = {
        title: "Test",
        created_at: "2024-01-01",
        provider: "ollama",
        model: "qwen2:7b",
        message_count: 1,
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
        ],
      };

      const md = exportSessionMarkdown(session);
      expect(md).not.toContain("You are helpful");
    });

    it("includes metadata in header", () => {
      const session = {
        title: "My Chat",
        created_at: "2024-06-15 10:30:00",
        provider: "openai",
        model: "gpt-4o",
        message_count: 5,
        messages: [],
      };

      const md = exportSessionMarkdown(session);
      expect(md).toContain("openai");
      expect(md).toContain("gpt-4o");
      expect(md).toContain("2024-06-15");
    });

    it("handles string messages (JSON)", () => {
      const session = {
        title: "Test",
        created_at: "2024-01-01",
        provider: "ollama",
        model: "m",
        message_count: 1,
        messages: JSON.stringify([{ role: "user", content: "Hello" }]),
      };

      const md = exportSessionMarkdown(session);
      expect(md).toContain("Hello");
    });

    it("handles empty messages array", () => {
      const session = {
        title: "Empty",
        created_at: "2024-01-01",
        provider: "ollama",
        model: "m",
        message_count: 0,
        messages: [],
      };

      const md = exportSessionMarkdown(session);
      expect(md).toContain("# Empty");
    });

    it("handles missing messages gracefully", () => {
      const session = {
        title: "No Messages",
        created_at: "2024-01-01",
        provider: "ollama",
        model: "m",
        message_count: 0,
      };

      const md = exportSessionMarkdown(session);
      expect(md).toContain("# No Messages");
    });
  });
});
