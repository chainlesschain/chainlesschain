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

    it("stores metadata as JSON", () => {
      createSession(db, {
        id: "s-meta",
        title: "Meta",
        metadata: {
          sessionType: "agent",
          projectRoot: "/tmp/project",
        },
      });
      const rows = db.data.get("llm_sessions") || [];
      expect(JSON.parse(rows[0].metadata)).toEqual({
        sessionType: "agent",
        projectRoot: "/tmp/project",
      });
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

    it("updates metadata when provided", () => {
      createSession(db, { id: "s1", title: "Test" });
      saveMessages(db, "s1", [{ role: "user", content: "new" }], {
        sessionType: "agent",
        baseUrl: "http://localhost:11434",
      });
      const session = getSession(db, "s1");
      expect(session.metadata).toEqual({
        sessionType: "agent",
        baseUrl: "http://localhost:11434",
      });
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

    it("parses metadata JSON", () => {
      createSession(db, {
        id: "s1",
        title: "Test",
        metadata: {
          sessionType: "agent",
          worktreeIsolation: true,
        },
      });
      const session = getSession(db, "s1");
      expect(session.metadata).toEqual({
        sessionType: "agent",
        worktreeIsolation: true,
      });
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
        metadata: { sessionType: "agent" },
      });
      const sessions = listSessions(db);
      // listSessions selects specific columns, not messages
      expect(sessions[0].id).toBe("s1");
      expect(sessions[0].title).toBe("Test");
      expect(sessions[0].metadata).toEqual({ sessionType: "agent" });
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

    it("updates metadata", () => {
      createSession(db, { id: "s1", title: "Test" });
      updateSession(db, "s1", {
        metadata: { sessionType: "chat", baseProjectRoot: "/repo" },
      });
      const session = getSession(db, "s1");
      expect(session.metadata).toEqual({
        sessionType: "chat",
        baseProjectRoot: "/repo",
      });
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

// ═══════════════════════════════════════════════════════════════
// V2 Surface tests — Session governance layer
// ═══════════════════════════════════════════════════════════════

import {
  CONVERSATION_MATURITY_V2,
  TURN_LIFECYCLE_V2,
  SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER,
  SESSION_DEFAULT_MAX_PENDING_TURNS_PER_CONV,
  SESSION_DEFAULT_CONV_IDLE_MS,
  SESSION_DEFAULT_TURN_STUCK_MS,
  getMaxActiveConvPerUserV2,
  setMaxActiveConvPerUserV2,
  getMaxPendingTurnsPerConvV2,
  setMaxPendingTurnsPerConvV2,
  getConvIdleMsV2,
  setConvIdleMsV2,
  getTurnStuckMsV2,
  setTurnStuckMsV2,
  getActiveConvCountV2,
  getPendingTurnCountV2,
  registerConversationV2,
  getConversationV2,
  listConversationsV2,
  setConversationStatusV2,
  activateConversationV2,
  pauseConversationV2,
  archiveConversationV2,
  touchConversationV2,
  createTurnV2,
  getTurnV2,
  listTurnsV2,
  setTurnStatusV2,
  streamTurnV2,
  completeTurnV2,
  failTurnV2,
  cancelTurnV2,
  autoArchiveIdleConversationsV2,
  autoFailStuckTurnsV2,
  getSessionManagerStatsV2,
  _resetStateSessionManagerV2,
} from "../../src/lib/session-manager.js";

describe("Session Manager V2", () => {
  beforeEach(() => _resetStateSessionManagerV2());

  describe("enums + defaults", () => {
    it("CONVERSATION_MATURITY_V2 frozen 4 states", () => {
      expect(Object.values(CONVERSATION_MATURITY_V2).sort()).toEqual([
        "active",
        "archived",
        "draft",
        "paused",
      ]);
      expect(Object.isFrozen(CONVERSATION_MATURITY_V2)).toBe(true);
    });
    it("TURN_LIFECYCLE_V2 frozen 5 states", () => {
      expect(Object.values(TURN_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "completed",
        "failed",
        "pending",
        "streaming",
      ]);
      expect(Object.isFrozen(TURN_LIFECYCLE_V2)).toBe(true);
    });
    it("default config", () => {
      expect(SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER).toBe(50);
      expect(SESSION_DEFAULT_MAX_PENDING_TURNS_PER_CONV).toBe(3);
      expect(SESSION_DEFAULT_CONV_IDLE_MS).toBe(1000 * 60 * 60 * 24 * 14);
      expect(SESSION_DEFAULT_TURN_STUCK_MS).toBe(1000 * 60 * 5);
    });
  });

  describe("config setters", () => {
    it("max-active-conv rejects non-positive + floors", () => {
      expect(() => setMaxActiveConvPerUserV2(0)).toThrow();
      expect(() => setMaxActiveConvPerUserV2(-1)).toThrow();
      setMaxActiveConvPerUserV2(2.9);
      expect(getMaxActiveConvPerUserV2()).toBe(2);
    });
    it("max-pending-turns + idle/stuck setters", () => {
      setMaxPendingTurnsPerConvV2(5);
      setConvIdleMsV2(1000);
      setTurnStuckMsV2(500);
      expect(getMaxPendingTurnsPerConvV2()).toBe(5);
      expect(getConvIdleMsV2()).toBe(1000);
      expect(getTurnStuckMsV2()).toBe(500);
    });
  });

  describe("registerConversationV2", () => {
    it("creates draft conversation", () => {
      const c = registerConversationV2("c1", {
        userId: "alice",
        model: "gpt-4",
        now: 100,
      });
      expect(c.status).toBe("draft");
      expect(c.userId).toBe("alice");
      expect(c.model).toBe("gpt-4");
      expect(c.createdAt).toBe(100);
      expect(c.activatedAt).toBeNull();
    });
    it("rejects bad inputs / duplicates", () => {
      expect(() => registerConversationV2("")).toThrow();
      expect(() => registerConversationV2("c1", { model: "x" })).toThrow();
      expect(() => registerConversationV2("c1", { userId: "u" })).toThrow();
      registerConversationV2("c1", { userId: "u", model: "m" });
      expect(() =>
        registerConversationV2("c1", { userId: "u", model: "m" }),
      ).toThrow();
    });
    it("returns defensive copy", () => {
      const c = registerConversationV2("c1", {
        userId: "u",
        model: "m",
        metadata: { tag: "x" },
      });
      c.metadata.tag = "MUTATED";
      expect(getConversationV2("c1").metadata.tag).toBe("x");
    });
  });

  describe("conversation lifecycle", () => {
    beforeEach(() =>
      registerConversationV2("c1", { userId: "u", model: "m", now: 0 }),
    );
    it("draft → active stamps activatedAt", () => {
      const c = activateConversationV2("c1", { now: 50 });
      expect(c.status).toBe("active");
      expect(c.activatedAt).toBe(50);
    });
    it("activatedAt stamp-once across paused→active recovery", () => {
      activateConversationV2("c1", { now: 50 });
      pauseConversationV2("c1", { now: 60 });
      const c = activateConversationV2("c1", { now: 70 });
      expect(c.activatedAt).toBe(50);
    });
    it("archived terminal sticks", () => {
      archiveConversationV2("c1", { now: 100 });
      expect(() => activateConversationV2("c1")).toThrow(/terminal/);
    });
    it("rejects illegal transitions", () => {
      expect(() => setConversationStatusV2("c1", "paused")).toThrow(/cannot/);
      expect(() => setConversationStatusV2("c1", "bogus")).toThrow(/unknown/);
    });
  });

  describe("per-user active-conversation cap", () => {
    it("enforces on draft→active only", () => {
      setMaxActiveConvPerUserV2(2);
      registerConversationV2("c1", { userId: "u", model: "m" });
      registerConversationV2("c2", { userId: "u", model: "m" });
      registerConversationV2("c3", { userId: "u", model: "m" });
      activateConversationV2("c1");
      activateConversationV2("c2");
      expect(() => activateConversationV2("c3")).toThrow(
        /active-conversation cap/,
      );
    });
    it("recovery (paused→active) exempt", () => {
      setMaxActiveConvPerUserV2(2);
      registerConversationV2("c1", { userId: "u", model: "m" });
      registerConversationV2("c2", { userId: "u", model: "m" });
      activateConversationV2("c1");
      activateConversationV2("c2");
      pauseConversationV2("c1");
      activateConversationV2("c1");
      expect(getActiveConvCountV2("u")).toBe(2);
    });
  });

  describe("touchConversationV2", () => {
    it("updates lastSeenAt", () => {
      registerConversationV2("c1", { userId: "u", model: "m", now: 0 });
      const c = touchConversationV2("c1", { now: 999 });
      expect(c.lastSeenAt).toBe(999);
    });
    it("throws if not found", () => {
      expect(() => touchConversationV2("nope")).toThrow(/not found/);
    });
  });

  describe("createTurnV2", () => {
    beforeEach(() => registerConversationV2("c1", { userId: "u", model: "m" }));
    it("creates pending turn", () => {
      const t = createTurnV2("t1", { conversationId: "c1", now: 100 });
      expect(t.status).toBe("pending");
      expect(t.conversationId).toBe("c1");
      expect(t.role).toBe("user");
      expect(t.streamingStartedAt).toBeNull();
    });
    it("rejects bad inputs / duplicates", () => {
      expect(() => createTurnV2("")).toThrow();
      expect(() => createTurnV2("t1", {})).toThrow();
      createTurnV2("t1", { conversationId: "c1" });
      expect(() => createTurnV2("t1", { conversationId: "c1" })).toThrow();
    });
    it("enforces per-conversation pending-turn cap at create", () => {
      setMaxPendingTurnsPerConvV2(2);
      createTurnV2("t1", { conversationId: "c1" });
      createTurnV2("t2", { conversationId: "c1" });
      expect(() => createTurnV2("t3", { conversationId: "c1" })).toThrow(
        /pending-turn cap/,
      );
    });
    it("pending+streaming both count toward cap", () => {
      setMaxPendingTurnsPerConvV2(2);
      createTurnV2("t1", { conversationId: "c1" });
      createTurnV2("t2", { conversationId: "c1" });
      streamTurnV2("t1");
      // both pending+streaming = 2 = at cap
      expect(() => createTurnV2("t3", { conversationId: "c1" })).toThrow(
        /pending-turn cap/,
      );
      // settling t1 frees a slot
      completeTurnV2("t1");
      const t3 = createTurnV2("t3", { conversationId: "c1" });
      expect(t3.status).toBe("pending");
    });
  });

  describe("turn lifecycle", () => {
    beforeEach(() => {
      registerConversationV2("c1", { userId: "u", model: "m" });
      createTurnV2("t1", { conversationId: "c1", now: 0 });
    });
    it("pending → streaming stamps streamingStartedAt", () => {
      const t = streamTurnV2("t1", { now: 50 });
      expect(t.status).toBe("streaming");
      expect(t.streamingStartedAt).toBe(50);
    });
    it("terminal stamps settledAt", () => {
      streamTurnV2("t1", { now: 50 });
      const t = completeTurnV2("t1", { now: 100 });
      expect(t.settledAt).toBe(100);
    });
    it("cancelled from pending allowed", () => {
      const t = cancelTurnV2("t1", { now: 30 });
      expect(t.status).toBe("cancelled");
      expect(t.settledAt).toBe(30);
      expect(t.streamingStartedAt).toBeNull();
    });
    it("terminal sticks", () => {
      streamTurnV2("t1");
      completeTurnV2("t1");
      expect(() => failTurnV2("t1")).toThrow(/terminal/);
    });
    it("rejects illegal", () => {
      expect(() => completeTurnV2("t1")).toThrow(/cannot/);
      expect(() => setTurnStatusV2("t1", "bogus")).toThrow(/unknown/);
    });
  });

  describe("listConversationsV2 / listTurnsV2", () => {
    it("filters", () => {
      registerConversationV2("c1", { userId: "a", model: "m" });
      registerConversationV2("c2", { userId: "b", model: "m" });
      activateConversationV2("c1");
      expect(listConversationsV2({ userId: "a" })).toHaveLength(1);
      expect(listConversationsV2({ status: "active" })).toHaveLength(1);
      createTurnV2("t1", { conversationId: "c1" });
      streamTurnV2("t1");
      expect(listTurnsV2({ conversationId: "c1" })).toHaveLength(1);
      expect(listTurnsV2({ status: "streaming" })).toHaveLength(1);
    });
  });

  describe("autoArchiveIdleConversationsV2", () => {
    it("archives idle non-draft non-archived", () => {
      setConvIdleMsV2(100);
      registerConversationV2("c1", { userId: "u", model: "m", now: 0 });
      activateConversationV2("c1", { now: 0 });
      const flipped = autoArchiveIdleConversationsV2({ now: 200 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("archived");
      expect(flipped[0].archivedAt).toBe(200);
    });
    it("skips draft and archived", () => {
      setConvIdleMsV2(100);
      registerConversationV2("c1", { userId: "u", model: "m", now: 0 });
      const flipped = autoArchiveIdleConversationsV2({ now: 1000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckTurnsV2", () => {
    it("fails streaming turns past stuck threshold", () => {
      setTurnStuckMsV2(100);
      registerConversationV2("c1", { userId: "u", model: "m" });
      createTurnV2("t1", { conversationId: "c1", now: 0 });
      streamTurnV2("t1", { now: 0 });
      const flipped = autoFailStuckTurnsV2({ now: 200 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBe(200);
    });
    it("skips pending/terminal turns", () => {
      setTurnStuckMsV2(100);
      registerConversationV2("c1", { userId: "u", model: "m" });
      createTurnV2("t1", { conversationId: "c1", now: 0 });
      const flipped = autoFailStuckTurnsV2({ now: 1000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getSessionManagerStatsV2", () => {
    it("zero-init all enum keys", () => {
      const s = getSessionManagerStatsV2();
      expect(s.totalConversationsV2).toBe(0);
      expect(s.totalTurnsV2).toBe(0);
      expect(s.conversationsByStatus.draft).toBe(0);
      expect(s.conversationsByStatus.active).toBe(0);
      expect(s.conversationsByStatus.paused).toBe(0);
      expect(s.conversationsByStatus.archived).toBe(0);
      expect(s.turnsByStatus.pending).toBe(0);
      expect(s.turnsByStatus.streaming).toBe(0);
      expect(s.turnsByStatus.completed).toBe(0);
      expect(s.turnsByStatus.failed).toBe(0);
      expect(s.turnsByStatus.cancelled).toBe(0);
    });
    it("reflects live state", () => {
      registerConversationV2("c1", { userId: "u", model: "m" });
      activateConversationV2("c1");
      createTurnV2("t1", { conversationId: "c1" });
      streamTurnV2("t1");
      const s = getSessionManagerStatsV2();
      expect(s.conversationsByStatus.active).toBe(1);
      expect(s.turnsByStatus.streaming).toBe(1);
    });
  });

  describe("_resetStateSessionManagerV2", () => {
    it("clears state and restores defaults", () => {
      setMaxActiveConvPerUserV2(1);
      registerConversationV2("c1", { userId: "u", model: "m" });
      _resetStateSessionManagerV2();
      expect(getMaxActiveConvPerUserV2()).toBe(
        SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER,
      );
      expect(getConversationV2("c1")).toBeNull();
    });
  });
});
