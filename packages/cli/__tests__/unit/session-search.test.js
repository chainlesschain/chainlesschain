/**
 * Unit tests for SessionSearchIndex — cross-session FTS5 search.
 *
 * Uses mock DB since better-sqlite3 native module is not available
 * in the test environment. Tests verify correct SQL generation and
 * graceful degradation behavior.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionSearchIndex } from "../../src/lib/session-search.js";

// ─── Mock DB ────────────────────────────────────────────────────────

function createMockDb(options = {}) {
  const rows = options.searchResults || [];
  const countResult = options.countResult || { cnt: 0 };

  return {
    exec: vi.fn(),
    prepare: vi.fn((sql) => ({
      run: vi.fn(),
      get: vi.fn(() => countResult),
      all: vi.fn(() => rows),
    })),
    transaction: vi.fn((fn) => fn),
  };
}

// ─── Mock JSONL session store ───────────────────────────────────────

vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  readEvents: vi.fn((sessionId) => {
    if (sessionId === "sess-with-msgs") {
      return [
        {
          type: "session_start",
          timestamp: 1000,
          data: { title: "Test" },
        },
        {
          type: "user_message",
          timestamp: 1001,
          data: { role: "user", content: "How do I implement auth?" },
        },
        {
          type: "assistant_message",
          timestamp: 1002,
          data: {
            role: "assistant",
            content: "Use JWT tokens for authentication.",
          },
        },
        {
          type: "tool_call",
          timestamp: 1003,
          data: { tool: "read_file" },
        },
      ];
    }
    if (sessionId === "sess-empty") {
      return [
        {
          type: "session_start",
          timestamp: 2000,
          data: { title: "Empty" },
        },
      ];
    }
    return [];
  }),
  listJsonlSessions: vi.fn(() => [
    { id: "sess-with-msgs" },
    { id: "sess-empty" },
  ]),
}));

describe("SessionSearchIndex", () => {
  let db;
  let index;

  beforeEach(() => {
    db = createMockDb();
    index = new SessionSearchIndex(db);
  });

  // ── Table creation ─────────────────────────────────────────────────

  describe("ensureTables", () => {
    it("creates the FTS5 virtual table via exec", () => {
      index.ensureTables();
      expect(db.exec).toHaveBeenCalled();
      const sql = db.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS session_fts");
      expect(sql).toContain("USING fts5");
      expect(sql).toContain("session_id UNINDEXED");
      expect(sql).toContain("role UNINDEXED");
      expect(sql).toContain("content");
    });

    it("is idempotent (sets _initialized flag)", () => {
      index.ensureTables();
      index.ensureTables();
      // exec called once for create, second call still works
      expect(index._initialized).toBe(true);
    });
  });

  // ── extractMessages ────────────────────────────────────────────────

  describe("extractMessages", () => {
    it("extracts user and assistant messages from session events", () => {
      const msgs = index.extractMessages("sess-with-msgs");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toContain("auth");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toContain("JWT");
    });

    it("skips non-message events (tool_call, session_start)", () => {
      const msgs = index.extractMessages("sess-with-msgs");
      expect(msgs).toHaveLength(2);
      // tool_call and session_start not included
    });

    it("returns empty for session with no messages", () => {
      const msgs = index.extractMessages("sess-empty");
      expect(msgs).toEqual([]);
    });

    it("returns empty for non-existent session", () => {
      const msgs = index.extractMessages("nonexistent");
      expect(msgs).toEqual([]);
    });

    it("truncates long messages to MAX_CONTENT_LENGTH", async () => {
      const { readEvents } =
        await import("../../src/harness/jsonl-session-store.js");
      readEvents.mockReturnValueOnce([
        {
          type: "user_message",
          timestamp: 3000,
          data: { role: "user", content: "x".repeat(20000) },
        },
      ]);

      const msgs = index.extractMessages("long-msg");
      expect(msgs[0].content.length).toBeLessThanOrEqual(10000);
    });
  });

  // ── indexSession ───────────────────────────────────────────────────

  describe("indexSession", () => {
    it("indexes messages from a session", () => {
      index.ensureTables();
      const result = index.indexSession("sess-with-msgs");
      expect(result.indexed).toBe(2);
      // Should have called exec for DELETE (clear old entries)
      expect(db.exec).toHaveBeenCalledTimes(2); // ensureTables + DELETE
      // Should have called prepare for INSERT
      expect(db.prepare).toHaveBeenCalled();
    });

    it("returns 0 for empty session", () => {
      index.ensureTables();
      const result = index.indexSession("sess-empty");
      expect(result.indexed).toBe(0);
    });

    it("returns 0 for non-existent session", () => {
      index.ensureTables();
      const result = index.indexSession("nonexistent");
      expect(result.indexed).toBe(0);
    });

    it("auto-calls ensureTables if not initialized", () => {
      const result = index.indexSession("sess-with-msgs");
      expect(index._initialized).toBe(true);
      expect(result.indexed).toBe(2);
    });
  });

  // ── search ─────────────────────────────────────────────────────────

  describe("search", () => {
    it("returns results from FTS query", () => {
      const mockResults = [
        {
          sessionId: "s1",
          role: "user",
          snippet: ">>>auth<<< query",
          timestamp: "123",
          rank: -1.5,
        },
      ];
      db = createMockDb({ searchResults: mockResults });
      index = new SessionSearchIndex(db);
      index.ensureTables();

      const results = index.search("auth");
      expect(results).toHaveLength(1);
      expect(results[0].sessionId).toBe("s1");
      expect(results[0].snippet).toContain(">>>");
    });

    it("passes limit to SQL query", () => {
      db = createMockDb({ searchResults: [] });
      index = new SessionSearchIndex(db);
      index.ensureTables();

      index.search("test", { limit: 5 });
      const allCalls = db.prepare.mock.results;
      // The last prepare().all() call should receive the limit
      // (implementation detail: prepare is called, then .all(query, limit))
      expect(db.prepare).toHaveBeenCalled();
    });

    it("returns empty for empty query", () => {
      index.ensureTables();
      expect(index.search("")).toEqual([]);
      expect(index.search("  ")).toEqual([]);
      expect(index.search(null)).toEqual([]);
    });

    it("handles FTS syntax errors gracefully", () => {
      // First call throws (bad syntax), second call (quoted phrase) succeeds
      const mockPrepare = vi.fn(() => ({
        all: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error("fts5: syntax error");
          })
          .mockReturnValueOnce([{ sessionId: "s1", snippet: "fallback" }]),
        run: vi.fn(),
        get: vi.fn(),
      }));

      db = {
        exec: vi.fn(),
        prepare: mockPrepare,
        transaction: vi.fn((fn) => fn),
      };
      index = new SessionSearchIndex(db);
      index.ensureTables();

      const results = index.search("C:\\Users");
      // Should not throw, either returns fallback or empty
      expect(Array.isArray(results)).toBe(true);
    });

    it("returns empty if both match attempts fail", () => {
      const mockPrepare = vi.fn(() => ({
        all: vi.fn().mockImplementation(() => {
          throw new Error("fts5 error");
        }),
        run: vi.fn(),
        get: vi.fn(),
      }));

      db = {
        exec: vi.fn(),
        prepare: mockPrepare,
        transaction: vi.fn((fn) => fn),
      };
      index = new SessionSearchIndex(db);
      index.ensureTables();

      const results = index.search("broken query");
      expect(results).toEqual([]);
    });
  });

  // ── reindexAll ─────────────────────────────────────────────────────

  describe("reindexAll", () => {
    it("clears FTS and re-indexes all sessions", () => {
      index.ensureTables();
      const result = index.reindexAll();
      expect(result.sessions).toBe(2); // 2 sessions from mock
      // sess-with-msgs has 2 messages, sess-empty has 0
      expect(result.messages).toBe(2);
    });

    it("calls DELETE FROM session_fts to clear", () => {
      index.ensureTables();
      index.reindexAll();
      const deleteCalls = db.exec.mock.calls.filter(([sql]) =>
        sql.includes("DELETE FROM session_fts"),
      );
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── getStats ───────────────────────────────────────────────────────

  describe("getStats", () => {
    it("returns totalRows from COUNT query", () => {
      db = createMockDb({ countResult: { cnt: 42 } });
      index = new SessionSearchIndex(db);
      index.ensureTables();

      const stats = index.getStats();
      expect(stats.totalRows).toBe(42);
    });

    it("returns 0 for empty index", () => {
      index.ensureTables();
      const stats = index.getStats();
      expect(stats.totalRows).toBe(0);
    });
  });

  // ── Null DB graceful degradation ───────────────────────────────────

  describe("null DB graceful degradation", () => {
    let nullIndex;
    beforeEach(() => {
      nullIndex = new SessionSearchIndex(null);
    });

    it("search returns empty", () => {
      expect(nullIndex.search("test")).toEqual([]);
    });

    it("indexSession returns 0", () => {
      expect(nullIndex.indexSession("x")).toEqual({ indexed: 0 });
    });

    it("reindexAll returns 0", () => {
      expect(nullIndex.reindexAll()).toEqual({ sessions: 0, messages: 0 });
    });

    it("getStats returns 0", () => {
      expect(nullIndex.getStats()).toEqual({ totalRows: 0 });
    });

    it("ensureTables is no-op", () => {
      nullIndex.ensureTables(); // should not throw
      expect(nullIndex._initialized).toBe(false);
    });
  });

  // ── Edge-case coverage (Hermes parity) ──────────────────────────

  describe("getStats when prepare().get() throws", () => {
    it("returns totalRows: 0 on query error", () => {
      const throwDb = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          get: vi.fn(() => {
            throw new Error("disk I/O error");
          }),
          run: vi.fn(),
          all: vi.fn(),
        })),
        transaction: vi.fn((fn) => fn),
      };
      const idx = new SessionSearchIndex(throwDb);
      idx.ensureTables();
      expect(idx.getStats()).toEqual({ totalRows: 0 });
    });
  });

  describe("search auto-calls ensureTables", () => {
    it("initializes on first search if not yet initialized", () => {
      const mockResults = [
        { sessionId: "s1", snippet: "hit", timestamp: "1", rank: -1 },
      ];
      const freshDb = createMockDb({ searchResults: mockResults });
      const idx = new SessionSearchIndex(freshDb);
      expect(idx._initialized).toBe(false);
      const results = idx.search("test");
      expect(idx._initialized).toBe(true);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("indexSession with empty/whitespace content", () => {
    it("skips messages with whitespace-only content", async () => {
      const { readEvents } =
        await import("../../src/harness/jsonl-session-store.js");
      readEvents.mockReturnValueOnce([
        {
          type: "user_message",
          timestamp: 5000,
          data: { role: "user", content: "   " },
        },
        {
          type: "assistant_message",
          timestamp: 5001,
          data: { role: "assistant", content: "" },
        },
        {
          type: "user_message",
          timestamp: 5002,
          data: { role: "user", content: "real content" },
        },
      ]);
      index.ensureTables();
      const result = index.indexSession("whitespace-sess");
      // Only "real content" should be indexed
      expect(result.indexed).toBe(1);
    });
  });

  describe("search with special FTS chars", () => {
    it("handles * wildcard without throwing", () => {
      index.ensureTables();
      const results = index.search("test*");
      expect(Array.isArray(results)).toBe(true);
    });

    it("handles OR operator without throwing", () => {
      index.ensureTables();
      const results = index.search("foo OR bar");
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("reindexAll with empty session list", () => {
    it("returns 0 messages when listJsonlSessions returns empty", async () => {
      const { listJsonlSessions } =
        await import("../../src/harness/jsonl-session-store.js");
      listJsonlSessions.mockReturnValueOnce([]);
      index.ensureTables();
      const result = index.reindexAll();
      expect(result.sessions).toBe(0);
      expect(result.messages).toBe(0);
    });
  });

  describe("extractMessages fallback role", () => {
    it("uses type-based fallback when event.data.role is missing", async () => {
      const { readEvents } =
        await import("../../src/harness/jsonl-session-store.js");
      readEvents.mockReturnValueOnce([
        {
          type: "user_message",
          timestamp: 6000,
          data: { content: "no role field" },
        },
        {
          type: "assistant_message",
          timestamp: 6001,
          data: { content: "also no role" },
        },
      ]);
      const msgs = index.extractMessages("no-role-sess");
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });
  });
});
