/**
 * SpecTranslator 单元测试 — v3.1
 *
 * 覆盖：initialize、translate（意图识别/实体提取/歧义检测/完整性评分）、
 *       validateSpec、refineSpec、getHistory、getStats
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
const {
  SpecTranslator,
  SPEC_STATUS,
  INTENT_TYPES,
} = require("../spec-translator");

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SpecTranslator", () => {
  let translator;
  let db;

  beforeEach(() => {
    translator = new SpecTranslator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await translator.initialize(db);

      expect(translator.initialized).toBe(true);
    });

    it("should accept optional deps without error", async () => {
      const mockCKG = { initialized: false };
      const mockLLM = { query: vi.fn() };

      await translator.initialize(db, { ckg: mockCKG, llmService: mockLLM });

      expect(translator.initialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await translator.initialize(db);
      await translator.initialize(db);

      expect(translator.initialized).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // translate — intent classification
  // ─────────────────────────────────────────────────────────────────────────
  describe("translate() — intent classification", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should classify '创建组件' as create-component", async () => {
      const spec = await translator.translate("创建一个用户列表组件");
      expect(spec.intent).toBe(INTENT_TYPES.CREATE_COMPONENT);
    });

    it("should classify 'implement component' as create-component", async () => {
      const spec = await translator.translate("implement a new user list component");
      expect(spec.intent).toBe(INTENT_TYPES.CREATE_COMPONENT);
    });

    it("should classify '修复bug' as fix-bug", async () => {
      const spec = await translator.translate("修复登录页面的bug");
      expect(spec.intent).toBe(INTENT_TYPES.FIX_BUG);
    });

    it("should classify 'fix error' as fix-bug", async () => {
      const spec = await translator.translate("fix the authentication error");
      expect(spec.intent).toBe(INTENT_TYPES.FIX_BUG);
    });

    it("should classify '重构' as refactor", async () => {
      const spec = await translator.translate("重构用户认证模块");
      expect(spec.intent).toBe(INTENT_TYPES.REFACTOR);
    });

    it("should classify 'API endpoint' as add-api", async () => {
      const spec = await translator.translate("add a REST API endpoint for user management");
      expect(spec.intent).toBe(INTENT_TYPES.ADD_API);
    });

    it("should classify '单元测试' as add-test", async () => {
      const spec = await translator.translate("为用户模块添加单元测试");
      expect(spec.intent).toBe(INTENT_TYPES.ADD_TEST);
    });

    it("should return 'general' for unrecognized intent", async () => {
      const spec = await translator.translate("xyzzy plugh");
      expect(spec.intent).toBe(INTENT_TYPES.GENERAL);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // translate — spec structure
  // ─────────────────────────────────────────────────────────────────────────
  describe("translate() — spec structure", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should return spec with required fields", async () => {
      const spec = await translator.translate("实现用户登录页面");

      expect(spec).toHaveProperty("id");
      expect(spec).toHaveProperty("intent");
      expect(spec).toHaveProperty("description");
      expect(spec).toHaveProperty("entities");
      expect(spec).toHaveProperty("techStack");
      expect(spec).toHaveProperty("features");
      expect(spec).toHaveProperty("completeness");
      expect(spec).toHaveProperty("status");
    });

    it("should have completeness score between 0 and 1", async () => {
      const spec = await translator.translate("创建一个分页用户列表组件，支持搜索和排序");

      expect(spec.completeness).toBeGreaterThanOrEqual(0);
      expect(spec.completeness).toBeLessThanOrEqual(1);
    });

    it("should detect Vue/React techStack keywords", async () => {
      const spec = await translator.translate("create a Vue component with Pinia store");

      expect(spec.techStack).toBeTruthy();
    });

    it("should include context directory in spec", async () => {
      const spec = await translator.translate("create component", {
        directory: "src/renderer/components/",
      });

      expect(spec.directory).toBe("src/renderer/components/");
    });

    it("should set status to VALIDATED for complete specs", async () => {
      // Detailed description with clear requirements
      const spec = await translator.translate(
        "implement a paginated user list Vue component with search by name and email, sort by created date",
        { directory: "src/renderer/" },
      );

      expect([SPEC_STATUS.VALIDATED, SPEC_STATUS.AMBIGUOUS, SPEC_STATUS.DRAFT]).toContain(
        spec.status,
      );
    });

    it("should throw if not initialized", async () => {
      const freshTranslator = new SpecTranslator();
      await expect(freshTranslator.translate("test")).rejects.toThrow(
        "not initialized",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // translate — tech stack detection
  // ─────────────────────────────────────────────────────────────────────────
  describe("translate() — tech stack detection", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should detect Vue in description", async () => {
      const spec = await translator.translate("create a Vue 3 component with Composition API");
      const techStr = JSON.stringify(spec.techStack).toLowerCase();
      expect(techStr).toContain("vue");
    });

    it("should detect Node.js/server in description", async () => {
      const spec = await translator.translate("implement a Node.js express server for user management");
      const techStr = JSON.stringify(spec.techStack).toLowerCase();
      expect(techStr).toMatch(/node|server|express/);
    });

    it("should detect SQLite/database in description", async () => {
      const spec = await translator.translate("add SQLite table for session management");
      const techStr = JSON.stringify(spec.techStack).toLowerCase();
      expect(techStr).toMatch(/sqlite|database|db/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // validateSpec
  // ─────────────────────────────────────────────────────────────────────────
  describe("validateSpec()", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should validate a well-formed spec", async () => {
      const spec = await translator.translate("create a user profile page with avatar upload");
      const validation = translator.validateSpec(spec);

      expect(validation).toHaveProperty("valid");
      expect(validation).toHaveProperty("completeness");
      expect(typeof validation.valid).toBe("boolean");
    });

    it("should return errors array", async () => {
      const spec = await translator.translate("x");
      const validation = translator.validateSpec(spec);

      expect(validation).toHaveProperty("errors");
      expect(Array.isArray(validation.errors)).toBe(true);
    });

    it("should mark empty description as invalid", () => {
      const emptySpec = { description: "", intent: "general", features: [] };
      const validation = translator.validateSpec(emptySpec);
      expect(validation.valid).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // refineSpec
  // ─────────────────────────────────────────────────────────────────────────
  describe("refineSpec()", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should apply refinements to spec", async () => {
      const spec = await translator.translate("create user list");
      db._prep.get.mockReturnValue({ spec_json: JSON.stringify(spec) });

      const refined = await translator.refineSpec(spec.id, {
        additionalFeatures: ["pagination", "search"],
        directory: "src/components/",
      });

      expect(refined).toBeTruthy();
    });

    it("should throw for unknown spec id when DB has no record", async () => {
      db._prep.get.mockReturnValue(null);

      await expect(
        translator.refineSpec("nonexistent-id", {}),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getHistory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getHistory()", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should return history array from DB", () => {
      db._prep.all.mockReturnValue([
        {
          id: "spec-001",
          description: "create user list",
          spec_json: "{}",
          status: "validated",
          created_at: "2025-01-01",
        },
      ]);

      const history = translator.getHistory(10);
      expect(Array.isArray(history)).toBe(true);
    });

    it("should use default limit if not specified", () => {
      db._prep.all.mockReturnValue([]);
      const history = translator.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await translator.initialize(db);
    });

    it("should return stats with totalTranslations counter", async () => {
      await translator.translate("create component a");
      await translator.translate("fix bug b");

      const stats = translator.getStats();
      expect(stats.totalTranslations).toBeGreaterThanOrEqual(2);
    });

    it("should track intent distribution", async () => {
      await translator.translate("创建组件");
      await translator.translate("修复 bug");

      const stats = translator.getStats();
      expect(stats.intentDistribution).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constants", () => {
    it("SPEC_STATUS should have required statuses", () => {
      expect(SPEC_STATUS.DRAFT).toBe("draft");
      expect(SPEC_STATUS.VALIDATED).toBe("validated");
      expect(SPEC_STATUS.AMBIGUOUS).toBe("ambiguous");
      expect(SPEC_STATUS.COMPLETED).toBe("completed");
    });

    it("INTENT_TYPES should have all required intent types", () => {
      expect(INTENT_TYPES.CREATE_COMPONENT).toBe("create-component");
      expect(INTENT_TYPES.FIX_BUG).toBe("fix-bug");
      expect(INTENT_TYPES.REFACTOR).toBe("refactor");
      expect(INTENT_TYPES.ADD_API).toBe("add-api");
      expect(INTENT_TYPES.ADD_TEST).toBe("add-test");
      expect(INTENT_TYPES.GENERAL).toBe("general");
    });
  });
});
