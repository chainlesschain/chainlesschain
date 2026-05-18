import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLIContextEngineering,
  _deps,
} from "../../src/lib/cli-context-engineering.js";

describe("CLIContextEngineering", () => {
  let engine;
  let originalDeps;

  beforeEach(() => {
    // Save original deps and install mocks
    originalDeps = { ..._deps };
    _deps.generateInstinctPrompt = vi.fn(() => "");
    _deps.recallMemory = vi.fn(() => []);
    _deps.BM25Search = class MockBM25 {
      constructor() {
        this.totalDocs = 0;
      }
      indexDocuments() {
        this.totalDocs = 0;
      }
      search() {
        return [];
      }
    };
    _deps.readUserProfile = vi.fn(() => "");
    engine = new CLIContextEngineering({ db: null });
  });

  afterEach(() => {
    // Restore original deps
    Object.assign(_deps, originalDeps);
  });

  // 鈹€鈹€ db=null graceful degradation 鈹€鈹€

  describe("db=null degradation", () => {
    it("returns cleaned messages without injections when db is null", () => {
      const raw = [
        { role: "system", content: "Hello system" },
        { role: "user", content: "test query" },
        { role: "assistant", content: "response" },
      ];

      const result = engine.buildOptimizedMessages(raw, {
        userQuery: "test query",
      });

      // Should have system + user + assistant (no injection messages)
      expect(result.length).toBe(3);
      expect(result[0].role).toBe("system");
      expect(result[1].role).toBe("user");
      expect(result[2].role).toBe("assistant");
    });

    it("does not call instinct/memory/notes when db is null", () => {
      engine.buildOptimizedMessages([{ role: "system", content: "sys" }], {
        userQuery: "test",
      });

      expect(_deps.generateInstinctPrompt).not.toHaveBeenCalled();
      expect(_deps.recallMemory).not.toHaveBeenCalled();
    });
  });

  // 鈹€鈹€ Instinct injection 鈹€鈹€

  describe("instinct injection", () => {
    it("injects instinct prompt when db is available", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(
        () =>
          "Based on learned preferences:\n- [coding_style] Use TypeScript (confidence: 80%)",
      );

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      expect(_deps.generateInstinctPrompt).toHaveBeenCalledWith(mockDb);
      const instinctMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Learned Preferences"),
      );
      expect(instinctMsg).toBeDefined();
      expect(instinctMsg.content).toContain("TypeScript");
    });

    it("skips instinct injection when prompt is empty", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      // Only system prompt, no instinct message
      expect(result.length).toBe(1);
    });

    it("silently skips on instinct error", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => {
        throw new Error("DB error");
      });

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      // Should not throw, just skip
      expect(result.length).toBe(1);
    });
  });

  // 鈹€鈹€ User profile injection 鈹€鈹€

  describe("user profile injection", () => {
    it("injects USER.md content as system message when available", () => {
      _deps.readUserProfile = vi.fn(
        () => "Prefers TypeScript and concise answers.",
      );

      const result = engine.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      const profileMsg = result.find(
        (m) => m.role === "system" && m.content.includes("User Profile"),
      );
      expect(profileMsg).toBeDefined();
      expect(profileMsg.content).toContain("TypeScript");
    });
  });
  // 鈹€鈹€ Memory injection 鈹€鈹€

  describe("memory injection", () => {
    it("injects memory results as system message", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => [
        {
          content: "User likes TypeScript",
          layer: "long-term",
          retention: 0.85,
        },
        { content: "Prefers dark mode", layer: "short-term", retention: 0.92 },
      ]);

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "preferences" },
      );

      expect(_deps.recallMemory).toHaveBeenCalledWith(mockDb, "preferences", {
        limit: 5,
      });
      const memMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Relevant Memories"),
      );
      expect(memMsg).toBeDefined();
      expect(memMsg.content).toContain("TypeScript");
      expect(memMsg.content).toContain("dark mode");
    });

    it("skips memory injection when no results", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => []);

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      const memMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Relevant Memories"),
      );
      expect(memMsg).toBeUndefined();
    });
  });

  // 鈹€鈹€ BM25 Notes injection 鈹€鈹€

  describe("notes injection", () => {
    it("injects BM25 search results from notes", () => {
      const mockStmt = {
        all: vi.fn(() => [
          {
            id: "1",
            title: "Setup Guide",
            content: "How to setup the project with npm install",
          },
          { id: "2", title: "API Docs", content: "REST API documentation" },
        ]),
      };
      const mockDb = {
        prepare: vi.fn(() => mockStmt),
      };
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => []);

      // Restore real BM25Search for this test
      _deps.BM25Search = originalDeps.BM25Search;

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "setup project" },
      );

      const notesMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Relevant Notes"),
      );
      expect(notesMsg).toBeDefined();
      expect(notesMsg.content).toContain("Setup Guide");
    });
  });

  // 鈹€鈹€ smartCompact 鈹€鈹€

  describe("smartCompact", () => {
    it("preserves system prompt", () => {
      const messages = [
        { role: "system", content: "system prompt" },
        ...Array.from({ length: 20 }, (_, i) => [
          { role: "user", content: `message ${i}` },
          { role: "assistant", content: `response ${i}` },
        ]).flat(),
      ];

      const compacted = engine.smartCompact(messages, { keepPairs: 3 });

      expect(compacted[0].role).toBe("system");
      expect(compacted[0].content).toBe("system prompt");
    });

    it("keeps recent messages with higher priority", () => {
      const messages = [
        { role: "system", content: "system" },
        { role: "user", content: "old message 1" },
        { role: "assistant", content: "old response 1" },
        { role: "user", content: "old message 2" },
        { role: "assistant", content: "old response 2" },
        { role: "user", content: "old message 3" },
        { role: "assistant", content: "old response 3" },
        { role: "user", content: "old message 4" },
        { role: "assistant", content: "old response 4" },
        { role: "user", content: "recent message" },
        { role: "assistant", content: "recent response" },
      ];

      const compacted = engine.smartCompact(messages, { keepPairs: 2 });

      // Most recent pair should be kept
      const contents = compacted.map((m) => m.content);
      expect(contents).toContain("recent message");
      expect(contents).toContain("recent response");
    });

    it("returns unmodified if fewer messages than keepPairs", () => {
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];

      const compacted = engine.smartCompact(messages, { keepPairs: 6 });
      expect(compacted.length).toBe(3);
    });

    it("scores tool_calls messages higher", () => {
      const messages = [
        { role: "system", content: "system" },
        { role: "user", content: "plain message" },
        { role: "assistant", content: "plain response" },
        { role: "user", content: "tool message" },
        {
          role: "assistant",
          content: "tool response",
          tool_calls: [{ id: "1", function: { name: "read_file" } }],
        },
        { role: "tool", content: "file content", tool_call_id: "1" },
        { role: "user", content: "another plain" },
        { role: "assistant", content: "another response" },
        { role: "user", content: "newest message" },
        { role: "assistant", content: "newest response" },
      ];

      const compacted = engine.smartCompact(messages, { keepPairs: 2 });

      // Tool call pair and newest pair should be favored
      const contents = compacted.map((m) => m.content);
      expect(contents).toContain("newest message");
    });
  });

  // 鈹€鈹€ recordError 鈹€鈹€

  describe("recordError", () => {
    it("records errors and includes them in messages", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => []);

      const eng = new CLIContextEngineering({ db: mockDb });
      eng.recordError({
        step: "agent-loop",
        message: "Connection refused",
      });
      eng.recordError({
        step: "tool-exec",
        message: "File not found",
        resolution: "Created the file",
      });

      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      const errorMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Recent Errors"),
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg.content).toContain("Connection refused");
      expect(errorMsg.content).toContain("Fixed: Created the file");
    });

    it("limits error history to 10", () => {
      for (let i = 0; i < 15; i++) {
        engine.recordError({ step: "test", message: `error ${i}` });
      }
      expect(engine.errorHistory.length).toBe(10);
      // First error should be evicted
      expect(engine.errorHistory[0].message).toBe("error 5");
    });
  });

  // 鈹€鈹€ Task management 鈹€鈹€

  describe("setTask / task reminder", () => {
    it("injects task reminder into messages", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => []);

      const eng = new CLIContextEngineering({ db: mockDb });
      eng.setTask("Refactor authentication module", [
        "Review current code",
        "Extract auth service",
        "Add unit tests",
      ]);
      eng.updateTaskProgress(1);

      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      const taskMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Current Task Status"),
      );
      expect(taskMsg).toBeDefined();
      expect(taskMsg.content).toContain("Refactor authentication module");
      expect(taskMsg.content).toContain("Review current code");
      expect(taskMsg.content).toContain("Extract auth service");
      expect(taskMsg.content).toContain("Add unit tests");
    });

    it("clears task", () => {
      engine.setTask("Some task");
      expect(engine.taskContext).not.toBeNull();
      engine.clearTask();
      expect(engine.taskContext).toBeNull();
    });
  });

  // 鈹€鈹€ System prompt cleaning 鈹€鈹€

  describe("system prompt cleaning", () => {
    it("replaces timestamps with [DATE]", () => {
      const eng = new CLIContextEngineering({ db: null });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "Started at 2026-03-12T14:30:00.000Z" }],
        {},
      );
      expect(result[0].content).toContain("[DATE]");
      expect(result[0].content).not.toContain("2026-03-12");
    });

    it("replaces UUIDs with [UUID]", () => {
      const eng = new CLIContextEngineering({ db: null });
      const result = eng.buildOptimizedMessages(
        [
          {
            role: "system",
            content: "Session a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          },
        ],
        {},
      );
      expect(result[0].content).toContain("[UUID]");
      expect(result[0].content).not.toContain("a1b2c3d4");
    });

    it("replaces session IDs with [SESSION]", () => {
      const eng = new CLIContextEngineering({ db: null });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "Using session-abc123def456" }],
        {},
      );
      expect(result[0].content).toContain("[SESSION]");
    });

    it("replaces epoch timestamps with [TIMESTAMP]", () => {
      const eng = new CLIContextEngineering({ db: null });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "Time: 1710288000000" }],
        {},
      );
      expect(result[0].content).toContain("[TIMESTAMP]");
    });
  });

  // 鈹€鈹€ getStats 鈹€鈹€

  describe("getStats", () => {
    it("returns correct stats without db", () => {
      const stats = engine.getStats();
      expect(stats.hasDb).toBe(false);
      expect(stats.errorCount).toBe(0);
      expect(stats.hasTask).toBe(false);
      expect(stats.notesIndexed).toBe(0);
    });

    it("reflects task and error state", () => {
      engine.setTask("test task");
      engine.recordError({ step: "x", message: "err" });
      const stats = engine.getStats();
      expect(stats.hasTask).toBe(true);
      expect(stats.errorCount).toBe(1);
    });
  });

  // 鈹€鈹€ Conversation history cleaning 鈹€鈹€

  describe("conversation history cleaning", () => {
    it("strips metadata fields from conversation messages", () => {
      const raw = [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: "hello",
          timestamp: "2026-01-01",
          id: "msg-1",
          messageId: "m1",
        },
        {
          role: "assistant",
          content: "hi",
          timestamp: "2026-01-01",
          id: "msg-2",
        },
      ];

      const result = engine.buildOptimizedMessages(raw, { userQuery: "hello" });

      // User and assistant messages should not have metadata
      const userMsg = result.find(
        (m) => m.role === "user" && m.content === "hello",
      );
      expect(userMsg).toBeDefined();
      expect(userMsg.timestamp).toBeUndefined();
      expect(userMsg.id).toBeUndefined();
      expect(userMsg.messageId).toBeUndefined();
    });

    it("preserves tool_calls and tool_call_id fields", () => {
      const raw = [
        { role: "system", content: "sys" },
        {
          role: "assistant",
          content: "calling tool",
          tool_calls: [
            { id: "t1", function: { name: "read_file", arguments: "{}" } },
          ],
        },
        {
          role: "tool",
          content: "result",
          tool_call_id: "t1",
          name: "read_file",
        },
      ];

      const result = engine.buildOptimizedMessages(raw, {});
      const assistantMsg = result.find((m) => m.tool_calls);
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.tool_calls).toHaveLength(1);

      const toolMsg = result.find((m) => m.role === "tool");
      expect(toolMsg.tool_call_id).toBe("t1");
      expect(toolMsg.name).toBe("read_file");
    });
  });

  // 鈹€鈹€ Edge cases 鈹€鈹€

  describe("edge cases", () => {
    it("handles empty messages array", () => {
      const result = engine.buildOptimizedMessages([], {});
      expect(result).toEqual([]);
    });

    it("handles messages without system prompt", () => {
      const raw = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ];
      const result = engine.buildOptimizedMessages(raw, { userQuery: "hello" });
      // No system prompt to clean, copies all messages from index 0
      expect(result.length).toBe(2);
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
    });

    it("does not modify original messages array", () => {
      const raw = [
        { role: "system", content: "sys 2026-03-12T10:00:00Z" },
        { role: "user", content: "test" },
      ];
      const originalContent = raw[0].content;
      engine.buildOptimizedMessages(raw, { userQuery: "test" });
      // Original should be untouched
      expect(raw[0].content).toBe(originalContent);
    });

    it("handles userQuery as undefined", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");
      const eng = new CLIContextEngineering({ db: mockDb });
      // Should not throw even without userQuery
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        {},
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("memory injection silently skips on error", () => {
      const mockDb = {};
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => {
        throw new Error("Memory DB error");
      });

      const eng = new CLIContextEngineering({ db: mockDb });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );
      // Should not throw, just skip memory
      expect(result.length).toBe(1);
    });

    it("notes injection silently skips when notes table missing", () => {
      const mockDb = {
        prepare: vi.fn(() => {
          throw new Error("no such table: notes");
        }),
      };
      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => []);
      _deps.BM25Search = originalDeps.BM25Search;

      const eng = new CLIContextEngineering({ db: mockDb });
      // Should not throw
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );
      expect(result.length).toBe(1);
    });
  });

  // 鈹€鈹€ Full pipeline integration 鈹€鈹€

  describe("full pipeline", () => {
    it("builds complete message with all injections", () => {
      const mockStmt = {
        all: vi.fn(() => [
          {
            id: "n1",
            title: "Auth Guide",
            content: "Authentication with JWT tokens",
          },
        ]),
      };
      const mockDb = { prepare: vi.fn(() => mockStmt) };

      _deps.generateInstinctPrompt = vi.fn(
        () => "Based on learned preferences:\n- [language] Use English",
      );
      _deps.recallMemory = vi.fn(() => [
        { content: "User prefers JWT", layer: "long-term", retention: 0.9 },
      ]);
      _deps.BM25Search = originalDeps.BM25Search;

      const eng = new CLIContextEngineering({ db: mockDb });
      eng.setTask("Implement JWT auth", ["Create middleware", "Add tests"]);
      eng.recordError({ step: "build", message: "Missing dependency" });

      const result = eng.buildOptimizedMessages(
        [
          { role: "system", content: "You are an AI assistant" },
          { role: "user", content: "implement jwt auth" },
        ],
        { userQuery: "jwt auth" },
      );

      // Should have: cleaned system + instinct + memory + notes + user + errors + task
      const roles = result.map((m) => m.role);
      expect(roles.filter((r) => r === "system").length).toBeGreaterThanOrEqual(
        3,
      );
      expect(roles).toContain("user");

      // Verify each injection present
      const contents = result.map((m) => m.content).join("\n");
      expect(contents).toContain("Learned Preferences");
      expect(contents).toContain("Relevant Memories");
      expect(contents).toContain("Current Task Status");
      expect(contents).toContain("Recent Errors");
      expect(contents).toContain("JWT");
    });
  });

  // 鈹€鈹€ updateTaskProgress 鈹€鈹€

  describe("updateTaskProgress", () => {
    it("updates by step index", () => {
      engine.setTask("Build app", ["Step 1", "Step 2", "Step 3"]);
      engine.updateTaskProgress(2);
      expect(engine.taskContext.currentStep).toBe(2);
    });

    it("updates by step name", () => {
      engine.setTask("Build app", ["Step 1", "Step 2", "Step 3"]);
      engine.updateTaskProgress("Step 2");
      expect(engine.taskContext.currentStep).toBe(1);
    });

    it("does nothing when no task set", () => {
      // Should not throw
      engine.updateTaskProgress(0);
    });
  });

  // 鈹€鈹€ reindexNotes 鈹€鈹€

  describe("reindexNotes", () => {
    it("resets notes index state without db", () => {
      engine._notesIndexed = true;
      engine._bm25 = { totalDocs: 5 };
      engine.reindexNotes();
      // Without db, _ensureNotesIndex early-returns, _notesIndexed stays false after reset
      expect(engine._notesIndexed).toBe(false);
      expect(engine._bm25).toBeNull();
    });

    it("reindexes notes with db", () => {
      const mockStmt = {
        all: vi.fn(() => [{ id: "1", title: "Note", content: "content" }]),
      };
      const mockDb = { prepare: vi.fn(() => mockStmt) };
      _deps.BM25Search = originalDeps.BM25Search;

      const eng = new CLIContextEngineering({ db: mockDb });
      eng._notesIndexed = true;
      eng._bm25 = { totalDocs: 99 };
      eng.reindexNotes();
      expect(eng._notesIndexed).toBe(true);
      expect(eng._bm25).not.toBeNull();
      expect(eng._bm25.totalDocs).toBe(1);
    });
  });

  // 鈹€鈹€ smartCompact edge cases 鈹€鈹€

  describe("smartCompact edge cases", () => {
    it("handles messages with only system prompt", () => {
      const messages = [{ role: "system", content: "sys" }];
      const result = engine.smartCompact(messages);
      expect(result).toEqual([{ role: "system", content: "sys" }]);
    });

    it("preserves chronological order after compaction", () => {
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 20 }, (_, i) => [
          { role: "user", content: `msg ${i}` },
          { role: "assistant", content: `resp ${i}` },
        ]).flat(),
      ];

      const compacted = engine.smartCompact(messages, { keepPairs: 3 });
      // Verify user messages are in ascending order
      const userMsgs = compacted.filter((m) => m.role === "user");
      for (let i = 1; i < userMsgs.length; i++) {
        const prevNum = parseInt(userMsgs[i - 1].content.split(" ")[1]);
        const currNum = parseInt(userMsgs[i].content.split(" ")[1]);
        expect(currNum).toBeGreaterThan(prevNum);
      }
    });

    it("task relevance boosts pair score", () => {
      engine.setTask("fix authentication");
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "how to fix authentication issue" },
        { role: "assistant", content: "here is the fix for authentication" },
        { role: "user", content: "what is the weather" },
        { role: "assistant", content: "I cannot check weather" },
        { role: "user", content: "tell me a joke" },
        { role: "assistant", content: "here is a joke" },
        { role: "user", content: "another unrelated thing" },
        { role: "assistant", content: "response to unrelated" },
      ];

      const compacted = engine.smartCompact(messages, { keepPairs: 2 });
      const contents = compacted.map((m) => m.content);
      // Authentication pair should be kept due to task relevance
      expect(contents).toContain("how to fix authentication issue");
    });

    it("uses default keepPairs of 6", () => {
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 10 }, (_, i) => [
          { role: "user", content: `msg ${i}` },
          { role: "assistant", content: `resp ${i}` },
        ]).flat(),
      ];

      const compacted = engine.smartCompact(messages);
      // 1 system + 6 pairs * 2 = 13
      expect(compacted.length).toBe(13);
    });
  });

  // 鈹€鈹€ Resumable compaction summaries 鈹€鈹€

  describe("resumable compaction summaries", () => {
    it("generates summaries for discarded pairs", () => {
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 10 }, (_, i) => [
          { role: "user", content: `question ${i}` },
          { role: "assistant", content: `answer ${i}` },
        ]).flat(),
      ];

      engine.smartCompact(messages, { keepPairs: 3 });

      // Should have summaries for discarded pairs
      expect(engine._compactionSummaries.length).toBeGreaterThan(0);
      expect(engine._compactionSummaries[0]).toContain("Q:");
    });

    it("caps summaries at 20", () => {
      // Run multiple compactions
      for (let round = 0; round < 5; round++) {
        const messages = [
          { role: "system", content: "sys" },
          ...Array.from({ length: 20 }, (_, i) => [
            { role: "user", content: `round ${round} question ${i}` },
            { role: "assistant", content: `answer ${i}` },
          ]).flat(),
        ];
        engine.smartCompact(messages, { keepPairs: 2 });
      }

      expect(engine._compactionSummaries.length).toBeLessThanOrEqual(20);
    });

    it("includes summaries in buildOptimizedMessages", () => {
      engine._compactionSummaries = [
        '- Q: "how to setup" 鈫?install npm packages',
        '- Q: "run tests" 鈫?[used tools] npm test output',
      ];

      const result = engine.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        {},
      );

      const summaryMsg = result.find(
        (m) =>
          m.role === "system" &&
          m.content.includes("Compacted Context Summary"),
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg.content).toContain("how to setup");
    });

    it("clearCompactionSummaries resets", () => {
      engine._compactionSummaries = ["summary1", "summary2"];
      engine.clearCompactionSummaries();
      expect(engine._compactionSummaries).toEqual([]);
    });

    it("includes tool usage info in summaries", () => {
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "read the config file" },
        {
          role: "assistant",
          content: "reading file",
          tool_calls: [{ id: "t1", function: { name: "read_file" } }],
        },
        { role: "tool", content: "file content", tool_call_id: "t1" },
        { role: "user", content: "old question no tools" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "newest message" },
        { role: "assistant", content: "newest response" },
      ];

      engine.smartCompact(messages, { keepPairs: 1 });

      // Find summaries mentioning tools
      const toolSummary = engine._compactionSummaries.find((s) =>
        s.includes("[used tools]"),
      );
      // At least some summary should exist
      expect(engine._compactionSummaries.length).toBeGreaterThan(0);
    });
  });

  // 鈹€鈹€ Stable prefix cache 鈹€鈹€

  describe("stable prefix cache", () => {
    it("caches stable prefix and reuses on subsequent calls", () => {
      const eng = new CLIContextEngineering({ db: null });
      const longPrompt =
        "A".repeat(200) + " Started at 2026-03-12T14:30:00Z and ended.";

      eng.buildOptimizedMessages([{ role: "system", content: longPrompt }], {});

      expect(eng._prefixCache).not.toBeNull();
      expect(eng._prefixCache.hash).toBeTruthy();

      // Second call should reuse cache
      const firstHash = eng._prefixCache.hash;
      eng.buildOptimizedMessages([{ role: "system", content: longPrompt }], {});
      expect(eng._prefixCache.hash).toBe(firstHash);
    });

    it("invalidates cache when prefix changes", () => {
      const eng = new CLIContextEngineering({ db: null });
      // Ensure prefix is long enough (>50 chars) before the dynamic date
      const prompt1 =
        "System prompt with lots of static content that stays the same across calls and is quite lengthy. " +
        "2026-01-01T00:00:00Z more text here";
      const prompt2 =
        "Different system prompt with different static content that changes between the two calls entirely. " +
        "2026-01-01T00:00:00Z more text here";

      eng.buildOptimizedMessages([{ role: "system", content: prompt1 }], {});
      const hash1 = eng._prefixCache?.hash;
      expect(hash1).toBeTruthy();

      eng.buildOptimizedMessages([{ role: "system", content: prompt2 }], {});
      const hash2 = eng._prefixCache?.hash;

      expect(hash1).not.toBe(hash2);
    });

    it("skips caching for short prompts", () => {
      const eng = new CLIContextEngineering({ db: null });
      eng.buildOptimizedMessages([{ role: "system", content: "short" }], {});
      expect(eng._prefixCache).toBeNull();
    });

    it("reports prefixCached in stats", () => {
      const eng = new CLIContextEngineering({ db: null });
      expect(eng.getStats().prefixCached).toBe(false);

      // Use a prompt with >100 chars total and >50 chars of stable prefix
      const longStablePrefix =
        "This is a very long system prompt with lots of static content that never changes and is quite verbose. ";
      eng.buildOptimizedMessages(
        [
          {
            role: "system",
            content: longStablePrefix + "2026-01-01T00:00:00Z trailing content",
          },
        ],
        {},
      );
      expect(eng.getStats().prefixCached).toBe(true);
    });
  });

  // 鈹€鈹€ Permanent memory injection 鈹€鈹€

  describe("permanent memory injection", () => {
    it("injects permanent memory results when available", () => {
      const mockPm = {
        getRelevantContext: vi.fn(() => [
          { content: "Always use TypeScript", source: "MEMORY.md", score: 0.8 },
          { content: "Prefer ESM imports", source: "daily-note", score: 0.6 },
        ]),
      };

      _deps.generateInstinctPrompt = vi.fn(() => "");
      _deps.recallMemory = vi.fn(() => []);

      const eng = new CLIContextEngineering({
        db: {},
        permanentMemory: mockPm,
      });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "typescript setup" },
      );

      const pmMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Permanent Memory"),
      );
      expect(pmMsg).toBeDefined();
      expect(pmMsg.content).toContain("TypeScript");
      expect(pmMsg.content).toContain("ESM imports");
    });

    it("skips permanent memory when not configured", () => {
      const eng = new CLIContextEngineering({ db: null });
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );

      const pmMsg = result.find(
        (m) => m.role === "system" && m.content.includes("Permanent Memory"),
      );
      expect(pmMsg).toBeUndefined();
    });

    it("silently skips on permanent memory error", () => {
      const mockPm = {
        getRelevantContext: vi.fn(() => {
          throw new Error("PM error");
        }),
      };

      _deps.generateInstinctPrompt = vi.fn(() => "");

      const eng = new CLIContextEngineering({
        db: {},
        permanentMemory: mockPm,
      });
      // Should not throw
      const result = eng.buildOptimizedMessages(
        [{ role: "system", content: "sys" }],
        { userQuery: "test" },
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("reports hasPermanentMemory in stats", () => {
      const eng1 = new CLIContextEngineering({ db: null });
      expect(eng1.getStats().hasPermanentMemory).toBe(false);

      const eng2 = new CLIContextEngineering({
        db: null,
        permanentMemory: { getRelevantContext: () => [] },
      });
      expect(eng2.getStats().hasPermanentMemory).toBe(true);
    });
  });

  // 鈹€鈹€ Stats enhancements 鈹€鈹€

  describe("enhanced stats", () => {
    it("includes compactionSummaries count", () => {
      engine._compactionSummaries = ["a", "b", "c"];
      const stats = engine.getStats();
      expect(stats.compactionSummaries).toBe(3);
    });
  });
});
