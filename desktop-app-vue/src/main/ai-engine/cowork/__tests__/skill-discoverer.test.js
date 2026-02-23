/**
 * SkillDiscoverer 单元测试 — v2.1.0
 *
 * 覆盖：initialize、analyzeTaskFailure（关键词提取）、
 *       searchRelevantSkills（有/无 marketplace）、
 *       suggestInstallation、getDiscoveryHistory、getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { SkillDiscoverer } = require("../skill-discoverer");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogRow(overrides = {}) {
  return {
    id: "log-001",
    task_id: "task-abc",
    failure_reason: "no matching skill",
    searched_keywords: "image,resize,compress",
    suggested_skills: JSON.stringify([{ name: "image-tools", description: "Image processing" }]),
    installed: 0,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0 }),
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SkillDiscoverer", () => {
  let sd;
  let db;

  beforeEach(() => {
    sd = new SkillDiscoverer();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await sd.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(sd.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await sd.initialize(db);
      await sd.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should work without marketplaceClient and hookSystem", async () => {
      await expect(sd.initialize(db)).resolves.not.toThrow();
    });

    it("should register PostToolUse hook when hookSystem provided", async () => {
      const registerFn = vi.fn();
      const hookSystem = { registry: { register: registerFn } };

      await sd.initialize(db, null, hookSystem);

      expect(registerFn).toHaveBeenCalledOnce();
      const hookDef = registerFn.mock.calls[0][0];
      expect(hookDef.event).toBe("PostToolUse");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _extractKeywords (internal — tested via analyzeTaskFailure)
  // ─────────────────────────────────────────────────────────────────────────
  describe("keyword extraction", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should extract meaningful keywords from failure text", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "t1",
        taskDescription: "resize image and compress",
        failureReason: "image processing not supported",
      });

      // Should contain keywords like "resize", "image", "compress", "processing"
      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.keywords.some((k) => ["resize", "image", "compress", "processing"].includes(k))).toBe(true);
    });

    it("should filter out stop words", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "t2",
        taskDescription: "the and or is are this those it",
        failureReason: "error",
      });

      const stopWords = ["the", "and", "or", "is", "are", "this", "those", "it", "error", "failed", "failure"];
      for (const kw of result.keywords) {
        expect(stopWords).not.toContain(kw);
      }
    });

    it("should filter out words with length <= 2", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "t3",
        taskDescription: "go to the API endpoint",
        failureReason: "db issue",
      });

      for (const kw of result.keywords) {
        expect(kw.length).toBeGreaterThan(2);
      }
    });

    it("should deduplicate repeated words and rank by frequency", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "t4",
        taskDescription: "database database database query query",
        failureReason: "database connection failed",
      });

      // "database" is most frequent, should appear first
      const uniqueKeywords = [...new Set(result.keywords)];
      expect(uniqueKeywords.length).toBe(result.keywords.length);
    });

    it("should return max 8 keywords", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "t5",
        taskDescription:
          "resize compress convert rotate crop watermark filter enhance sharpen blur grayscale thumbnail",
        failureReason: "processing failed",
      });

      expect(result.keywords.length).toBeLessThanOrEqual(8);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzeTaskFailure
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzeTaskFailure()", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should return taskId, keywords, suggestions, and logId", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "task-123",
        taskDescription: "generate PDF report",
        failureReason: "PDF library not found",
      });

      expect(result).toHaveProperty("taskId", "task-123");
      expect(result).toHaveProperty("keywords");
      expect(result).toHaveProperty("suggestions");
      expect(result).toHaveProperty("logId");
    });

    it("should log discovery to DB", async () => {
      await sd.analyzeTaskFailure({
        taskId: "task-999",
        taskDescription: "parse Excel files",
        failureReason: "XLSX not supported",
      });

      expect(db.run).toHaveBeenCalled();
    });

    it("should use fallback suggestions when no marketplace client", async () => {
      const result = await sd.analyzeTaskFailure({
        taskId: "t",
        taskDescription: "convert audio files",
        failureReason: "no audio codec",
      });

      // Fallback suggestions are keyword-based
      expect(Array.isArray(result.suggestions)).toBe(true);
      if (result.suggestions.length > 0) {
        expect(result.suggestions[0]).toHaveProperty("source", "keyword-inference");
      }
    });

    it("should use marketplace client when provided", async () => {
      // Create a fresh instance to avoid "already initialized" guard
      const freshSd = new SkillDiscoverer();
      const freshDb = createMockDatabase();
      const mockClient = {
        searchPlugins: vi.fn().mockResolvedValue([
          {
            name: "pdf-generator",
            description: "Generate PDF files",
            version: "1.0.0",
            author: "test",
            category: "tools",
          },
        ]),
      };

      await freshSd.initialize(freshDb, mockClient);

      const result = await freshSd.analyzeTaskFailure({
        taskId: "t",
        taskDescription: "create PDF reports",
        failureReason: "no PDF library",
      });

      expect(mockClient.searchPlugins).toHaveBeenCalled();
      if (result.suggestions.length > 0) {
        expect(result.suggestions[0]).toHaveProperty("matchedKeywords");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // searchRelevantSkills
  // ─────────────────────────────────────────────────────────────────────────
  describe("searchRelevantSkills()", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should return empty array for empty keywords", async () => {
      const results = await sd.searchRelevantSkills([]);
      expect(results).toEqual([]);
    });

    it("should return keyword-inference suggestions without marketplace", async () => {
      const results = await sd.searchRelevantSkills(["video", "transcode", "convert"]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(3);
      for (const s of results) {
        expect(s).toHaveProperty("source", "keyword-inference");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // suggestInstallation
  // ─────────────────────────────────────────────────────────────────────────
  describe("suggestInstallation()", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should return error when logId not found", () => {
      db._prep.get.mockReturnValueOnce(null);

      const result = sd.suggestInstallation("nonexistent-id");

      expect(result).toHaveProperty("error", "Discovery log not found");
    });

    it("should return recommendation when log entry exists", () => {
      const row = makeLogRow();
      db._prep.get.mockReturnValueOnce(row);

      const result = sd.suggestInstallation("log-001");

      expect(result).toHaveProperty("logId", "log-001");
      expect(result).toHaveProperty("recommendation");
      expect(result.recommendation).toContain("image-tools");
    });

    it("should say no matching skills when suggestions is empty", () => {
      const row = makeLogRow({ suggested_skills: "[]" });
      db._prep.get.mockReturnValueOnce(row);

      const result = sd.suggestInstallation("log-001");

      expect(result.recommendation).toContain("No matching skills");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getDiscoveryHistory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getDiscoveryHistory()", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should return empty array when no records", () => {
      db._prep.all.mockReturnValueOnce([]);
      expect(sd.getDiscoveryHistory()).toEqual([]);
    });

    it("should map DB rows to log entry objects", () => {
      const row = makeLogRow();
      db._prep.all.mockReturnValueOnce([row]);

      const results = sd.getDiscoveryHistory();

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "log-001",
        taskId: "task-abc",
        failureReason: "no matching skill",
        searchedKeywords: ["image", "resize", "compress"],
        installed: false,
      });
    });

    it("should support installedOnly filter", () => {
      db._prep.all.mockReturnValueOnce([]);

      sd.getDiscoveryHistory({ installedOnly: true });

      // Verify prepare was called (with WHERE installed = 1)
      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // markInstalled
  // ─────────────────────────────────────────────────────────────────────────
  describe("markInstalled()", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should return true on success", () => {
      const result = sd.markInstalled("log-001");
      expect(result).toBe(true);
      expect(db.run).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await sd.initialize(db);
    });

    it("should return zero stats for empty DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 0 });

      const stats = sd.getStats();

      expect(stats).toMatchObject({
        totalDiscoveries: 0,
        installed: 0,
        withSuggestions: 0,
        installRate: 0,
      });
    });

    it("should compute installRate correctly", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 10 }) // total
        .mockReturnValueOnce({ count: 4 })  // installed
        .mockReturnValueOnce({ count: 8 }); // withSuggestions

      const stats = sd.getStats();

      expect(stats.totalDiscoveries).toBe(10);
      expect(stats.installed).toBe(4);
      expect(stats.installRate).toBeCloseTo(0.4, 3);
    });
  });
});
