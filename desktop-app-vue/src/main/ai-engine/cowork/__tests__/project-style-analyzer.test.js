/**
 * ProjectStyleAnalyzer unit tests — v3.1
 *
 * Coverage: initialize, analyze (real fs scan on existing dir), getConventions,
 *           getStats, getConfig/configure, CONVENTION_CATEGORIES constants
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

// ─── Imports ──────────────────────────────────────────────────────────────────
// NOTE: vi.mock("fs") does NOT intercept Node built-in require() for CJS
//       modules inlined in the forks pool. ProjectStyleAnalyzer scans the real
//       filesystem, so we pass an existing directory to analyze().
const {
  ProjectStyleAnalyzer,
  CONVENTION_CATEGORIES,
} = require("../project-style-analyzer");

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    _prep: prepResult,
  };
}

// Use an existing directory so the real fs.readdirSync calls succeed.
// The cowork directory itself is always present in this project.
const EXISTING_DIR = "src/main/ai-engine/cowork";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProjectStyleAnalyzer", () => {
  let analyzer;
  let db;

  beforeEach(() => {
    analyzer = new ProjectStyleAnalyzer();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // initialize()
  // ──────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      await analyzer.initialize(db);

      expect(analyzer.initialized).toBe(true);
    });

    it("should set db reference", async () => {
      await analyzer.initialize(db);

      expect(analyzer.db).toBe(db);
    });

    it("should be idempotent on double initialize", async () => {
      await analyzer.initialize(db);
      const dbBefore = analyzer.db;
      const db2 = createMockDatabase();
      await analyzer.initialize(db2); // second call should be a no-op

      expect(analyzer.db).toBe(dbBefore);
    });

    it("should throw if analyze() is called before initialize()", async () => {
      await expect(analyzer.analyze(EXISTING_DIR)).rejects.toThrow(
        "ProjectStyleAnalyzer not initialized",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // analyze()
  // ──────────────────────────────────────────────────────────────────────────
  describe("analyze()", () => {
    beforeEach(async () => {
      await analyzer.initialize(db);
    });

    it("should return an object with naming and architecture fields", async () => {
      const result = await analyzer.analyze(EXISTING_DIR);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("naming");
      expect(result).toHaveProperty("architecture");
    });

    it("should return all expected top-level fields", async () => {
      const result = await analyzer.analyze(EXISTING_DIR);

      expect(result).toHaveProperty("projectPath");
      expect(result).toHaveProperty("naming");
      expect(result).toHaveProperty("architecture");
      expect(result).toHaveProperty("testing");
      expect(result).toHaveProperty("style");
      expect(result).toHaveProperty("imports");
      expect(result).toHaveProperty("components");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("analyzedAt");
    });

    it("should return a confidence score between 0 and 1", async () => {
      const result = await analyzer.analyze(EXISTING_DIR);

      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should emit 'analysis:completed' event with directory and confidence", async () => {
      const handler = vi.fn();
      analyzer.on("analysis:completed", handler);

      await analyzer.analyze(EXISTING_DIR);

      expect(handler).toHaveBeenCalledOnce();
      const payload = handler.mock.calls[0][0];
      expect(payload).toHaveProperty("directory", EXISTING_DIR);
      expect(payload).toHaveProperty("confidence");
      expect(payload).toHaveProperty("elapsed");
    });

    it("should throw for a non-string (falsy) directory argument", async () => {
      await expect(analyzer.analyze("")).rejects.toThrow(
        "directory is required",
      );
    });

    it("should throw for missing directory argument", async () => {
      await expect(analyzer.analyze()).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getConventions()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getConventions()", () => {
    beforeEach(async () => {
      await analyzer.initialize(db);
    });

    it("should return null for a path that has not been analyzed yet", () => {
      const result = analyzer.getConventions("/some/path/not/analyzed");

      expect(result).toBeNull();
    });

    it("should return cached conventions after analyze() has been called", async () => {
      await analyzer.analyze(EXISTING_DIR);

      const result = analyzer.getConventions(EXISTING_DIR);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("naming");
      expect(result).toHaveProperty("architecture");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getStats()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await analyzer.initialize(db);
    });

    it("should return stats object with expected fields", () => {
      const stats = analyzer.getStats();

      expect(stats).toHaveProperty("totalAnalyses");
      expect(stats).toHaveProperty("cacheHits");
      expect(stats).toHaveProperty("averageAnalysisTimeMs");
    });

    it("should increment totalAnalyses after each analyze() call", async () => {
      expect(analyzer.getStats().totalAnalyses).toBe(0);

      await analyzer.analyze(EXISTING_DIR);
      expect(analyzer.getStats().totalAnalyses).toBe(1);

      // forceRefresh to bypass cache and trigger a real analysis again
      await analyzer.analyze(EXISTING_DIR, { forceRefresh: true });
      expect(analyzer.getStats().totalAnalyses).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getConfig() / configure()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    it("should return default config with expected keys", () => {
      const config = analyzer.getConfig();

      expect(config).toHaveProperty("maxScanDepth");
      expect(config).toHaveProperty("maxFilesToScan");
      expect(config).toHaveProperty("cacheExpireMs");
      expect(config).toHaveProperty("enableCKG");
      expect(config).toHaveProperty("enableInstinct");
    });

    it("should update config fields via configure()", () => {
      analyzer.configure({ maxScanDepth: 3 });

      expect(analyzer.getConfig().maxScanDepth).toBe(3);
    });

    it("should return the updated config from configure()", () => {
      const returned = analyzer.configure({ enableCKG: false });

      expect(returned.enableCKG).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // analyzeStream() — Phase F StreamRouter-compatible async generator
  // ──────────────────────────────────────────────────────────────────────────
  describe("analyzeStream()", () => {
    beforeEach(async () => {
      await analyzer.initialize(db);
    });

    async function collectStream(gen) {
      const events = [];
      for await (const ev of gen) {
        events.push(ev);
      }
      return events;
    }

    it("should yield start event first with directory", async () => {
      const events = await collectStream(analyzer.analyzeStream(EXISTING_DIR));

      const start = events[0];
      expect(start.type).toBe("start");
      expect(start.directory).toBe(EXISTING_DIR);
      expect(start.ts).toBeTypeOf("number");
    });

    it("should yield message events for each analysis phase", async () => {
      const events = await collectStream(analyzer.analyzeStream(EXISTING_DIR));

      const phases = events
        .filter((e) => e.type === "message")
        .map((e) => e.phase);
      expect(phases).toContain("naming");
      expect(phases).toContain("architecture");
      expect(phases).toContain("testing");
      expect(phases).toContain("style");
    });

    it("should yield end event with result containing conventions", async () => {
      const events = await collectStream(analyzer.analyzeStream(EXISTING_DIR));

      const end = events[events.length - 1];
      expect(end.type).toBe("end");
      expect(end.result).toBeTruthy();
      expect(end.result).toHaveProperty("naming");
      expect(end.result).toHaveProperty("architecture");
      expect(end.result).toHaveProperty("confidence");
      expect(end.ts).toBeTypeOf("number");
    });

    it("should produce event sequence: start → naming → architecture → testing → style → end", async () => {
      const events = await collectStream(analyzer.analyzeStream(EXISTING_DIR));

      const types = events.map((e) => e.phase || e.type);
      expect(types[0]).toBe("start");
      expect(types).toContain("naming");
      expect(types).toContain("architecture");
      expect(types).toContain("testing");
      expect(types).toContain("style");
      expect(types[types.length - 1]).toBe("end");
    });

    it("analyze() should return same result as end event (backward compat)", async () => {
      const syncResult = await analyzer.analyze(EXISTING_DIR, {
        forceRefresh: true,
      });

      const analyzer2 = new ProjectStyleAnalyzer();
      await analyzer2.initialize(createMockDatabase());
      const events = await collectStream(analyzer2.analyzeStream(EXISTING_DIR));
      const streamResult = events[events.length - 1].result;

      expect(syncResult.projectPath).toBe(streamResult.projectPath);
      expect(syncResult.naming.files).toBe(streamResult.naming.files);
      expect(typeof syncResult.confidence).toBe(typeof streamResult.confidence);
    });

    it("should still emit analysis:completed event", async () => {
      const handler = vi.fn();
      analyzer.on("analysis:completed", handler);

      const events = await collectStream(analyzer.analyzeStream(EXISTING_DIR));

      expect(handler).toHaveBeenCalledOnce();
      expect(events[events.length - 1].type).toBe("end");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ANALYZE_STREAM_EVENTS export
  // ──────────────────────────────────────────────────────────────────────────
  describe("ANALYZE_STREAM_EVENTS", () => {
    it("should export a frozen array with start/message/error/end", () => {
      const mod = require("../project-style-analyzer");
      expect(mod.ANALYZE_STREAM_EVENTS).toBeTruthy();
      expect(mod.ANALYZE_STREAM_EVENTS).toContain("start");
      expect(mod.ANALYZE_STREAM_EVENTS).toContain("message");
      expect(mod.ANALYZE_STREAM_EVENTS).toContain("error");
      expect(mod.ANALYZE_STREAM_EVENTS).toContain("end");
      expect(Object.isFrozen(mod.ANALYZE_STREAM_EVENTS)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CONVENTION_CATEGORIES constant
  // ──────────────────────────────────────────────────────────────────────────
  describe("CONVENTION_CATEGORIES", () => {
    it("should export NAMING, ARCHITECTURE, TESTING, STYLE, IMPORTS, COMPONENTS", () => {
      expect(CONVENTION_CATEGORIES).toHaveProperty("NAMING");
      expect(CONVENTION_CATEGORIES).toHaveProperty("ARCHITECTURE");
      expect(CONVENTION_CATEGORIES).toHaveProperty("TESTING");
      expect(CONVENTION_CATEGORIES).toHaveProperty("STYLE");
      expect(CONVENTION_CATEGORIES).toHaveProperty("IMPORTS");
      expect(CONVENTION_CATEGORIES).toHaveProperty("COMPONENTS");
    });

    it("should have string values for each category key", () => {
      for (const [, value] of Object.entries(CONVENTION_CATEGORIES)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });
});
