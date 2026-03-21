import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all heavy dependencies before importing
vi.mock("../../src/lib/plan-mode.js", () => ({
  PlanModeManager: vi.fn(() => ({
    isActive: vi.fn(() => false),
    enterPlanMode: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
}));

vi.mock("../../src/lib/cli-context-engineering.js", () => ({
  CLIContextEngineering: vi.fn(() => ({
    setTask: vi.fn(),
    clearTask: vi.fn(),
    recordError: vi.fn(),
    getStats: vi.fn(() => ({})),
    smartCompact: vi.fn((msgs) => msgs.slice(0, 2)),
  })),
}));

vi.mock("../../src/lib/permanent-memory.js", () => ({
  CLIPermanentMemory: vi.fn(() => ({
    initialize: vi.fn(),
    autoSummarize: vi.fn(),
  })),
}));

vi.mock("../../src/lib/session-manager.js", () => ({
  createSession: vi.fn(),
  saveMessages: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(() => []),
}));

vi.mock("../../src/lib/agent-core.js", () => ({
  getBaseSystemPrompt: vi.fn(() => "You are a helpful assistant."),
  buildSystemPrompt: vi.fn(() => "You are a helpful assistant."),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import { WSSessionManager } from "../../src/lib/ws-session-manager.js";
import {
  createSession as dbCreateSession,
  saveMessages as dbSaveMessages,
  getSession as dbGetSession,
  listSessions as dbListSessions,
} from "../../src/lib/session-manager.js";
import fs from "fs";

describe("WSSessionManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
      exec: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    };
    manager = new WSSessionManager({ db: mockDb, config: { test: true } });
  });

  describe("constructor", () => {
    it("sets defaults when no options given", () => {
      const m = new WSSessionManager();
      expect(m.db).toBe(null);
      expect(m.config).toEqual({});
      expect(m.defaultProjectRoot).toBe(process.cwd());
      expect(m.sessions).toBeInstanceOf(Map);
      expect(m.sessions.size).toBe(0);
    });

    it("accepts db and config", () => {
      expect(manager.db).toBe(mockDb);
      expect(manager.config).toEqual({ test: true });
    });
  });

  describe("createSession", () => {
    it("returns an object with sessionId", () => {
      const result = manager.createSession();
      expect(result).toHaveProperty("sessionId");
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId).toMatch(/^ws-session-/);
    });

    it("creates agent type by default", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.type).toBe("agent");
    });

    it("creates chat type when specified", () => {
      const { sessionId } = manager.createSession({ type: "chat" });
      const session = manager.getSession(sessionId);
      expect(session.type).toBe("chat");
    });

    it("uses defaultProjectRoot when no projectRoot given", () => {
      manager.defaultProjectRoot = "/my/project";
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.projectRoot).toBe("/my/project");
    });

    it("rules.md is now loaded by buildSystemPrompt (session.rulesContent is null)", () => {
      const { sessionId } = manager.createSession({
        projectRoot: "/proj",
      });
      const session = manager.getSession(sessionId);
      // rules.md loading moved to buildSystemPrompt in agent-core.js
      expect(session.rulesContent).toBeNull();
    });

    it("creates plan manager per session", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.planManager).toBeDefined();
      expect(session.planManager.isActive).toBeDefined();
    });

    it("creates context engine", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.contextEngine).not.toBeNull();
    });

    it("persists to DB when db is available", () => {
      manager.createSession({ provider: "anthropic", model: "claude-3" });
      expect(dbCreateSession).toHaveBeenCalledTimes(1);
      expect(dbCreateSession).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-3",
        }),
      );
    });

    it("does not persist when db is null", () => {
      const m = new WSSessionManager();
      m.createSession();
      expect(dbCreateSession).not.toHaveBeenCalled();
    });

    it("uses config.llm as defaults for provider/model/baseUrl/apiKey", () => {
      const m = new WSSessionManager({
        config: {
          llm: {
            provider: "volcengine",
            model: "doubao-seed-1-6",
            baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
            apiKey: "test-key",
          },
        },
      });
      const { sessionId } = m.createSession();
      const session = m.getSession(sessionId);
      expect(session.provider).toBe("volcengine");
      expect(session.model).toBe("doubao-seed-1-6");
      expect(session.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
      expect(session.apiKey).toBe("test-key");
    });

    it("options override config.llm defaults", () => {
      const m = new WSSessionManager({
        config: {
          llm: { provider: "volcengine", model: "doubao-seed-1-6" },
        },
      });
      const { sessionId } = m.createSession({
        provider: "anthropic",
        model: "claude-3-5-haiku",
      });
      const session = m.getSession(sessionId);
      expect(session.provider).toBe("anthropic");
      expect(session.model).toBe("claude-3-5-haiku");
    });

    it("falls back to ollama when no config.llm set", () => {
      const m = new WSSessionManager({ config: {} });
      const { sessionId } = m.createSession();
      const session = m.getSession(sessionId);
      expect(session.provider).toBe("ollama");
      expect(session.model).toBe("qwen2.5:7b");
    });

    it("sets session status to active", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.status).toBe("active");
    });
  });

  describe("getSession", () => {
    it("returns session by id", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.id).toBe(sessionId);
    });

    it("returns null for unknown id", () => {
      const session = manager.getSession("nonexistent-id");
      expect(session).toBeNull();
    });
  });

  describe("resumeSession", () => {
    it("returns session from in-memory map", () => {
      const { sessionId } = manager.createSession();
      const session = manager.resumeSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.id).toBe(sessionId);
      expect(session.status).toBe("active");
    });

    it("loads session from DB when not in memory", () => {
      dbGetSession.mockReturnValue({
        id: "db-session-123",
        provider: "openai",
        model: "gpt-4",
        messages: JSON.stringify([{ role: "system", content: "hello" }]),
        created_at: "2026-01-01T00:00:00Z",
      });

      const session = manager.resumeSession("db-session-123");
      expect(session).not.toBeNull();
      expect(session.id).toBe("db-session-123");
      expect(session.provider).toBe("openai");
      expect(session.model).toBe("gpt-4");
      expect(session.messages).toEqual([{ role: "system", content: "hello" }]);
      expect(dbGetSession).toHaveBeenCalledWith(mockDb, "db-session-123");
    });

    it("returns null when not found in memory or DB", () => {
      dbGetSession.mockReturnValue(null);
      const session = manager.resumeSession("ghost-session");
      expect(session).toBeNull();
    });

    it("returns null when db is not available and session not in memory", () => {
      const m = new WSSessionManager();
      const session = m.resumeSession("no-db-session");
      expect(session).toBeNull();
    });
  });

  describe("closeSession", () => {
    it("removes session from map", () => {
      const { sessionId } = manager.createSession();
      expect(manager.getSession(sessionId)).not.toBeNull();
      manager.closeSession(sessionId);
      expect(manager.getSession(sessionId)).toBeNull();
    });

    it("persists messages to DB", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      session.messages.push({ role: "user", content: "hello" });
      manager.closeSession(sessionId);
      expect(dbSaveMessages).toHaveBeenCalledWith(
        mockDb,
        sessionId,
        expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "hello" }),
        ]),
      );
    });

    it("auto-summarizes when messages > 4 and permanentMemory exists", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      // Add enough messages to trigger summarize
      session.messages.push({ role: "user", content: "q1" });
      session.messages.push({ role: "assistant", content: "a1" });
      session.messages.push({ role: "user", content: "q2" });
      session.messages.push({ role: "assistant", content: "a2" });
      // Now messages.length > 4 (system + 4 = 5)
      manager.closeSession(sessionId);
      expect(session.permanentMemory.autoSummarize).toHaveBeenCalledWith(
        expect.any(Array),
      );
    });

    it("does nothing for unknown session", () => {
      // Should not throw
      manager.closeSession("unknown-id");
      expect(dbSaveMessages).not.toHaveBeenCalled();
    });
  });

  describe("listSessions", () => {
    it("returns in-memory sessions", () => {
      manager.createSession({ type: "agent" });
      manager.createSession({ type: "chat" });
      const sessions = manager.listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0]).toHaveProperty("id");
      expect(sessions[0]).toHaveProperty("type");
      expect(sessions[0]).toHaveProperty("status");
      expect(sessions[0]).toHaveProperty("messageCount");
    });

    it("includes DB sessions not already in memory", () => {
      dbListSessions.mockReturnValue([
        {
          id: "db-only-1",
          provider: "ollama",
          model: "qwen2.5:7b",
          message_count: 5,
          created_at: "2026-01-01",
          updated_at: "2026-01-02",
        },
      ]);
      const sessions = manager.listSessions();
      expect(sessions.some((s) => s.id === "db-only-1")).toBe(true);
    });
  });

  describe("persistMessages", () => {
    it("updates lastActivity after persisting", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      const before = session.lastActivity;

      // Small delay to ensure timestamp differs
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      manager.persistMessages(sessionId);
      vi.useRealTimers();

      expect(dbSaveMessages).toHaveBeenCalledWith(
        mockDb,
        sessionId,
        session.messages,
      );
    });

    it("does nothing for unknown session", () => {
      manager.persistMessages("ghost");
      expect(dbSaveMessages).not.toHaveBeenCalled();
    });
  });
});
