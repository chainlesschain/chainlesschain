/**
 * TimeMachine Unit Tests
 *
 * Covers:
 * - initialize() table creation and idempotency
 * - getTimelinePosts() by full date, year-only, queries
 * - getOnThisDay() cross-year month-day pattern queries
 * - getMilestones() type-filtered memory retrieval
 * - getMemories() with default and custom limits
 * - markMemoryRead() success, event emission, and not-found error
 * - createSnapshot() insertion, event emission, and return shape
 * - getTimelineRange() date-range bounded queries
 * - getYearSummary() monthly breakdown structure
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

// ─── Module under test ────────────────────────────────────────────────────────
const { TimeMachine } = require("../time-machine.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockInnerDb() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
}

/**
 * The TimeMachine expects `database.db` (a nested db object).
 */
function createMockDatabase() {
  const innerDb = createMockInnerDb();
  return {
    db: innerDb,
    _inner: innerDb,
  };
}

function makeSnapshotRow(overrides = {}) {
  return {
    id: "snap-001",
    source_type: "post",
    source_id: "post-123",
    snapshot_date: "2023-06-15",
    content_preview: "Today was a great day!",
    media_urls: null,
    created_at: 1686787200000,
    ...overrides,
  };
}

function makeMemoryRow(overrides = {}) {
  return {
    id: "mem-001",
    memory_type: "on_this_day",
    title: "One year ago",
    description: "You posted this photo",
    cover_image: null,
    related_posts: null,
    target_date: "2023-06-15",
    generated_at: 1686787200000,
    is_read: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TimeMachine", () => {
  let machine;
  let mockDb;
  let innerDb;

  beforeEach(() => {
    uuidCounter = 0;
    mockDb = createMockDatabase();
    innerDb = mockDb._inner;
    machine = new TimeMachine(mockDb);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should store the database reference and start uninitialized", () => {
      expect(machine.database).toBe(mockDb);
      expect(machine.initialized).toBe(false);
    });

    it("should be an EventEmitter (has on and emit methods)", () => {
      expect(typeof machine.on).toBe("function");
      expect(typeof machine.emit).toBe("function");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should call db.exec to create timeline_snapshots table", async () => {
      await machine.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasSnapshotTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS timeline_snapshots"),
      );
      expect(hasSnapshotTable).toBe(true);
    });

    it("should call db.exec to create social_memories table", async () => {
      await machine.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasMemoriesTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS social_memories"),
      );
      expect(hasMemoriesTable).toBe(true);
    });

    it("should create indexes for timeline_snapshots", async () => {
      await machine.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasIndex = execCalls.some((sql) =>
        sql.includes("idx_timeline_snapshots_date"),
      );
      expect(hasIndex).toBe(true);
    });

    it("should create indexes for social_memories", async () => {
      await machine.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasIndex = execCalls.some((sql) =>
        sql.includes("idx_social_memories_type"),
      );
      expect(hasIndex).toBe(true);
    });

    it("should set initialized to true after success", async () => {
      await machine.initialize();
      expect(machine.initialized).toBe(true);
    });

    it("should be idempotent – second call skips table creation", async () => {
      await machine.initialize();
      const firstExecCount = innerDb.exec.mock.calls.length;

      await machine.initialize();
      // exec call count must not grow on the second call
      expect(innerDb.exec.mock.calls.length).toBe(firstExecCount);
    });

    it("should propagate db.exec errors and leave initialized as false", async () => {
      innerDb.exec.mockImplementationOnce(() => {
        throw new Error("DB schema error");
      });

      await expect(machine.initialize()).rejects.toThrow("DB schema error");
      expect(machine.initialized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTimelinePosts()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTimelinePosts()", () => {
    it("should call prepare with a query referencing snapshot_date", async () => {
      await machine.getTimelinePosts(2023, 6, 15);

      expect(innerDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("timeline_snapshots"),
      );
    });

    it("should pass the formatted date to .all()", async () => {
      await machine.getTimelinePosts(2023, 6, 15);

      expect(innerDb._prep.all).toHaveBeenCalledWith("2023-06-15");
    });

    it("should zero-pad single-digit month and day", async () => {
      await machine.getTimelinePosts(2023, 1, 5);

      expect(innerDb._prep.all).toHaveBeenCalledWith("2023-01-05");
    });

    it("should return rows with media_urls parsed from JSON", async () => {
      const row = makeSnapshotRow({
        media_urls: JSON.stringify(["https://cdn.example.com/img1.jpg"]),
      });
      innerDb._prep.all.mockReturnValueOnce([row]);

      const results = await machine.getTimelinePosts(2023, 6, 15);

      expect(results).toHaveLength(1);
      expect(results[0].media_urls).toEqual(["https://cdn.example.com/img1.jpg"]);
    });

    it("should return empty array when no rows match", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);

      const results = await machine.getTimelinePosts(2023, 12, 31);
      expect(results).toEqual([]);
    });

    it("should default media_urls to [] when column is null", async () => {
      innerDb._prep.all.mockReturnValueOnce([makeSnapshotRow({ media_urls: null })]);

      const results = await machine.getTimelinePosts(2023, 6, 15);
      expect(results[0].media_urls).toEqual([]);
    });

    it("should return multiple rows in order received from DB", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        makeSnapshotRow({ id: "snap-001", content_preview: "first" }),
        makeSnapshotRow({ id: "snap-002", content_preview: "second" }),
      ]);

      const results = await machine.getTimelinePosts(2023, 6, 15);
      expect(results).toHaveLength(2);
      expect(results[0].content_preview).toBe("first");
      expect(results[1].content_preview).toBe("second");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getOnThisDay()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getOnThisDay()", () => {
    it("should call prepare with a query on timeline_snapshots", async () => {
      await machine.getOnThisDay(6, 15);

      expect(innerDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("timeline_snapshots"),
      );
    });

    it("should pass month-day pattern and current-year exclusion to .all()", async () => {
      const currentYear = new Date().getFullYear();
      await machine.getOnThisDay(6, 15);

      expect(innerDb._prep.all).toHaveBeenCalledWith(
        "%-06-15",
        `${currentYear}-%`,
      );
    });

    it("should zero-pad single-digit month and day in the pattern", async () => {
      const currentYear = new Date().getFullYear();
      await machine.getOnThisDay(3, 7);

      expect(innerDb._prep.all).toHaveBeenCalledWith(
        "%-03-07",
        `${currentYear}-%`,
      );
    });

    it("should return rows with media_urls parsed", async () => {
      const row = makeSnapshotRow({
        snapshot_date: "2022-06-15",
        media_urls: JSON.stringify(["https://img.example.com/pic.png"]),
      });
      innerDb._prep.all.mockReturnValueOnce([row]);

      const results = await machine.getOnThisDay(6, 15);
      expect(results[0].media_urls).toEqual(["https://img.example.com/pic.png"]);
    });

    it("should return empty array when no historical matches exist", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const results = await machine.getOnThisDay(2, 29);
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getMilestones()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getMilestones()", () => {
    it("should query social_memories filtered by type milestone", async () => {
      await machine.getMilestones();

      const prepSql = innerDb.prepare.mock.calls[0][0];
      expect(prepSql).toContain("social_memories");
      expect(prepSql).toContain("milestone");
    });

    it("should return milestone rows with related_posts parsed", async () => {
      const row = makeMemoryRow({
        memory_type: "milestone",
        related_posts: JSON.stringify(["post-1", "post-2"]),
      });
      innerDb._prep.all.mockReturnValueOnce([row]);

      const results = await machine.getMilestones();
      expect(results).toHaveLength(1);
      expect(results[0].memory_type).toBe("milestone");
      expect(results[0].related_posts).toEqual(["post-1", "post-2"]);
    });

    it("should default related_posts to [] when null", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        makeMemoryRow({ memory_type: "milestone", related_posts: null }),
      ]);

      const results = await machine.getMilestones();
      expect(results[0].related_posts).toEqual([]);
    });

    it("should return empty array when no milestones exist", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const results = await machine.getMilestones();
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getMemories()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getMemories()", () => {
    it("should use default limit of 20 when called with no arguments", async () => {
      await machine.getMemories();

      expect(innerDb._prep.all).toHaveBeenCalledWith(20);
    });

    it("should use custom limit when provided", async () => {
      await machine.getMemories(5);

      expect(innerDb._prep.all).toHaveBeenCalledWith(5);
    });

    it("should query social_memories ordered by generated_at", async () => {
      await machine.getMemories();

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("social_memories");
      expect(sql.toLowerCase()).toContain("generated_at");
    });

    it("should return rows with related_posts parsed", async () => {
      const row = makeMemoryRow({
        related_posts: JSON.stringify(["post-99"]),
      });
      innerDb._prep.all.mockReturnValueOnce([row]);

      const results = await machine.getMemories();
      expect(results[0].related_posts).toEqual(["post-99"]);
    });

    it("should return empty array when no memories exist", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const results = await machine.getMemories(10);
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // markMemoryRead()
  // ─────────────────────────────────────────────────────────────────────────
  describe("markMemoryRead()", () => {
    it("should call prepare with an UPDATE setting is_read = 1", async () => {
      innerDb._prep.run.mockReturnValueOnce({ changes: 1 });

      await machine.markMemoryRead("mem-001");

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("UPDATE social_memories");
      expect(sql).toContain("is_read = 1");
    });

    it("should pass the memory id to .run()", async () => {
      innerDb._prep.run.mockReturnValueOnce({ changes: 1 });

      await machine.markMemoryRead("mem-42");

      expect(innerDb._prep.run).toHaveBeenCalledWith("mem-42");
    });

    it("should emit memory:read event with the id", async () => {
      innerDb._prep.run.mockReturnValueOnce({ changes: 1 });

      const spy = vi.fn();
      machine.on("memory:read", spy);

      await machine.markMemoryRead("mem-001");

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({ id: "mem-001" });
    });

    it("should return { success: true } on success", async () => {
      innerDb._prep.run.mockReturnValueOnce({ changes: 1 });

      const result = await machine.markMemoryRead("mem-001");
      expect(result).toEqual({ success: true });
    });

    it("should throw 'Memory not found' when changes === 0", async () => {
      innerDb._prep.run.mockReturnValueOnce({ changes: 0 });

      await expect(machine.markMemoryRead("nonexistent")).rejects.toThrow(
        "Memory not found",
      );
    });

    it("should NOT emit memory:read when the memory is not found", async () => {
      innerDb._prep.run.mockReturnValueOnce({ changes: 0 });

      const spy = vi.fn();
      machine.on("memory:read", spy);

      try {
        await machine.markMemoryRead("ghost");
      } catch (_) {
        /* expected */
      }

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createSnapshot()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createSnapshot()", () => {
    it("should call prepare with INSERT INTO timeline_snapshots", async () => {
      await machine.createSnapshot("post", "post-123", "2023-06-15", "Hello world");

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("INSERT INTO timeline_snapshots");
    });

    it("should pass all fields to .run()", async () => {
      await machine.createSnapshot("post", "post-123", "2023-06-15", "Hello world", []);

      expect(innerDb._prep.run).toHaveBeenCalledWith(
        expect.any(String), // id (uuid)
        "post",
        "post-123",
        "2023-06-15",
        "Hello world",
        null, // empty mediaUrls => null
        expect.any(Number), // created_at
      );
    });

    it("should serialize non-empty mediaUrls as JSON", async () => {
      const urls = ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"];
      await machine.createSnapshot("event", "evt-1", "2023-06-15", "A caption", urls);

      const runArgs = innerDb._prep.run.mock.calls[0];
      expect(runArgs[5]).toBe(JSON.stringify(urls));
    });

    it("should emit snapshot:created with the snapshot object", async () => {
      const spy = vi.fn();
      machine.on("snapshot:created", spy);

      await machine.createSnapshot("message", "msg-1", "2023-06-15", "Hey there");

      expect(spy).toHaveBeenCalledOnce();
      const { snapshot } = spy.mock.calls[0][0];
      expect(snapshot.source_type).toBe("message");
      expect(snapshot.source_id).toBe("msg-1");
      expect(snapshot.snapshot_date).toBe("2023-06-15");
    });

    it("should return the snapshot object with correct shape", async () => {
      const result = await machine.createSnapshot(
        "post",
        "post-456",
        "2024-01-01",
        "Happy New Year",
        ["https://cdn.example.com/nye.jpg"],
      );

      expect(result).toMatchObject({
        source_type: "post",
        source_id: "post-456",
        snapshot_date: "2024-01-01",
        content_preview: "Happy New Year",
        media_urls: ["https://cdn.example.com/nye.jpg"],
      });
      expect(result.id).toBeTruthy();
      expect(result.created_at).toBeGreaterThan(0);
    });

    it("should default mediaUrls to [] when omitted", async () => {
      const result = await machine.createSnapshot("post", "post-789", "2024-03-01", "Simple post");
      expect(result.media_urls).toEqual([]);
    });

    it("should set content_preview to null when preview is falsy", async () => {
      await machine.createSnapshot("post", "post-0", "2024-03-01", "");

      const runArgs = innerDb._prep.run.mock.calls[0];
      // preview || null → "" becomes null
      expect(runArgs[4]).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTimelineRange()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTimelineRange()", () => {
    it("should call prepare with a query that includes BETWEEN-style bounds", async () => {
      await machine.getTimelineRange("2023-01-01", "2023-12-31");

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("timeline_snapshots");
      expect(sql).toContain("snapshot_date");
    });

    it("should pass startDate and endDate to .all()", async () => {
      await machine.getTimelineRange("2023-06-01", "2023-06-30");

      expect(innerDb._prep.all).toHaveBeenCalledWith("2023-06-01", "2023-06-30");
    });

    it("should return rows with media_urls parsed", async () => {
      const row = makeSnapshotRow({
        snapshot_date: "2023-06-10",
        media_urls: JSON.stringify(["https://img.example.com/x.png"]),
      });
      innerDb._prep.all.mockReturnValueOnce([row]);

      const results = await machine.getTimelineRange("2023-06-01", "2023-06-30");
      expect(results[0].media_urls).toEqual(["https://img.example.com/x.png"]);
    });

    it("should return empty array when no snapshots fall in the range", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const results = await machine.getTimelineRange("2099-01-01", "2099-12-31");
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getYearSummary()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getYearSummary()", () => {
    function setupYearSummaryMocks({
      totalCount = 0,
      monthlyRows = [],
      sourceBreakdown = [],
      memoriesCount = 0,
    } = {}) {
      // Each internal prepare().get or prepare().all call in getYearSummary
      // happens in order:
      //   1. COUNT(*) total => get()
      //   2. monthly breakdown => all()
      //   3. source breakdown => all()
      //   4. memories count => get()
      const prepResult = innerDb._prep;
      let getCallCount = 0;
      let allCallCount = 0;

      prepResult.get.mockImplementation(() => {
        getCallCount++;
        if (getCallCount === 1) return { total: totalCount };
        if (getCallCount === 2) return { count: memoriesCount };
        return null;
      });

      prepResult.all.mockImplementation(() => {
        allCallCount++;
        if (allCallCount === 1) return monthlyRows;
        if (allCallCount === 2) return sourceBreakdown;
        return [];
      });
    }

    it("should return an object with year, totalSnapshots, memoriesCount, months, sourceBreakdown", async () => {
      setupYearSummaryMocks({ totalCount: 42 });

      const summary = await machine.getYearSummary(2023);

      expect(summary).toHaveProperty("year", 2023);
      expect(summary).toHaveProperty("totalSnapshots");
      expect(summary).toHaveProperty("memoriesCount");
      expect(summary).toHaveProperty("months");
      expect(summary).toHaveProperty("sourceBreakdown");
    });

    it("should include all 12 month keys in months object", async () => {
      setupYearSummaryMocks();

      const summary = await machine.getYearSummary(2023);

      expect(Object.keys(summary.months)).toHaveLength(12);
      for (let i = 1; i <= 12; i++) {
        const key = String(i).padStart(2, "0");
        expect(summary.months).toHaveProperty(key);
      }
    });

    it("should aggregate post/message/event counts per month", async () => {
      setupYearSummaryMocks({
        totalCount: 5,
        monthlyRows: [
          { month: "06", count: 3, source_type: "post" },
          { month: "06", count: 2, source_type: "message" },
        ],
      });

      const summary = await machine.getYearSummary(2023);

      expect(summary.months["06"].posts).toBe(3);
      expect(summary.months["06"].messages).toBe(2);
      expect(summary.months["06"].total).toBe(5);
    });

    it("should reflect totalSnapshots from DB count query", async () => {
      setupYearSummaryMocks({ totalCount: 100 });

      const summary = await machine.getYearSummary(2023);
      expect(summary.totalSnapshots).toBe(100);
    });

    it("should reflect memoriesCount from DB count query", async () => {
      setupYearSummaryMocks({ memoriesCount: 7 });

      const summary = await machine.getYearSummary(2023);
      expect(summary.memoriesCount).toBe(7);
    });

    it("should return 0 counts when no snapshots exist for the year", async () => {
      setupYearSummaryMocks({ totalCount: 0 });

      const summary = await machine.getYearSummary(2030);

      expect(summary.totalSnapshots).toBe(0);
      expect(summary.months["01"].total).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // close()
  // ─────────────────────────────────────────────────────────────────────────
  describe("close()", () => {
    it("should set initialized to false", async () => {
      await machine.initialize();
      expect(machine.initialized).toBe(true);

      await machine.close();
      expect(machine.initialized).toBe(false);
    });

    it("should remove all event listeners", async () => {
      const spy = vi.fn();
      machine.on("snapshot:created", spy);

      await machine.close();

      machine.emit("snapshot:created", {});
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
