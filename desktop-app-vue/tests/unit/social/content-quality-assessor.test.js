import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let ContentQualityAssessor, getContentQualityAssessor, QUALITY_LEVEL;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod =
    await import("../../../src/main/social/content-quality-assessor.js");
  ContentQualityAssessor = mod.ContentQualityAssessor;
  getContentQualityAssessor = mod.getContentQualityAssessor;
  QUALITY_LEVEL = mod.QUALITY_LEVEL;
});

describe("ContentQualityAssessor", () => {
  let assessor;
  beforeEach(() => {
    assessor = new ContentQualityAssessor({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(assessor._assessments).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await assessor.initialize();
      expect(assessor.initialized).toBe(true);
    });
  });

  describe("assessQuality()", () => {
    it("should throw if content is missing", async () => {
      await expect(assessor.assessQuality({})).rejects.toThrow(
        "Content is required",
      );
    });

    it("should assess quality", async () => {
      const result = await assessor.assessQuality({
        content: "This is good content",
      });
      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      expect(result.quality_score).toBeLessThanOrEqual(1);
      expect(result).toHaveProperty("quality_level");
      expect(result).toHaveProperty("content_hash");
    });

    it("should persist to DB", async () => {
      await assessor.assessQuality({ content: "test content" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should store assessment in memory", async () => {
      await assessor.assessQuality({ content: "test" });
      expect(assessor._assessments.size).toBe(1);
    });
  });

  describe("getQualityReport()", () => {
    it("should return empty report", async () => {
      const report = await assessor.getQualityReport();
      expect(report.total).toBe(0);
      expect(report.avgScore).toBe(0);
    });

    it("should return report with assessments", async () => {
      await assessor.assessQuality({ content: "test content 1" });
      const report = await assessor.getQualityReport();
      expect(report.total).toBe(1);
      expect(report.avgScore).toBeGreaterThan(0);
    });
  });

  describe("close()", () => {
    it("should clear assessments", async () => {
      await assessor.assessQuality({ content: "test" });
      await assessor.close();
      expect(assessor._assessments.size).toBe(0);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getContentQualityAssessor();
      expect(instance).toBeInstanceOf(ContentQualityAssessor);
    });
  });
});
