import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureMemoryTables,
  storeMemory,
  recallMemory,
  consolidateMemory,
  searchEpisodic,
  searchSemantic,
  shareMemory,
  pruneMemory,
  getMemoryStats,
  _working,
  _shortTerm,
  MEMORY_CONFIG,
} from "../../src/lib/hierarchical-memory.js";

// ─── Mock DB ─────────────────────────────────────────────────────
function createMockDb() {
  const tables = {};

  return {
    exec: vi.fn((sql) => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (match && !tables[match[1]]) {
        tables[match[1]] = [];
      }
    }),
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => {
        // Route inserts to in-memory table store
        const insertMatch = sql.match(/INSERT INTO (\w+)/);
        if (insertMatch && tables[insertMatch[1]]) {
          tables[insertMatch[1]].push(args);
        }
        const deleteMatch = sql.match(/DELETE FROM (\w+)/);
        if (deleteMatch) {
          return { changes: 1 };
        }
        return { changes: 1 };
      }),
      get: vi.fn(() => ({ count: 0 })),
      all: vi.fn(() => []),
    })),
    _tables: tables,
  };
}

describe("hierarchical-memory", () => {
  let db;

  beforeEach(() => {
    db = createMockDb();
    _working.clear();
    _shortTerm.clear();
  });

  // ─── ensureMemoryTables ────────────────────────────────────────
  describe("ensureMemoryTables", () => {
    it("creates three tables", () => {
      ensureMemoryTables(db);
      expect(db.exec).toHaveBeenCalledTimes(3);
      expect(db.exec).toHaveBeenCalledWith(
        expect.stringContaining("memory_long_term"),
      );
      expect(db.exec).toHaveBeenCalledWith(
        expect.stringContaining("memory_core"),
      );
      expect(db.exec).toHaveBeenCalledWith(
        expect.stringContaining("memory_sharing"),
      );
    });
  });

  // ─── storeMemory ──────────────────────────────────────────────
  describe("storeMemory", () => {
    it("stores to working layer when importance < 0.3", () => {
      const result = storeMemory(db, "quick thought", { importance: 0.1 });
      expect(result.layer).toBe("working");
      expect(_working.size).toBe(1);
    });

    it("stores to short-term layer when importance >= 0.3 and < 0.6", () => {
      const result = storeMemory(db, "short term note", { importance: 0.4 });
      expect(result.layer).toBe("short-term");
      expect(_shortTerm.size).toBe(1);
    });

    it("stores to long-term layer when importance >= 0.6 and < 0.9", () => {
      const result = storeMemory(db, "important fact", { importance: 0.7 });
      expect(result.layer).toBe("long-term");
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO memory_long_term"),
      );
    });

    it("stores to core layer when importance >= 0.9", () => {
      const result = storeMemory(db, "fundamental truth", { importance: 0.95 });
      expect(result.layer).toBe("core");
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO memory_core"),
      );
    });

    it("throws on empty content", () => {
      expect(() => storeMemory(db, "", {})).toThrow(
        "Memory content cannot be empty",
      );
    });

    it("throws on whitespace-only content", () => {
      expect(() => storeMemory(db, "   ", {})).toThrow(
        "Memory content cannot be empty",
      );
    });

    it("defaults importance to 0.5 (short-term)", () => {
      const result = storeMemory(db, "default importance", {});
      expect(result.layer).toBe("short-term");
    });

    it("respects type option", () => {
      storeMemory(db, "semantic fact", { importance: 0.2, type: "semantic" });
      const mem = [..._working.values()][0];
      expect(mem.type).toBe("semantic");
    });

    it("evicts oldest when working capacity reached", () => {
      const original = MEMORY_CONFIG.workingCapacity;
      MEMORY_CONFIG.workingCapacity = 2;
      storeMemory(db, "first", { importance: 0.1 });
      storeMemory(db, "second", { importance: 0.1 });
      storeMemory(db, "third", { importance: 0.1 });
      expect(_working.size).toBe(2);
      MEMORY_CONFIG.workingCapacity = original;
    });

    it("returns an id", () => {
      const result = storeMemory(db, "test", { importance: 0.1 });
      expect(result.id).toMatch(/^hmem-/);
    });
  });

  // ─── recallMemory ─────────────────────────────────────────────
  describe("recallMemory", () => {
    it("returns empty for empty query", () => {
      expect(recallMemory(db, "", {})).toEqual([]);
    });

    it("recalls from working memory", () => {
      storeMemory(db, "hello world", { importance: 0.1 });
      const results = recallMemory(db, "hello", {});
      expect(results.length).toBe(1);
      expect(results[0].layer).toBe("working");
    });

    it("recalls from short-term memory", () => {
      storeMemory(db, "important meeting", { importance: 0.4 });
      const results = recallMemory(db, "meeting", {});
      expect(results.length).toBe(1);
      expect(results[0].layer).toBe("short-term");
    });

    it("increments access count on recall", () => {
      storeMemory(db, "recall me", { importance: 0.2 });
      recallMemory(db, "recall", {});
      const mem = [..._working.values()][0];
      expect(mem.accessCount).toBe(1);
    });

    it("includes retention score in results", () => {
      storeMemory(db, "fresh memory", { importance: 0.1 });
      const results = recallMemory(db, "fresh", {});
      expect(results[0].retention).toBeGreaterThan(0);
      expect(results[0].retention).toBeLessThanOrEqual(1);
    });

    it("respects limit option", () => {
      for (let i = 0; i < 5; i++) {
        storeMemory(db, `item ${i}`, { importance: 0.1 });
      }
      const results = recallMemory(db, "item", { limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  // ─── consolidateMemory ────────────────────────────────────────
  describe("consolidateMemory", () => {
    it("promotes working to short-term when access >= 3", () => {
      storeMemory(db, "frequently accessed", { importance: 0.1 });
      const id = [..._working.keys()][0];
      _working.get(id).accessCount = 3;
      consolidateMemory(db);
      expect(_working.size).toBe(0);
      expect(_shortTerm.size).toBe(1);
    });

    it("promotes short-term to long-term when access >= 5", () => {
      storeMemory(db, "very frequent", { importance: 0.4 });
      const id = [..._shortTerm.keys()][0];
      _shortTerm.get(id).accessCount = 5;
      consolidateMemory(db);
      expect(_shortTerm.size).toBe(0);
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO memory_long_term"),
      );
    });

    it("returns promoted and forgotten counts", () => {
      storeMemory(db, "test", { importance: 0.1 });
      const id = [..._working.keys()][0];
      _working.get(id).accessCount = 3;
      const result = consolidateMemory(db);
      expect(result.promoted).toBe(1);
      expect(typeof result.forgotten).toBe("number");
    });
  });

  // ─── searchEpisodic / searchSemantic ──────────────────────────
  describe("searchEpisodic", () => {
    it("returns only episodic memories", () => {
      storeMemory(db, "episodic event", { importance: 0.1, type: "episodic" });
      storeMemory(db, "semantic fact", { importance: 0.1, type: "semantic" });
      const results = searchEpisodic(db, "event", {});
      expect(results.length).toBe(1);
      expect(results[0].type).toBe("episodic");
    });

    it("returns empty for no match", () => {
      expect(searchEpisodic(db, "nothing", {})).toEqual([]);
    });
  });

  describe("searchSemantic", () => {
    it("returns only semantic memories", () => {
      storeMemory(db, "semantic knowledge", {
        importance: 0.1,
        type: "semantic",
      });
      storeMemory(db, "episodic event", { importance: 0.1, type: "episodic" });
      const results = searchSemantic(db, "knowledge", {});
      expect(results.length).toBe(1);
      expect(results[0].type).toBe("semantic");
    });
  });

  // ─── shareMemory ──────────────────────────────────────────────
  describe("shareMemory", () => {
    it("creates a sharing record", () => {
      const result = shareMemory(db, "mem-123", "agent-456", "full");
      expect(result.id).toMatch(/^share-/);
      expect(result.memoryId).toBe("mem-123");
      expect(result.targetAgentId).toBe("agent-456");
      expect(result.privacyLevel).toBe("full");
    });

    it("defaults to filtered privacy", () => {
      const result = shareMemory(db, "mem-123", "agent-456");
      expect(result.privacyLevel).toBe("filtered");
    });

    it("throws if memoryId missing", () => {
      expect(() => shareMemory(db, null, "agent-456")).toThrow(
        "memoryId and targetAgentId are required",
      );
    });

    it("throws if targetAgentId missing", () => {
      expect(() => shareMemory(db, "mem-123", null)).toThrow(
        "memoryId and targetAgentId are required",
      );
    });
  });

  // ─── pruneMemory ──────────────────────────────────────────────
  describe("pruneMemory", () => {
    it("returns pruned count", () => {
      const result = pruneMemory(db, { maxAge: 1 });
      expect(typeof result.pruned).toBe("number");
    });

    it("removes weak working memories", () => {
      storeMemory(db, "stale", { importance: 0.1 });
      const id = [..._working.keys()][0];
      // Force stale by backdating
      _working.get(id).lastAccessed = new Date(
        Date.now() - 1000 * 60 * 60 * 100,
      ).toISOString();
      pruneMemory(db, {});
      expect(_working.size).toBe(0);
    });
  });

  // ─── getMemoryStats ───────────────────────────────────────────
  describe("getMemoryStats", () => {
    it("returns counts for all layers", () => {
      storeMemory(db, "w1", { importance: 0.1 });
      storeMemory(db, "st1", { importance: 0.4 });
      const stats = getMemoryStats(db);
      expect(stats.working).toBe(1);
      expect(stats.shortTerm).toBe(1);
      expect(typeof stats.longTerm).toBe("number");
      expect(typeof stats.core).toBe("number");
      expect(typeof stats.shared).toBe("number");
      expect(stats.total).toBe(
        stats.working + stats.shortTerm + stats.longTerm + stats.core,
      );
    });
  });
});
