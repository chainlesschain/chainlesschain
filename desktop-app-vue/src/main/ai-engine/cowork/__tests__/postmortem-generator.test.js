/**
 * PostmortemGenerator 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  PostmortemGenerator,
  REPORT_STATUS,
} = require("../postmortem-generator");

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
  };
}

function makeMockIncident(overrides = {}) {
  return {
    id: "inc-001",
    anomalyMetric: "error_rate",
    severity: "P1",
    status: "resolved",
    timeline: [
      { event: "created", timestamp: Date.now() - 3600000 },
      {
        event: "acknowledged",
        timestamp: Date.now() - 1800000,
        by: "engineer",
      },
      { event: "resolved", timestamp: Date.now() - 600000 },
    ],
    remediationResult: "Restarted service",
    resolvedAt: new Date().toISOString(),
    acknowledgedAt: new Date().toISOString(),
    firstAnomalyAt: new Date(Date.now() - 3600000).toISOString(),
    ...overrides,
  };
}

describe("PostmortemGenerator", () => {
  let generator;
  let db;

  beforeEach(() => {
    generator = new PostmortemGenerator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await generator.initialize(db);
      expect(generator.initialized).toBe(true);
    });

    it("should accept optional deps (llmService, incidentClassifier)", async () => {
      const mockClassifier = { initialized: true, getIncident: vi.fn() };
      await generator.initialize(db, { incidentClassifier: mockClassifier });
      expect(generator.initialized).toBe(true);
      expect(generator.incidentClassifier).toBe(mockClassifier);
    });

    it("should be idempotent", async () => {
      await generator.initialize(db);
      await generator.initialize(db);
      expect(generator.initialized).toBe(true);
    });
  });

  describe("generate()", () => {
    it("should throw if not initialized", async () => {
      await expect(
        generator.generate({ incidentId: "inc-001" }),
      ).rejects.toThrow("not initialized");
    });

    it("should throw if incidentId is missing", async () => {
      await generator.initialize(db);
      await expect(generator.generate({})).rejects.toThrow(
        "incidentId is required",
      );
    });

    it("should throw if incident not found (no classifier)", async () => {
      await generator.initialize(db);
      await expect(
        generator.generate({ incidentId: "inc-999" }),
      ).rejects.toThrow();
    });

    it("should generate a report when incident is available via classifier", async () => {
      const mockIncident = makeMockIncident();
      const mockClassifier = {
        initialized: true,
        getIncident: vi.fn().mockReturnValue(mockIncident),
      };
      await generator.initialize(db, { incidentClassifier: mockClassifier });

      const report = await generator.generate({ incidentId: "inc-001" });

      expect(report).toBeTruthy();
      expect(report.id).toBeTruthy();
      expect(report.incidentId).toBe("inc-001");
    });

    it("should emit report:generated event on success", async () => {
      const mockIncident = makeMockIncident();
      const mockClassifier = {
        initialized: true,
        getIncident: vi.fn().mockReturnValue(mockIncident),
      };
      await generator.initialize(db, { incidentClassifier: mockClassifier });
      const listener = vi.fn();
      generator.on("report:generated", listener);

      await generator.generate({ incidentId: "inc-001" });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("getReport()", () => {
    it("should return null for unknown reportId", async () => {
      await generator.initialize(db);
      expect(generator.getReport("nonexistent")).toBeNull();
    });

    it("should return generated report by id", async () => {
      const mockIncident = makeMockIncident();
      const mockClassifier = {
        initialized: true,
        getIncident: vi.fn().mockReturnValue(mockIncident),
      };
      await generator.initialize(db, { incidentClassifier: mockClassifier });
      const report = await generator.generate({ incidentId: "inc-001" });
      const fetched = generator.getReport(report.id);
      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(report.id);
    });
  });

  describe("getStats()", () => {
    beforeEach(async () => {
      await generator.initialize(db);
    });

    it("should return stats object", () => {
      const stats = generator.getStats();
      expect(stats).toBeTruthy();
      expect(typeof stats).toBe("object");
    });
  });

  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await generator.initialize(db);
    });

    it("should return config", () => {
      const config = generator.getConfig();
      expect(config).toHaveProperty("enableLLMAnalysis");
    });

    it("should update config", () => {
      generator.configure({ enableLLMAnalysis: false });
      expect(generator.getConfig().enableLLMAnalysis).toBe(false);
    });
  });

  describe("Constants", () => {
    it("REPORT_STATUS should have expected values", () => {
      expect(REPORT_STATUS).toBeTruthy();
      const keys = Object.keys(REPORT_STATUS);
      expect(keys.length).toBeGreaterThan(0);
    });
  });
});
