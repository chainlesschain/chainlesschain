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
  // Phase 83 V2
  MEMORY_LAYER,
  MEMORY_TYPE,
  CONSOLIDATION_STATUS,
  SHARE_PERMISSION,
  applyForgettingCurve,
  attachMetadata,
  promoteMemoryV2,
  demoteMemoryV2,
  shareMemoryV2,
  revokeShare,
  listShares,
  searchEpisodicV2,
  searchSemanticV2,
  consolidateV2,
  listConsolidations,
  pruneV2,
  startConsolidationTimer,
  stopConsolidationTimer,
  getStatsV2,
  _resetV2State,
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
    _resetV2State();
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

  // ═══════════════════════════════════════════════════════════════
  // Phase 83 — Hierarchical Memory 2.0 additions
  // ═══════════════════════════════════════════════════════════════

  describe("Phase 83 frozen enums", () => {
    it("MEMORY_LAYER is frozen with 4 layers", () => {
      expect(Object.isFrozen(MEMORY_LAYER)).toBe(true);
      expect(Object.values(MEMORY_LAYER).sort()).toEqual([
        "core",
        "long-term",
        "short-term",
        "working",
      ]);
    });

    it("MEMORY_TYPE is frozen with 3 types", () => {
      expect(Object.isFrozen(MEMORY_TYPE)).toBe(true);
      expect(Object.values(MEMORY_TYPE).sort()).toEqual([
        "episodic",
        "procedural",
        "semantic",
      ]);
    });

    it("CONSOLIDATION_STATUS is frozen with 4 statuses", () => {
      expect(Object.isFrozen(CONSOLIDATION_STATUS)).toBe(true);
      expect(Object.values(CONSOLIDATION_STATUS).sort()).toEqual([
        "completed",
        "failed",
        "pending",
        "processing",
      ]);
    });

    it("SHARE_PERMISSION is frozen with 3 perms", () => {
      expect(Object.isFrozen(SHARE_PERMISSION)).toBe(true);
      expect(Object.values(SHARE_PERMISSION).sort()).toEqual([
        "copy",
        "modify",
        "read",
      ]);
    });
  });

  describe("applyForgettingCurve", () => {
    it("returns 1.0 for just-now timestamp", () => {
      const r = applyForgettingCurve(new Date().toISOString());
      expect(r).toBeCloseTo(1.0, 1);
    });

    it("returns < 1.0 for past timestamp", () => {
      const past = new Date(Date.now() - 10 * 3600_000).toISOString();
      const r = applyForgettingCurve(past);
      expect(r).toBeLessThan(1.0);
      expect(r).toBeGreaterThan(0);
    });

    it("accepts custom rate", () => {
      const past = new Date(Date.now() - 1 * 3600_000).toISOString();
      const slow = applyForgettingCurve(past, 0.01);
      const fast = applyForgettingCurve(past, 1.0);
      expect(slow).toBeGreaterThan(fast);
    });
  });

  describe("attachMetadata", () => {
    it("attaches metadata to a memory", () => {
      const { id } = storeMemory(db, "episodic moment", { importance: 0.1 });
      const meta = attachMetadata(id, { scene: "kitchen", context: "morning" });
      expect(meta.scene).toBe("kitchen");
      expect(meta.context).toBe("morning");
      expect(meta.memoryId).toBe(id);
    });

    it("merges on repeated attach", () => {
      const { id } = storeMemory(db, "test", { importance: 0.1 });
      attachMetadata(id, { scene: "office" });
      const merged = attachMetadata(id, { context: "deep-work" });
      expect(merged.scene).toBe("office");
      expect(merged.context).toBe("deep-work");
    });

    it("throws without memoryId", () => {
      expect(() => attachMetadata(null, { scene: "x" })).toThrow(/required/);
    });

    it("throws without metadata object", () => {
      expect(() => attachMetadata("mem-1", null)).toThrow(/object/);
    });
  });

  describe("promoteMemoryV2 / demoteMemoryV2", () => {
    it("promotes working → short-term", () => {
      const { id } = storeMemory(db, "climb me up", { importance: 0.1 });
      const result = promoteMemoryV2(db, id);
      expect(result.from).toBe("working");
      expect(result.to).toBe("short-term");
      expect(_working.size).toBe(0);
      expect(_shortTerm.size).toBe(1);
    });

    it("promotes short-term → long-term (DB insert)", () => {
      const { id } = storeMemory(db, "climb further", { importance: 0.4 });
      const result = promoteMemoryV2(db, id);
      expect(result.from).toBe("short-term");
      expect(result.to).toBe("long-term");
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO memory_long_term"),
      );
    });

    it("demotes short-term → working", () => {
      const { id } = storeMemory(db, "drop me", { importance: 0.4 });
      const result = demoteMemoryV2(id);
      expect(result.from).toBe("short-term");
      expect(result.to).toBe("working");
      expect(_working.size).toBe(1);
      expect(_shortTerm.size).toBe(0);
    });

    it("throws when promoting unknown id", () => {
      expect(() => promoteMemoryV2(db, "non-existent")).toThrow(/not found/);
    });

    it("throws when demoting memory not in short-term", () => {
      expect(() => demoteMemoryV2("non-existent")).toThrow(/not in short-term/);
    });

    it("throws when memoryId is missing", () => {
      expect(() => promoteMemoryV2(db, null)).toThrow(/required/);
      expect(() => demoteMemoryV2(null)).toThrow(/required/);
    });
  });

  describe("shareMemoryV2 / revokeShare / listShares", () => {
    it("creates a sharing record with permissions", () => {
      const record = shareMemoryV2(db, {
        memoryId: "mem-1",
        sourceAgent: "agent-a",
        targetAgent: "agent-b",
        permissions: ["read", "copy"],
      });
      expect(record.id).toMatch(/^sharev2-/);
      expect(record.permissions).toEqual(["read", "copy"]);
      expect(record.sourceAgent).toBe("agent-a");
      expect(record.revokedAt).toBeNull();
    });

    it("defaults permissions to ['read']", () => {
      const r = shareMemoryV2(db, {
        memoryId: "mem-1",
        targetAgent: "agent-b",
      });
      expect(r.permissions).toEqual(["read"]);
      expect(r.sourceAgent).toBe("local");
    });

    it("throws on invalid permission", () => {
      expect(() =>
        shareMemoryV2(db, {
          memoryId: "mem-1",
          targetAgent: "agent-b",
          permissions: ["delete"],
        }),
      ).toThrow(/Invalid permission/);
    });

    it("throws if memoryId or targetAgent missing", () => {
      expect(() =>
        shareMemoryV2(db, { memoryId: null, targetAgent: "b" }),
      ).toThrow(/required/);
      expect(() =>
        shareMemoryV2(db, { memoryId: "m", targetAgent: null }),
      ).toThrow(/required/);
    });

    it("revokes a share", () => {
      const r = shareMemoryV2(db, { memoryId: "m-1", targetAgent: "b" });
      const revoked = revokeShare(r.id);
      expect(revoked.revokedAt).not.toBeNull();
    });

    it("throws when revoking unknown share", () => {
      expect(() => revokeShare("non-existent")).toThrow(/not found/);
    });

    it("throws when double-revoking", () => {
      const r = shareMemoryV2(db, { memoryId: "m-1", targetAgent: "b" });
      revokeShare(r.id);
      expect(() => revokeShare(r.id)).toThrow(/already revoked/);
    });

    it("filters listShares by memoryId / targetAgent / activeOnly", () => {
      shareMemoryV2(db, { memoryId: "m-1", targetAgent: "alice" });
      shareMemoryV2(db, { memoryId: "m-2", targetAgent: "bob" });
      const r3 = shareMemoryV2(db, { memoryId: "m-1", targetAgent: "carol" });
      revokeShare(r3.id);

      expect(listShares({ memoryId: "m-1" }).length).toBe(2);
      expect(listShares({ targetAgent: "alice" }).length).toBe(1);
      expect(listShares({ memoryId: "m-1", activeOnly: true }).length).toBe(1);
      expect(listShares().length).toBe(3);
    });
  });

  describe("searchEpisodicV2", () => {
    it("filters by scene metadata", () => {
      const { id: a } = storeMemory(db, "breakfast chat", {
        importance: 0.1,
        type: "episodic",
      });
      attachMetadata(a, { scene: "kitchen" });
      const { id: b } = storeMemory(db, "office meeting", {
        importance: 0.1,
        type: "episodic",
      });
      attachMetadata(b, { scene: "office" });

      const results = searchEpisodicV2(db, { scene: "kitchen" });
      expect(results.length).toBe(1);
      expect(results[0].metadata.scene).toBe("kitchen");
    });

    it("filters by time range", () => {
      storeMemory(db, "now event", { importance: 0.1, type: "episodic" });
      const results = searchEpisodicV2(db, {
        timeRange: {
          from: new Date(Date.now() - 1000).toISOString(),
          to: new Date(Date.now() + 1000).toISOString(),
        },
      });
      expect(results.length).toBe(1);
    });

    it("excludes entries outside time range", () => {
      storeMemory(db, "future event", { importance: 0.1, type: "episodic" });
      const results = searchEpisodicV2(db, {
        timeRange: {
          from: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      expect(results.length).toBe(0);
    });

    it("skips non-episodic memories", () => {
      storeMemory(db, "semantic fact", {
        importance: 0.1,
        type: "semantic",
      });
      const results = searchEpisodicV2(db, { query: "fact" });
      expect(results.length).toBe(0);
    });

    it("respects limit option", () => {
      for (let i = 0; i < 5; i++) {
        storeMemory(db, `event ${i}`, { importance: 0.1, type: "episodic" });
      }
      const results = searchEpisodicV2(db, { query: "event", limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe("searchSemanticV2", () => {
    it("ranks by concept overlap similarity", () => {
      const { id: a } = storeMemory(db, "AI paper", {
        importance: 0.1,
        type: "semantic",
      });
      attachMetadata(a, { concepts: ["ai", "ml", "llm"] });
      const { id: b } = storeMemory(db, "DB paper", {
        importance: 0.1,
        type: "semantic",
      });
      attachMetadata(b, { concepts: ["db", "sql"] });

      const results = searchSemanticV2(db, {
        concepts: ["ai", "ml"],
        similarityThreshold: 0,
      });
      expect(results.length).toBe(2);
      expect(results[0].metadata.concepts).toContain("ai");
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });

    it("filters by similarity threshold", () => {
      const { id } = storeMemory(db, "weakly related", {
        importance: 0.1,
        type: "semantic",
      });
      attachMetadata(id, { concepts: ["x", "y", "z"] });
      const results = searchSemanticV2(db, {
        concepts: ["a"],
        similarityThreshold: 0.5,
      });
      expect(results.length).toBe(0);
    });

    it("supports query-only (no concepts) content search", () => {
      storeMemory(db, "thermodynamics", {
        importance: 0.1,
        type: "semantic",
      });
      const results = searchSemanticV2(db, { query: "thermo" });
      expect(results.length).toBe(1);
    });

    it("skips non-semantic memories", () => {
      storeMemory(db, "episodic here", { importance: 0.1, type: "episodic" });
      const results = searchSemanticV2(db, { query: "here" });
      expect(results.length).toBe(0);
    });
  });

  describe("consolidateV2", () => {
    it("records a COMPLETED status", () => {
      const r = consolidateV2(db);
      expect(r.status).toBe(CONSOLIDATION_STATUS.COMPLETED);
      expect(r.id).toMatch(/^consol-/);
      expect(r.completedAt).not.toBeNull();
    });

    it("forwards promoted/forgotten from consolidateMemory", () => {
      storeMemory(db, "will promote", { importance: 0.1 });
      const id = [..._working.keys()][0];
      _working.get(id).accessCount = 3;
      const r = consolidateV2(db);
      expect(r.promoted).toBe(1);
    });

    it("extracts patterns from short-term when extractPatterns:true", () => {
      storeMemory(db, "freq semantic", {
        importance: 0.4,
        type: "semantic",
      });
      const id = [..._shortTerm.keys()][0];
      _shortTerm.get(id).accessCount = 4;
      const r = consolidateV2(db, { extractPatterns: true });
      expect(r.patterns.length).toBeGreaterThan(0);
      expect(r.patterns[0].accessCount).toBe(4);
    });

    it("skips pattern extraction without flag", () => {
      storeMemory(db, "freq thing", { importance: 0.4 });
      const id = [..._shortTerm.keys()][0];
      _shortTerm.get(id).accessCount = 4;
      const r = consolidateV2(db);
      expect(r.patterns).toEqual([]);
    });

    it("listConsolidations returns history", () => {
      consolidateV2(db);
      consolidateV2(db);
      expect(listConsolidations().length).toBe(2);
      expect(
        listConsolidations({ status: CONSOLIDATION_STATUS.COMPLETED }).length,
      ).toBe(2);
    });
  });

  describe("pruneV2", () => {
    it("prunes only working layer when scoped", () => {
      storeMemory(db, "stale w", { importance: 0.1 });
      storeMemory(db, "stale st", { importance: 0.4 });
      const wId = [..._working.keys()][0];
      const stId = [..._shortTerm.keys()][0];
      _working.get(wId).lastAccessed = new Date(
        Date.now() - 1000 * 3600 * 100,
      ).toISOString();
      _shortTerm.get(stId).lastAccessed = new Date(
        Date.now() - 1000 * 3600 * 100,
      ).toISOString();

      const r = pruneV2(db, { layer: "working" });
      expect(r.pruned).toBe(1);
      expect(_working.size).toBe(0);
      expect(_shortTerm.size).toBe(1);
    });

    it("throws on invalid layer", () => {
      expect(() => pruneV2(db, { layer: "unknown" })).toThrow(/Invalid layer/);
    });

    it("uses custom threshold", () => {
      storeMemory(db, "fresh", { importance: 0.1 });
      // threshold 1.1 forces even fresh entries to be pruned
      const r = pruneV2(db, { layer: "working", threshold: 1.1 });
      expect(r.pruned).toBe(1);
    });

    it("includes all layers when no layer specified", () => {
      const r = pruneV2(db, { maxAge: 720 });
      expect(r.layer).toBe("all");
      expect(typeof r.pruned).toBe("number");
    });
  });

  describe("consolidation timer lifecycle", () => {
    it("starts and stops a timer", () => {
      const h = startConsolidationTimer({ intervalMs: 60000, db });
      expect(h).toBeDefined();
      const stopped = stopConsolidationTimer();
      expect(stopped).toBe(true);
    });

    it("returns existing handle on double-start", () => {
      const h1 = startConsolidationTimer({ intervalMs: 60000, db });
      const h2 = startConsolidationTimer({ intervalMs: 60000, db });
      expect(h1).toBe(h2);
      stopConsolidationTimer();
    });

    it("requires db parameter", () => {
      expect(() => startConsolidationTimer({ intervalMs: 1000 })).toThrow(
        /db is required/,
      );
    });

    it("stopConsolidationTimer returns false when no timer", () => {
      expect(stopConsolidationTimer()).toBe(false);
    });
  });

  describe("getStatsV2", () => {
    it("exposes per-layer breakdown", () => {
      storeMemory(db, "a", { importance: 0.1 });
      storeMemory(db, "b", { importance: 0.4 });
      const s = getStatsV2(db);
      expect(s.perLayer).toBeDefined();
      expect(s.perLayer.working).toBe(1);
      expect(s.perLayer["short-term"]).toBe(1);
    });

    it("reports consolidation status breakdown", () => {
      consolidateV2(db);
      consolidateV2(db);
      const s = getStatsV2(db);
      expect(s.consolidation.total).toBe(2);
      expect(s.consolidation.byStatus.completed).toBe(2);
      expect(s.consolidation.last).not.toBeNull();
    });

    it("reports share counts including active vs revoked", () => {
      shareMemoryV2(db, { memoryId: "m-1", targetAgent: "a" });
      const r2 = shareMemoryV2(db, { memoryId: "m-2", targetAgent: "b" });
      revokeShare(r2.id);
      const s = getStatsV2(db);
      expect(s.shares.total).toBe(2);
      expect(s.shares.active).toBe(1);
      expect(s.shares.revoked).toBe(1);
    });

    it("counts metadata entries", () => {
      const { id } = storeMemory(db, "x", { importance: 0.1 });
      attachMetadata(id, { scene: "home" });
      const s = getStatsV2(db);
      expect(s.metadataEntries).toBe(1);
    });
  });
});
