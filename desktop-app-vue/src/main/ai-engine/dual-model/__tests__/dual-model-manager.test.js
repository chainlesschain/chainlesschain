/**
 * DualModelManager unit tests -- v1.0.0
 *
 * Covers: initialization, startSession, nextTurn (alternation & approval),
 *         max-turns completion, endSession, listSessions, getHistory,
 *         configureRoles, error handling.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
const { DualModelManager, DEFAULT_CONFIG } = require("../dual-model-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

function createMockLLMManager(responseContent) {
  const defaultResponse = responseContent || "Mock LLM response";
  return {
    provider: "ollama",
    config: { model: "llama2" },
    switchProvider: vi.fn().mockResolvedValue(true),
    chat: vi.fn().mockResolvedValue({
      content: typeof defaultResponse === "function" ? defaultResponse() : defaultResponse,
      text: typeof defaultResponse === "function" ? defaultResponse() : defaultResponse,
    }),
  };
}

function createMockLLMManagerWithSequence(responses) {
  let callIndex = 0;
  const manager = {
    provider: "ollama",
    config: { model: "llama2" },
    switchProvider: vi.fn().mockResolvedValue(true),
    chat: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex] || responses[responses.length - 1];
      callIndex++;
      return { content: response, text: response };
    }),
  };
  return manager;
}

function makeSessionRow(overrides = {}) {
  return {
    id: "session-001",
    task: "Implement a REST API endpoint for user registration",
    status: "active",
    current_role: "editor",
    turn_number: 1,
    architect_config: JSON.stringify(DEFAULT_CONFIG.roles.architect),
    editor_config: JSON.stringify(DEFAULT_CONFIG.roles.editor),
    conversation_history: JSON.stringify([
      {
        role: "architect",
        content: "## Analysis\nNeed a POST /register endpoint...\n## Design\n...\n## Implementation Plan\n1. Create route...",
        turn: 1,
        timestamp: 1700000000000,
      },
    ]),
    final_output: null,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DualModelManager", () => {
  let manager;
  let db;
  let llmManager;

  beforeEach(() => {
    uuidCounter = 0;
    db = createMockDatabase();
    llmManager = createMockLLMManager("## Analysis\nTask analyzed.\n## Design\nDesign plan.\n## Implementation Plan\n1. Step one.");
    manager = new DualModelManager({ database: db, llmManager });
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create dual_model_sessions table and set initialized=true", async () => {
      await manager.initialize();

      expect(db.exec).toHaveBeenCalledOnce();
      const execCall = db.exec.mock.calls[0][0];
      expect(execCall).toContain("CREATE TABLE IF NOT EXISTS dual_model_sessions");
      expect(execCall).toContain("idx_dual_model_sessions_status");
      expect(execCall).toContain("idx_dual_model_sessions_created");
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await manager.initialize();
      await manager.initialize();

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should accept database parameter override", async () => {
      const otherDb = createMockDatabase();
      const freshManager = new DualModelManager({ llmManager });
      await freshManager.initialize(otherDb);

      expect(otherDb.exec).toHaveBeenCalledOnce();
      expect(freshManager.db).toBe(otherDb);
    });

    it("should handle missing database gracefully", async () => {
      const noDbManager = new DualModelManager({ llmManager });
      await noDbManager.initialize();
      expect(noDbManager.initialized).toBe(true);
    });

    it("should call saveToFile after table creation", async () => {
      await manager.initialize();
      expect(db.saveToFile).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // startSession
  // ─────────────────────────────────────────────────────────────────────────
  describe("startSession()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should create a session and call the architect model", async () => {
      const session = await manager.startSession("Build a user auth module");

      expect(session).toHaveProperty("id");
      expect(session.task).toBe("Build a user auth module");
      expect(session.status).toBe("active");
      expect(session.currentRole).toBe("editor");
      expect(session.turnNumber).toBe(1);
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0].role).toBe("architect");
    });

    it("should call llmManager.switchProvider with architect config", async () => {
      await manager.startSession("Build a module");

      expect(llmManager.switchProvider).toHaveBeenCalledWith(
        DEFAULT_CONFIG.roles.architect.provider,
        expect.objectContaining({
          model: DEFAULT_CONFIG.roles.architect.model,
          temperature: DEFAULT_CONFIG.roles.architect.temperature,
        })
      );
    });

    it("should call llmManager.chat with system prompt and task", async () => {
      await manager.startSession("Build a module");

      expect(llmManager.chat).toHaveBeenCalledOnce();
      const [messages] = llmManager.chat.mock.calls[0];
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("Architect");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Build a module");
    });

    it("should save the session to the database", async () => {
      await manager.startSession("Build a module");

      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO dual_model_sessions"),
        expect.any(String), // id
        "Build a module",   // task
        "active",           // status
        "editor",           // current_role
        1,                  // turn_number
        expect.any(String), // architect_config
        expect.any(String), // editor_config
        expect.any(String), // conversation_history
        null,               // final_output
        expect.any(Number), // created_at
        expect.any(Number)  // updated_at
      );
    });

    it("should emit session:started and turn:completed events", async () => {
      const startedSpy = vi.fn();
      const turnSpy = vi.fn();
      manager.on("session:started", startedSpy);
      manager.on("turn:completed", turnSpy);

      await manager.startSession("Build a module");

      expect(startedSpy).toHaveBeenCalledOnce();
      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ task: "Build a module" })
      );
      expect(turnSpy).toHaveBeenCalledOnce();
      expect(turnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: "architect", turn: 1 })
      );
    });

    it("should throw when task is empty", async () => {
      await expect(manager.startSession("")).rejects.toThrow("Task description is required");
      await expect(manager.startSession(null)).rejects.toThrow("Task description is required");
      await expect(manager.startSession("   ")).rejects.toThrow("Task description is required");
    });

    it("should apply per-session config overrides", async () => {
      await manager.startSession("Build a module", {
        architect: { model: "custom-architect-model", temperature: 0.5 },
      });

      expect(llmManager.switchProvider).toHaveBeenCalledWith(
        DEFAULT_CONFIG.roles.architect.provider,
        expect.objectContaining({
          model: "custom-architect-model",
          temperature: 0.5,
        })
      );
    });

    it("should mark session as failed if architect call throws", async () => {
      const failingLLM = createMockLLMManager("response");
      failingLLM.chat.mockRejectedValueOnce(new Error("API timeout"));
      const failManager = new DualModelManager({ database: db, llmManager: failingLLM });
      await failManager.initialize();

      const failedSpy = vi.fn();
      failManager.on("session:failed", failedSpy);

      await expect(failManager.startSession("Failing task")).rejects.toThrow("API timeout");
      expect(failedSpy).toHaveBeenCalledOnce();
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE"),
        expect.any(String),
        "Failing task",
        "failed",
        expect.any(String),
        expect.any(Number),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(Number)
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // nextTurn — alternation between architect and editor
  // ─────────────────────────────────────────────────────────────────────────
  describe("nextTurn() - role alternation", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should advance from editor to architect after editor turn", async () => {
      // Setup: session with current_role = editor (after architect's initial plan)
      const row = makeSessionRow({ current_role: "editor", turn_number: 1 });
      db._prep.get.mockReturnValueOnce(row);

      // Editor responds with code
      llmManager.chat.mockResolvedValueOnce({
        content: "```js\nfunction register(user) { return db.save(user); }\n```",
        text: "```js\nfunction register(user) { return db.save(user); }\n```",
      });

      const session = await manager.nextTurn("session-001");

      expect(session.currentRole).toBe("architect");
      expect(session.turnNumber).toBe(2);
      expect(session.status).toBe("active");
    });

    it("should advance from architect to editor after architect review (NEEDS_CHANGES)", async () => {
      const history = [
        { role: "architect", content: "## Implementation Plan\n...", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "function register() {}", turn: 2, timestamp: 1700000001000 },
      ];
      const row = makeSessionRow({
        current_role: "architect",
        turn_number: 2,
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      // Architect responds with NEEDS_CHANGES
      llmManager.chat.mockResolvedValueOnce({
        content: "## Review\nMissing error handling.\n## Verdict\nNEEDS_CHANGES\n- Add try/catch",
        text: "## Review\nMissing error handling.\n## Verdict\nNEEDS_CHANGES\n- Add try/catch",
      });

      const session = await manager.nextTurn("session-001");

      expect(session.currentRole).toBe("editor");
      expect(session.turnNumber).toBe(3);
      expect(session.status).toBe("active");
    });

    it("should call llmManager.switchProvider with the correct role config", async () => {
      const row = makeSessionRow({ current_role: "editor", turn_number: 1 });
      db._prep.get.mockReturnValueOnce(row);

      llmManager.chat.mockResolvedValueOnce({
        content: "Implementation code here",
        text: "Implementation code here",
      });

      await manager.nextTurn("session-001");

      // Editor turn: should switch to editor provider
      expect(llmManager.switchProvider).toHaveBeenCalledWith(
        DEFAULT_CONFIG.roles.editor.provider,
        expect.objectContaining({
          model: DEFAULT_CONFIG.roles.editor.model,
        })
      );
    });

    it("should emit turn:completed event", async () => {
      const row = makeSessionRow({ current_role: "editor", turn_number: 1 });
      db._prep.get.mockReturnValueOnce(row);

      llmManager.chat.mockResolvedValueOnce({
        content: "Code implementation",
        text: "Code implementation",
      });

      const turnSpy = vi.fn();
      manager.on("turn:completed", turnSpy);

      await manager.nextTurn("session-001");

      expect(turnSpy).toHaveBeenCalledOnce();
      expect(turnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-001", role: "editor", turn: 2 })
      );
    });

    it("should throw for non-existent session", async () => {
      db._prep.get.mockReturnValueOnce(null);
      await expect(manager.nextTurn("nonexistent")).rejects.toThrow("Session not found: nonexistent");
    });

    it("should throw for already completed session", async () => {
      const row = makeSessionRow({ status: "completed" });
      db._prep.get.mockReturnValueOnce(row);
      await expect(manager.nextTurn("session-001")).rejects.toThrow("already completed");
    });

    it("should throw for cancelled session", async () => {
      const row = makeSessionRow({ status: "cancelled" });
      db._prep.get.mockReturnValueOnce(row);
      await expect(manager.nextTurn("session-001")).rejects.toThrow("already cancelled");
    });

    it("should throw for failed session", async () => {
      const row = makeSessionRow({ status: "failed" });
      db._prep.get.mockReturnValueOnce(row);
      await expect(manager.nextTurn("session-001")).rejects.toThrow("already failed");
    });

    it("should mark session as failed on LLM call error", async () => {
      const row = makeSessionRow({ current_role: "editor", turn_number: 1 });
      db._prep.get.mockReturnValueOnce(row);

      llmManager.chat.mockRejectedValueOnce(new Error("Model unavailable"));

      const failSpy = vi.fn();
      manager.on("session:failed", failSpy);

      await expect(manager.nextTurn("session-001")).rejects.toThrow("Model unavailable");
      expect(failSpy).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // nextTurn — session completion on APPROVED
  // ─────────────────────────────────────────────────────────────────────────
  describe("nextTurn() - architect approval", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should complete session when architect response contains APPROVED", async () => {
      const history = [
        { role: "architect", content: "## Plan\n...", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "function register() { try { db.save(user); } catch(e) { throw e; } }", turn: 2, timestamp: 1700000001000 },
      ];
      const row = makeSessionRow({
        current_role: "architect",
        turn_number: 2,
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      llmManager.chat.mockResolvedValueOnce({
        content: "## Review\nExcellent implementation with proper error handling.\n## Verdict\nAPPROVED",
        text: "## Review\nExcellent implementation with proper error handling.\n## Verdict\nAPPROVED",
      });

      const completedSpy = vi.fn();
      manager.on("session:completed", completedSpy);

      const session = await manager.nextTurn("session-001");

      expect(session.status).toBe("completed");
      expect(session.finalOutput).toBeTruthy();
      expect(completedSpy).toHaveBeenCalledOnce();
      expect(completedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "approved" })
      );
    });

    it("should NOT approve if response contains NEEDS_CHANGES alongside APPROVED", async () => {
      const history = [
        { role: "architect", content: "## Plan\n...", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "some code", turn: 2, timestamp: 1700000001000 },
      ];
      const row = makeSessionRow({
        current_role: "architect",
        turn_number: 2,
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      llmManager.chat.mockResolvedValueOnce({
        content: "## Review\nPartially good. APPROVED in concept but NEEDS_CHANGES in details.",
        text: "## Review\nPartially good. APPROVED in concept but NEEDS_CHANGES in details.",
      });

      const session = await manager.nextTurn("session-001");

      expect(session.status).toBe("active");
      expect(session.currentRole).toBe("editor");
    });

    it("should set finalOutput to the last editor message on approval", async () => {
      const editorCode = "function register(user) { return db.insert(user); }";
      const history = [
        { role: "architect", content: "## Plan", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: editorCode, turn: 2, timestamp: 1700000001000 },
      ];
      const row = makeSessionRow({
        current_role: "architect",
        turn_number: 2,
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      llmManager.chat.mockResolvedValueOnce({
        content: "## Verdict\nAPPROVED",
        text: "## Verdict\nAPPROVED",
      });

      const session = await manager.nextTurn("session-001");

      expect(session.finalOutput).toBe(editorCode);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // nextTurn — max turns reached
  // ─────────────────────────────────────────────────────────────────────────
  describe("nextTurn() - max turns", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should complete session when max turns is reached", async () => {
      const maxTurns = 3;
      manager.config.maxTurnsPerSession = maxTurns;

      const history = [
        { role: "architect", content: "Plan", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "Code v1", turn: 2, timestamp: 1700000001000 },
        { role: "architect", content: "NEEDS_CHANGES", turn: 3, timestamp: 1700000002000 },
      ];
      const row = makeSessionRow({
        current_role: "editor",
        turn_number: 3,
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      const completedSpy = vi.fn();
      manager.on("session:completed", completedSpy);

      const session = await manager.nextTurn("session-001");

      expect(session.status).toBe("completed");
      expect(completedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "max_turns_reached" })
      );
    });

    it("should set finalOutput from last editor message on max turns", async () => {
      manager.config.maxTurnsPerSession = 2;

      const history = [
        { role: "architect", content: "Plan", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "Final code output", turn: 2, timestamp: 1700000001000 },
      ];
      const row = makeSessionRow({
        current_role: "architect",
        turn_number: 2,
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      const session = await manager.nextTurn("session-001");

      expect(session.finalOutput).toBe("Final code output");
    });

    it("should not call LLM when max turns exceeded", async () => {
      manager.config.maxTurnsPerSession = 1;

      const row = makeSessionRow({
        current_role: "editor",
        turn_number: 1,
        conversation_history: JSON.stringify([
          { role: "architect", content: "Plan", turn: 1, timestamp: 1700000000000 },
        ]),
      });
      db._prep.get.mockReturnValueOnce(row);

      await manager.nextTurn("session-001");

      expect(llmManager.chat).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getState
  // ─────────────────────────────────────────────────────────────────────────
  describe("getState()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return session state for existing session", () => {
      const row = makeSessionRow();
      db._prep.get.mockReturnValueOnce(row);

      const state = manager.getState("session-001");

      expect(state).toBeTruthy();
      expect(state.id).toBe("session-001");
      expect(state.status).toBe("active");
      expect(state.task).toBe("Implement a REST API endpoint for user registration");
    });

    it("should return null for non-existent session", () => {
      db._prep.get.mockReturnValueOnce(null);

      const state = manager.getState("nonexistent");
      expect(state).toBeNull();
    });

    it("should include conversationHistory in the returned state", () => {
      const row = makeSessionRow();
      db._prep.get.mockReturnValueOnce(row);

      const state = manager.getState("session-001");

      expect(state.conversationHistory).toHaveLength(1);
      expect(state.conversationHistory[0].role).toBe("architect");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // endSession
  // ─────────────────────────────────────────────────────────────────────────
  describe("endSession()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should mark active session as cancelled", () => {
      const row = makeSessionRow({ status: "active" });
      db._prep.get.mockReturnValueOnce(row);

      const cancelledSpy = vi.fn();
      manager.on("session:cancelled", cancelledSpy);

      const session = manager.endSession("session-001");

      expect(session.status).toBe("cancelled");
      expect(cancelledSpy).toHaveBeenCalledOnce();
    });

    it("should be idempotent for already completed sessions", () => {
      const row = makeSessionRow({ status: "completed", final_output: "some code" });
      db._prep.get.mockReturnValueOnce(row);

      const session = manager.endSession("session-001");
      expect(session.status).toBe("completed");
    });

    it("should be idempotent for already cancelled sessions", () => {
      const row = makeSessionRow({ status: "cancelled" });
      db._prep.get.mockReturnValueOnce(row);

      const session = manager.endSession("session-001");
      expect(session.status).toBe("cancelled");
    });

    it("should throw for non-existent session", () => {
      db._prep.get.mockReturnValueOnce(null);
      expect(() => manager.endSession("nonexistent")).toThrow("Session not found");
    });

    it("should extract final output from conversation history", () => {
      const history = [
        { role: "architect", content: "Plan", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "Final implementation", turn: 2, timestamp: 1700000001000 },
      ];
      const row = makeSessionRow({
        status: "active",
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      const session = manager.endSession("session-001");
      expect(session.finalOutput).toBe("Final implementation");
    });

    it("should save the updated session to database", () => {
      const row = makeSessionRow({ status: "active" });
      db._prep.get.mockReturnValueOnce(row);

      manager.endSession("session-001");

      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE"),
        expect.any(String),
        expect.any(String),
        "cancelled",
        expect.any(String),
        expect.any(Number),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(Number)
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // listSessions
  // ─────────────────────────────────────────────────────────────────────────
  describe("listSessions()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return empty list when no sessions exist", () => {
      db._prep.get.mockReturnValueOnce({ count: 0 });
      db._prep.all.mockReturnValueOnce([]);

      const result = manager.listSessions();

      expect(result.sessions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should return sessions with total count", () => {
      const rows = [makeSessionRow(), makeSessionRow({ id: "session-002", task: "Second task" })];
      db._prep.get.mockReturnValueOnce({ count: 2 });
      db._prep.all.mockReturnValueOnce(rows);

      const result = manager.listSessions();

      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should apply limit and offset parameters", () => {
      db._prep.get.mockReturnValueOnce({ count: 10 });
      db._prep.all.mockReturnValueOnce([makeSessionRow()]);

      const result = manager.listSessions({ limit: 5, offset: 5 });

      expect(db.prepare).toHaveBeenCalled();
      expect(result.sessions).toHaveLength(1);
    });

    it("should filter by status when provided", () => {
      db._prep.get.mockReturnValueOnce({ count: 3 });
      db._prep.all.mockReturnValueOnce([
        makeSessionRow({ status: "completed" }),
      ]);

      const result = manager.listSessions({ status: "completed" });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].status).toBe("completed");
    });

    it("should return empty result when database is null", () => {
      const noDbManager = new DualModelManager({ llmManager });
      noDbManager.initialized = true;

      const result = noDbManager.listSessions();
      expect(result.sessions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle database errors gracefully", () => {
      db.prepare.mockImplementationOnce(() => { throw new Error("DB error"); });

      const result = manager.listSessions();
      expect(result.sessions).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getHistory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getHistory()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return full conversation history for a session", () => {
      const history = [
        { role: "architect", content: "Plan", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "Code", turn: 2, timestamp: 1700000001000 },
        { role: "architect", content: "Review: APPROVED", turn: 3, timestamp: 1700000002000 },
      ];
      const row = makeSessionRow({
        conversation_history: JSON.stringify(history),
      });
      db._prep.get.mockReturnValueOnce(row);

      const result = manager.getHistory("session-001");

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe("architect");
      expect(result[1].role).toBe("editor");
      expect(result[2].role).toBe("architect");
    });

    it("should throw for non-existent session", () => {
      db._prep.get.mockReturnValueOnce(null);
      expect(() => manager.getHistory("nonexistent")).toThrow("Session not found");
    });

    it("should return empty array for session with no history", () => {
      const row = makeSessionRow({ conversation_history: "[]" });
      db._prep.get.mockReturnValueOnce(row);

      const result = manager.getHistory("session-001");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // configureRoles
  // ─────────────────────────────────────────────────────────────────────────
  describe("configureRoles()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update architect configuration", () => {
      const result = manager.configureRoles({
        architect: { model: "gpt-4o", provider: "openai", temperature: 0.1 },
      });

      expect(result.roles.architect.model).toBe("gpt-4o");
      expect(result.roles.architect.provider).toBe("openai");
      expect(result.roles.architect.temperature).toBe(0.1);
      // Editor should remain unchanged
      expect(result.roles.editor.model).toBe(DEFAULT_CONFIG.roles.editor.model);
    });

    it("should update editor configuration", () => {
      const result = manager.configureRoles({
        editor: { model: "codestral", provider: "mistral" },
      });

      expect(result.roles.editor.model).toBe("codestral");
      expect(result.roles.editor.provider).toBe("mistral");
      // Architect should remain unchanged
      expect(result.roles.architect.model).toBe(DEFAULT_CONFIG.roles.architect.model);
    });

    it("should update both roles simultaneously", () => {
      const result = manager.configureRoles({
        architect: { model: "new-architect" },
        editor: { model: "new-editor" },
      });

      expect(result.roles.architect.model).toBe("new-architect");
      expect(result.roles.editor.model).toBe("new-editor");
    });

    it("should update maxTurnsPerSession", () => {
      const result = manager.configureRoles({ maxTurnsPerSession: 20 });
      expect(result.maxTurnsPerSession).toBe(20);
    });

    it("should ignore invalid maxTurnsPerSession values", () => {
      const result = manager.configureRoles({ maxTurnsPerSession: -1 });
      expect(result.maxTurnsPerSession).toBe(DEFAULT_CONFIG.maxTurnsPerSession);

      const result2 = manager.configureRoles({ maxTurnsPerSession: "abc" });
      expect(result2.maxTurnsPerSession).toBe(DEFAULT_CONFIG.maxTurnsPerSession);
    });

    it("should throw when config is not an object", () => {
      expect(() => manager.configureRoles(null)).toThrow("Configuration object is required");
      expect(() => manager.configureRoles("invalid")).toThrow("Configuration object is required");
    });

    it("should emit config:updated event", () => {
      const configSpy = vi.fn();
      manager.on("config:updated", configSpy);

      manager.configureRoles({ architect: { model: "new-model" } });

      expect(configSpy).toHaveBeenCalledOnce();
    });

    it("should preserve existing config fields not overridden", () => {
      const originalSystemPrompt = manager.config.roles.architect.systemPrompt;

      manager.configureRoles({ architect: { model: "new-model" } });

      expect(manager.config.roles.architect.systemPrompt).toBe(originalSystemPrompt);
      expect(manager.config.roles.architect.model).toBe("new-model");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _checkApproval (internal)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_checkApproval()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return true when response contains APPROVED", () => {
      expect(manager._checkApproval("## Verdict\nAPPROVED")).toBe(true);
    });

    it("should return true for case-insensitive APPROVED", () => {
      expect(manager._checkApproval("## Verdict\nApproved")).toBe(true);
    });

    it("should return false when response contains NEEDS_CHANGES", () => {
      expect(manager._checkApproval("## Verdict\nNEEDS_CHANGES")).toBe(false);
    });

    it("should return false when response contains both APPROVED and NEEDS_CHANGES", () => {
      expect(manager._checkApproval("APPROVED in concept but NEEDS_CHANGES in details")).toBe(false);
    });

    it("should return false for null or undefined response", () => {
      expect(manager._checkApproval(null)).toBe(false);
      expect(manager._checkApproval(undefined)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(manager._checkApproval("")).toBe(false);
    });

    it("should return false for non-string input", () => {
      expect(manager._checkApproval(123)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _extractFinalOutput (internal)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_extractFinalOutput()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return last editor message content", () => {
      const history = [
        { role: "architect", content: "Plan", turn: 1 },
        { role: "editor", content: "First code", turn: 2 },
        { role: "architect", content: "Needs changes", turn: 3 },
        { role: "editor", content: "Final code", turn: 4 },
      ];
      expect(manager._extractFinalOutput(history)).toBe("Final code");
    });

    it("should return last message when no editor messages exist", () => {
      const history = [
        { role: "architect", content: "Only architect message", turn: 1 },
      ];
      expect(manager._extractFinalOutput(history)).toBe("Only architect message");
    });

    it("should return null for empty history", () => {
      expect(manager._extractFinalOutput([])).toBeNull();
    });

    it("should return null for null/undefined history", () => {
      expect(manager._extractFinalOutput(null)).toBeNull();
      expect(manager._extractFinalOutput(undefined)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _buildMessagesForRole (internal)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_buildMessagesForRole()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should build editor messages with task and architect context", () => {
      const history = [
        { role: "architect", content: "Design plan here", turn: 1, timestamp: 1700000000000 },
      ];
      const messages = manager._buildMessagesForRole("editor", history, "Build a module");

      expect(messages[0].content).toContain("Build a module");
      // Should include architect's message as context
      const architectMsg = messages.find((m) => m.content && m.content.includes("Design plan here"));
      expect(architectMsg).toBeTruthy();
      // Should end with implementation instruction
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.content).toContain("implement");
    });

    it("should build architect review messages with editor implementation", () => {
      const history = [
        { role: "architect", content: "Plan", turn: 1, timestamp: 1700000000000 },
        { role: "editor", content: "function hello() {}", turn: 2, timestamp: 1700000001000 },
      ];
      const messages = manager._buildMessagesForRole("architect", history, "Build a module");

      expect(messages[0].content).toContain("Build a module");
      // Should include editor's code
      const editorMsg = messages.find((m) => m.content && m.content.includes("function hello()"));
      expect(editorMsg).toBeTruthy();
      // Should end with review instruction
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.content).toContain("review");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should accept database and llmManager via constructor", () => {
      const m = new DualModelManager({ database: db, llmManager });
      expect(m.db).toBe(db);
      expect(m.llmManager).toBe(llmManager);
    });

    it("should work with no arguments", () => {
      const m = new DualModelManager();
      expect(m.db).toBeNull();
      expect(m.llmManager).toBeNull();
      expect(m.initialized).toBe(false);
    });

    it("should use default config", () => {
      const m = new DualModelManager();
      expect(m.config.maxTurnsPerSession).toBe(10);
      expect(m.config.roles.architect.provider).toBe("anthropic");
      expect(m.config.roles.editor.provider).toBe("deepseek");
    });

    it("should be an EventEmitter", () => {
      const m = new DualModelManager();
      expect(typeof m.on).toBe("function");
      expect(typeof m.emit).toBe("function");
    });
  });
});
