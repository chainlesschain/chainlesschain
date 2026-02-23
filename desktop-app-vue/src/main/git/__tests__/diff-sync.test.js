/**
 * Differential Sync Unit Tests
 * Covers: Adler32, RabinChunker, FileDiffEngine, GCounter, PNCounter, ORSet, DbDiffTracker, DiffSyncManager
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-diff-1234") }));

const {
  FileDiffEngine,
  Adler32,
  RabinChunker,
} = require("../diff-sync/file-diff-engine.js");

const {
  GCounter,
  PNCounter,
  ORSet,
  DbDiffTracker,
} = require("../diff-sync/db-diff-tracker.js");

const { DiffSyncManager } = require("../diff-sync/index.js");

// ─── Adler32 ─────────────────────────────────────────────────────────────────

describe("Adler32", () => {
  it("initializes with a=1, b=0", () => {
    const adler = new Adler32();
    const data = Buffer.from("abc");
    adler.init(data, 0, 3);
    expect(adler.digest()).toBeGreaterThan(0);
  });

  it("same data produces same checksum", () => {
    const a1 = new Adler32();
    const a2 = new Adler32();
    const data = Buffer.from("hello world test data");
    a1.init(data, 0, data.length);
    a2.init(data, 0, data.length);
    expect(a1.digest()).toBe(a2.digest());
  });

  it("different data produces different checksums", () => {
    const a1 = new Adler32();
    const a2 = new Adler32();
    const d1 = Buffer.from("hello");
    const d2 = Buffer.from("world");
    a1.init(d1, 0, d1.length);
    a2.init(d2, 0, d2.length);
    expect(a1.digest()).not.toBe(a2.digest());
  });

  it("roll updates checksum correctly", () => {
    const adler = new Adler32();
    const data = Buffer.from("abcde");
    adler.init(data, 0, 3); // "abc"
    const before = adler.digest();
    adler.roll(data[0], data[3]); // slide from "abc" to "bcd"
    const after = adler.digest();
    expect(after).not.toBe(before);
  });
});

// ─── RabinChunker ─────────────────────────────────────────────────────────────

describe("RabinChunker", () => {
  it("chunks data into variable-size pieces", () => {
    const data = Buffer.alloc(20000, 0x42); // 20KB of same byte
    const chunks = RabinChunker.chunk(data);
    expect(chunks.length).toBeGreaterThan(0);
    // Each chunk has offset and length
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty("offset");
      expect(chunk).toHaveProperty("length");
      expect(chunk.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("produces consistent chunks for same input", () => {
    const data = Buffer.from("hello world this is test data for chunking");
    const chunks1 = RabinChunker.chunk(data);
    const chunks2 = RabinChunker.chunk(data);
    expect(chunks1.length).toBe(chunks2.length);
    chunks1.forEach((c, i) => {
      expect(c.offset).toBe(chunks2[i].offset);
      expect(c.length).toBe(chunks2[i].length);
    });
  });

  it("handles empty buffer", () => {
    const chunks = RabinChunker.chunk(Buffer.alloc(0));
    expect(chunks).toEqual([]);
  });
});

// ─── FileDiffEngine ───────────────────────────────────────────────────────────

describe("FileDiffEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new FileDiffEngine();
  });

  it("generateSignature returns signature array", () => {
    const data = Buffer.from("hello world this is test content for diff engine");
    const sig = engine.generateSignature(data);
    expect(Array.isArray(sig)).toBe(true);
    expect(sig.length).toBeGreaterThan(0);
    expect(sig[0]).toHaveProperty("weakHash");
    expect(sig[0]).toHaveProperty("strongHash");
  });

  it("generateDelta returns delta object with instructions", () => {
    const source = Buffer.from("hello world");
    const target = Buffer.from("hello changed world");
    const sig = engine.generateSignature(source);
    const delta = engine.generateDelta(target, sig);
    expect(delta).toHaveProperty("instructions");
    expect(Array.isArray(delta.instructions)).toBe(true);
  });

  it("applyDelta reconstructs target from source + delta", () => {
    const source = Buffer.from("the quick brown fox");
    const target = Buffer.from("the quick red fox");
    const sig = engine.generateSignature(source);
    const delta = engine.generateDelta(target, sig);
    const reconstructed = engine.applyDelta(source, delta);
    expect(reconstructed.toString()).toBe(target.toString());
  });

  it("applyDelta identity: same content produces same output", () => {
    const data = Buffer.from("no changes here");
    const sig = engine.generateSignature(data);
    const delta = engine.generateDelta(data, sig);
    const result = engine.applyDelta(data, delta);
    expect(result.toString()).toBe(data.toString());
  });

  it("DeduplicationIndex tracks blocks across files", () => {
    const engine2 = new FileDiffEngine();
    const data1 = Buffer.from("shared content block that is long enough to be chunked properly yes");
    const data2 = Buffer.from("shared content block that is long enough to be chunked properly yes");
    engine2.indexForDedup("file1", data1);
    const result = engine2.checkDedup(data2);
    // checkDedup returns { newBlocks, existingBlocks }
    expect(result).toHaveProperty("newBlocks");
    expect(result).toHaveProperty("existingBlocks");
    expect(Array.isArray(result.existingBlocks)).toBe(true);
  });
});

// ─── GCounter ─────────────────────────────────────────────────────────────────

describe("GCounter", () => {
  it("starts at 0 for its own node", () => {
    const c = new GCounter("node1");
    expect(c.value()).toBe(0);
  });

  it("increment increases value", () => {
    const c = new GCounter("node1");
    c.increment(3);
    expect(c.value()).toBe(3);
  });

  it("increment is chainable", () => {
    const c = new GCounter("node1");
    c.increment(1).increment(2);
    expect(c.value()).toBe(3);
  });

  it("merge takes max per node", () => {
    const c1 = new GCounter("n1", { n1: 5, n2: 2 });
    const c2 = new GCounter("n1", { n1: 3, n2: 7 });
    c1.merge(c2);
    expect(c1.value()).toBe(12); // max(5,3) + max(2,7)
  });

  it("merge is idempotent", () => {
    const c1 = new GCounter("n1");
    c1.increment(5);
    const c2 = new GCounter("n2");
    c2.increment(3);
    c1.merge(c2);
    const v1 = c1.value();
    c1.merge(c2); // merge again
    expect(c1.value()).toBe(v1);
  });

  it("toJSON and fromJSON round-trip", () => {
    const c = new GCounter("node1");
    c.increment(10);
    const json = c.toJSON();
    const c2 = GCounter.fromJSON("node1", json);
    expect(c2.value()).toBe(c.value());
  });
});

// ─── PNCounter ─────────────────────────────────────────────────────────────────

describe("PNCounter", () => {
  it("starts at 0", () => {
    const c = new PNCounter("n1");
    expect(c.value()).toBe(0);
  });

  it("increment and decrement", () => {
    const c = new PNCounter("n1");
    c.increment(5).decrement(2);
    expect(c.value()).toBe(3);
  });

  it("can go negative", () => {
    const c = new PNCounter("n1");
    c.decrement(3);
    expect(c.value()).toBe(-3);
  });

  it("merge combines counters", () => {
    const c1 = new PNCounter("n1");
    c1.increment(10);
    const c2 = new PNCounter("n2");
    c2.increment(5).decrement(2);
    c1.merge(c2);
    expect(c1.value()).toBe(13); // 10 + (5-2)
  });

  it("toJSON and fromJSON round-trip", () => {
    const c = new PNCounter("n1");
    c.increment(7).decrement(3);
    const json = c.toJSON();
    const c2 = PNCounter.fromJSON("n1", json);
    expect(c2.value()).toBe(c.value());
  });
});

// ─── ORSet ────────────────────────────────────────────────────────────────────

describe("ORSet", () => {
  it("add then has returns true", () => {
    const s = new ORSet("n1");
    s.add("apple");
    expect(s.has("apple")).toBe(true);
  });

  it("remove after add: has returns false", () => {
    const s = new ORSet("n1");
    s.add("apple");
    s.remove("apple");
    expect(s.has("apple")).toBe(false);
  });

  it("values() returns all elements", () => {
    const s = new ORSet("n1");
    s.add("a").add("b").add("c");
    s.remove("b");
    expect(s.values()).toContain("a");
    expect(s.values()).toContain("c");
    expect(s.values()).not.toContain("b");
  });

  it("merge: concurrent add on different nodes both survive", () => {
    const s1 = new ORSet("n1");
    s1.add("x");
    const s2 = new ORSet("n2");
    s2.add("y");
    s1.merge(s2);
    expect(s1.has("x")).toBe(true);
    expect(s1.has("y")).toBe(true);
  });

  it("add-wins semantics: re-add after remove wins on merge", () => {
    const s1 = new ORSet("n1");
    s1.add("item");
    // Simulate s2 removing item (same tag set) and s1 re-adding
    const s2 = new ORSet("n2");
    s2.merge(s1); // s2 knows about "item"
    s2.remove("item");
    s1.add("item"); // s1 re-adds with new tag
    s1.merge(s2);
    // s1 re-added item so it should still be present
    expect(s1.has("item")).toBe(true);
  });
});

// ─── DbDiffTracker ────────────────────────────────────────────────────────────

describe("DbDiffTracker", () => {
  let tracker;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      exec: vi.fn(),
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
      }),
    };
    tracker = new DbDiffTracker({ database: mockDb, nodeId: "node-test" });
  });

  it("initialize completes without error", async () => {
    await expect(tracker.initialize()).resolves.not.toThrow();
  });

  it("trackTable installs triggers for a table", async () => {
    // Mock PRAGMA table_info to return columns so triggers get installed
    mockDb.all.mockReturnValue([{ name: "id", pk: 1 }, { name: "content", pk: 0 }]);
    await tracker.trackTable("notes");
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("notes"),
    );
  });

  it("getChangesSince returns rows from db", () => {
    mockDb.all.mockReturnValue([
      { id: 1, table_name: "notes", operation: "INSERT" },
    ]);
    const changes = tracker.getChangesSince(0);
    expect(changes.length).toBe(1);
  });

  it("compactChangelog calls db when duplicates exist", async () => {
    // Setup: db.all returns duplicate rows to trigger compaction
    mockDb.all
      .mockReturnValueOnce([{ table_name: "notes", row_id: "1", change_count: 2, latest_version: 2 }])
      .mockReturnValueOnce([
        { id: "c1", table_name: "notes", row_id: "1", operation: "INSERT", version: 1 },
        { id: "c2", table_name: "notes", row_id: "1", operation: "UPDATE", version: 2 },
      ]);
    await tracker.compactChangelog();
    expect(mockDb.run).toHaveBeenCalled();
  });

  it("getCounter creates and returns a GCounter", () => {
    const counter = tracker.getCounter("views");
    expect(counter).toBeInstanceOf(GCounter);
  });

  it("getSet creates and returns an ORSet", () => {
    const set = tracker.getSet("tags");
    expect(set).toBeInstanceOf(ORSet);
  });
});

// ─── DiffSyncManager ──────────────────────────────────────────────────────────

describe("DiffSyncManager", () => {
  let manager;

  beforeEach(() => {
    manager = new DiffSyncManager({});
  });

  it("creates instance with default config", () => {
    expect(manager).toBeDefined();
    expect(manager.config).toBeDefined();
  });

  it("selectStrategy returns a strategy string", () => {
    const strategy = manager.selectStrategy({
      fileType: "text",
      fileSize: 1000,
    });
    expect(typeof strategy).toBe("string");
    expect(["full", "thin-pack", "rsync-delta", "crdt-merge"]).toContain(
      strategy,
    );
  });

  it("selectStrategy returns rsync-delta for large binary files", () => {
    const strategy = manager.selectStrategy({
      filePath: "photo.jpg",
      fileSize: 5 * 1024 * 1024,
    });
    expect(strategy).toBe("rsync-delta");
  });

  it("selectStrategy returns full or thin-pack for small files", () => {
    const strategy = manager.selectStrategy({
      fileType: "text",
      fileSize: 100,
    });
    expect(["full", "thin-pack"]).toContain(strategy);
  });
});
