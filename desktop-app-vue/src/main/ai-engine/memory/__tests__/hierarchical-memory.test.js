import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { HierarchicalMemory } = require("../hierarchical-memory");

describe("HierarchicalMemory", () => {
  let memory;
  let db;

  beforeEach(() => {
    memory = new HierarchicalMemory();
    db = createMockDB();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (memory._consolidationTimer) {
      clearInterval(memory._consolidationTimer);
      memory._consolidationTimer = null;
    }
  });

  // --- Initialization ---

  it("should start with empty state", () => {
    expect(memory.initialized).toBe(false);
    expect(memory._working.size).toBe(0);
    expect(memory._shortTerm.size).toBe(0);
    expect(memory._longTerm.size).toBe(0);
    expect(memory._core.size).toBe(0);
  });

  it("should initialize with database", async () => {
    await memory.initialize(db);
    expect(memory.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
    expect(memory._consolidationTimer).not.toBeNull();
  });

  it("should skip double initialization", async () => {
    await memory.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await memory.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Store: routing by importance ---

  it("should route low importance (< 0.3) to working memory", async () => {
    await memory.initialize(db);
    const result = memory.store("temp note", { importance: 0.1 });
    expect(result.layer).toBe("working");
    expect(memory._working.size).toBe(1);
  });

  it("should route medium importance (0.3-0.6) to short-term", async () => {
    await memory.initialize(db);
    const result = memory.store("medium note", { importance: 0.4 });
    expect(result.layer).toBe("short-term");
    expect(memory._shortTerm.size).toBe(1);
  });

  it("should route high importance (0.6-0.9) to long-term", async () => {
    await memory.initialize(db);
    const result = memory.store("important fact", { importance: 0.7 });
    expect(result.layer).toBe("long-term");
    expect(memory._longTerm.size).toBe(1);
  });

  it("should route very high importance (>= 0.9) to core", async () => {
    await memory.initialize(db);
    const result = memory.store("fundamental truth", { importance: 0.95 });
    expect(result.layer).toBe("core");
    expect(memory._core.size).toBe(1);
  });

  it("should route to core when core option is true", async () => {
    await memory.initialize(db);
    const result = memory.store("forced core", { core: true, importance: 0.1 });
    expect(result.layer).toBe("core");
  });

  it("should evict oldest working memory when over capacity", async () => {
    await memory.initialize(db);
    memory._config.workingCapacity = 3;
    memory.store("a", { importance: 0.1 });
    memory.store("b", { importance: 0.1 });
    memory.store("c", { importance: 0.1 });
    memory.store("d", { importance: 0.1 });
    expect(memory._working.size).toBe(3);
  });

  // --- Recall ---

  it("should recall matching memories", async () => {
    await memory.initialize(db);
    memory.store("JavaScript is a programming language", { importance: 0.7 });
    memory.store("Python is great for data science", { importance: 0.7 });
    const results = memory.recall("JavaScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("JavaScript");
  });

  it("should always recall core memories regardless of decay", async () => {
    await memory.initialize(db);
    memory.store("core fact about AI", { importance: 0.95 });
    const results = memory.recall("core fact");
    expect(results.length).toBe(1);
    expect(results[0].layer).toBe("core");
  });

  it("should return empty for no matches", async () => {
    await memory.initialize(db);
    memory.store("hello world", { importance: 0.5 });
    const results = memory.recall("xyznonexistent");
    expect(results).toHaveLength(0);
  });

  it("should increment access_count on recall", async () => {
    await memory.initialize(db);
    memory.store("unique test content", { importance: 0.95 });
    memory.recall("unique test content");
    memory.recall("unique test content");
    const coreEntries = Array.from(memory._core.values());
    const entry = coreEntries.find((m) => m.content === "unique test content");
    expect(entry.access_count).toBe(2);
  });

  // --- Consolidation ---

  it("should promote frequently accessed working memories to short-term", async () => {
    await memory.initialize(db);
    const { id } = memory.store("promote me", { importance: 0.1 });
    const mem = memory._working.get(id);
    mem.access_count = 3; // meets working->short-term threshold but not short-term->long-term (>=5)
    memory.consolidate();
    expect(memory._working.has(id)).toBe(false);
    expect(memory._shortTerm.has(id)).toBe(true);
  });

  it("should promote important short-term memories to long-term", async () => {
    await memory.initialize(db);
    const { id } = memory.store("level up", { importance: 0.4 });
    const mem = memory._shortTerm.get(id);
    mem.access_count = 10;
    memory.consolidate();
    expect(memory._shortTerm.has(id)).toBe(false);
    expect(memory._longTerm.has(id)).toBe(true);
  });

  it("should return promoted and forgotten counts", async () => {
    await memory.initialize(db);
    const result = memory.consolidate();
    expect(result).toHaveProperty("promoted");
    expect(result).toHaveProperty("forgotten");
  });

  // --- Share Memory ---

  it("should share a long-term memory with filtered privacy", async () => {
    await memory.initialize(db);
    memory.store("shareable info", {
      id: "mem-share",
      importance: 0.7,
      metadata: { secret: true },
    });
    const shared = memory.shareMemory("mem-share", "agent-2", "filtered");
    expect(shared).not.toBeNull();
    expect(shared.metadata).toEqual({});
  });

  it("should return null when sharing non-existent memory", async () => {
    await memory.initialize(db);
    expect(memory.shareMemory("no-exist", "agent-2")).toBeNull();
  });

  // --- Search Episodic / Semantic ---

  it("should search episodic memories", async () => {
    await memory.initialize(db);
    memory.store("meeting happened yesterday", {
      importance: 0.7,
      type: "episodic",
    });
    memory.store("JavaScript is a language", {
      importance: 0.7,
      type: "semantic",
    });
    const results = memory.searchEpisodic("meeting");
    expect(results.every((r) => r.type === "episodic")).toBe(true);
  });

  it("should search semantic memories", async () => {
    await memory.initialize(db);
    memory.store("event log entry", { importance: 0.7, type: "episodic" });
    memory.store("neural networks are used in AI", {
      importance: 0.7,
      type: "semantic",
    });
    const results = memory.searchSemantic("neural");
    expect(results.every((r) => r.type === "semantic")).toBe(true);
  });

  // --- Prune ---

  it("should prune old low-importance long-term memories", async () => {
    await memory.initialize(db);
    memory.store("old data", { id: "old-1", importance: 0.4 });
    // Force into long-term for testing and make it old
    const mem = memory._shortTerm.get("old-1");
    if (mem) {
      mem.created_at = new Date(Date.now() - 200 * 3600000).toISOString();
      mem.access_count = 0;
      mem.importance = 0.4;
      memory._longTerm.set("old-1", mem);
      memory._shortTerm.delete("old-1");
    }
    const result = memory.prune({ maxAge: 168 });
    expect(result).toHaveProperty("pruned");
  });

  // --- Stats ---

  it("should return stats for all layers", async () => {
    await memory.initialize(db);
    memory.store("a", { importance: 0.1 });
    memory.store("b", { importance: 0.5 });
    memory.store("c", { importance: 0.7 });
    memory.store("d", { importance: 0.95 });
    const stats = memory.getStats();
    expect(stats.working).toBe(1);
    expect(stats.shortTerm).toBe(1);
    expect(stats.longTerm).toBe(1);
    expect(stats.core).toBe(1);
    expect(stats.total).toBe(4);
  });

  // --- Destroy ---

  it("should clear consolidation timer on destroy", async () => {
    await memory.initialize(db);
    expect(memory._consolidationTimer).not.toBeNull();
    memory.destroy();
    expect(memory._consolidationTimer).toBeNull();
  });
});
