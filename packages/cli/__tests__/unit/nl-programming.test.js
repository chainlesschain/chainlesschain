import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  INTENT,
  TRANSLATION_STATUS,
  STYLE_CATEGORY,
  ensureNlProgrammingTables,
  classifyIntent,
  extractEntities,
  detectTechStack,
  scoreCompleteness,
  translate,
  getTranslation,
  listTranslations,
  updateTranslationStatus,
  refineTranslation,
  removeTranslation,
  addConvention,
  getConvention,
  listConventions,
  removeConvention,
  getNlProgrammingStats,
  _resetState,
} from "../../src/lib/nl-programming.js";

describe("nl-programming", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureNlProgrammingTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureNlProgrammingTables", () => {
    it("creates both tables", () => {
      expect(db.tables.has("nl_programs")).toBe(true);
      expect(db.tables.has("nl_program_conventions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureNlProgrammingTables(db);
      expect(db.tables.has("nl_programs")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 9 intents", () => {
      expect(Object.keys(INTENT)).toHaveLength(9);
    });

    it("has 3 translation statuses", () => {
      expect(Object.keys(TRANSLATION_STATUS)).toHaveLength(3);
    });

    it("has 6 style categories", () => {
      expect(Object.keys(STYLE_CATEGORY)).toHaveLength(6);
    });
  });

  /* ── Intent Classification ─────────────────────── */

  describe("classifyIntent", () => {
    it("classifies create intent", () => {
      const r = classifyIntent("create a new login component");
      expect(r.intent).toBe("create_component");
      expect(r.confidence).toBeGreaterThan(0);
    });

    it("classifies add_feature intent", () => {
      expect(
        classifyIntent("add search functionality to the list page").intent,
      ).toBe("add_feature");
    });

    it("classifies fix_bug intent", () => {
      expect(classifyIntent("fix the login page flickering bug").intent).toBe(
        "fix_bug",
      );
    });

    it("classifies refactor intent", () => {
      expect(classifyIntent("refactor the user module").intent).toBe(
        "refactor",
      );
    });

    it("classifies Chinese input", () => {
      expect(classifyIntent("创建一个用户卡片组件").intent).toBe(
        "create_component",
      );
    });

    it("classifies add_feature with Chinese", () => {
      expect(classifyIntent("给列表页添加搜索功能").intent).toBe("add_feature");
    });

    it("classifies fix with Chinese", () => {
      expect(classifyIntent("修复登录页面的闪烁问题").intent).toBe("fix_bug");
    });

    it("returns general for ambiguous input", () => {
      expect(classifyIntent("hello world").intent).toBe("general");
    });

    it("handles empty input", () => {
      expect(classifyIntent("").intent).toBe("general");
      expect(classifyIntent("").confidence).toBe(0);
    });

    it("handles null input", () => {
      expect(classifyIntent(null).intent).toBe("general");
    });
  });

  /* ── Entity Extraction ─────────────────────────── */

  describe("extractEntities", () => {
    it("extracts quoted strings", () => {
      const r = extractEntities('create a "UserCard" component');
      expect(r.entities.some((e) => e.value === "UserCard")).toBe(true);
    });

    it("extracts PascalCase terms", () => {
      const r = extractEntities("add UserProfile to the dashboard");
      expect(
        r.entities.some(
          (e) => e.type === "technical" && e.value === "UserProfile",
        ),
      ).toBe(true);
    });

    it("extracts Chinese noun phrases", () => {
      const r = extractEntities("给用户个人页面添加头像上传功能");
      expect(r.count).toBeGreaterThan(0);
    });

    it("deduplicates entities", () => {
      const r = extractEntities('"test" and "test" again');
      const testEntities = r.entities.filter((e) => e.value === "test");
      expect(testEntities).toHaveLength(1);
    });

    it("returns empty for no entities", () => {
      const r = extractEntities("hello");
      expect(r.count).toBe(0);
    });

    it("handles empty input", () => {
      expect(extractEntities("").count).toBe(0);
    });

    it("handles null input", () => {
      expect(extractEntities(null).count).toBe(0);
    });
  });

  /* ── Tech Stack Detection ──────────────────────── */

  describe("detectTechStack", () => {
    it("detects vue", () => {
      const r = detectTechStack("create a Vue component");
      expect(r.detected).toContain("vue");
      expect(r.primary).toBe("vue");
    });

    it("detects react", () => {
      expect(detectTechStack("add a React hook").detected).toContain("react");
    });

    it("detects typescript", () => {
      expect(detectTechStack("write in TypeScript").detected).toContain(
        "typescript",
      );
    });

    it("detects multiple stacks", () => {
      const r = detectTechStack("create a Vue TypeScript component");
      expect(r.detected).toContain("vue");
      expect(r.detected).toContain("typescript");
    });

    it("detects python", () => {
      expect(detectTechStack("create a FastAPI endpoint").detected).toContain(
        "python",
      );
    });

    it("returns empty for unknown stack", () => {
      expect(detectTechStack("do something").detected).toHaveLength(0);
      expect(detectTechStack("do something").primary).toBeNull();
    });

    it("handles empty input", () => {
      expect(detectTechStack("").detected).toHaveLength(0);
    });
  });

  /* ── Completeness Scoring ──────────────────────── */

  describe("scoreCompleteness", () => {
    it("scores 0 for null spec", () => {
      expect(scoreCompleteness(null).score).toBe(0);
    });

    it("scores partially for minimal spec", () => {
      const r = scoreCompleteness({
        intent: "add_feature",
        inputText: "add search to list page",
      });
      expect(r.score).toBeGreaterThan(0);
      expect(r.missing.length).toBeGreaterThan(0);
    });

    it("scores high for complete spec", () => {
      const r = scoreCompleteness({
        intent: "add_feature",
        entities: [{ value: "search" }],
        techStack: ["vue"],
        inputText: "add search to the user list page",
        ambiguities: [],
        conventions: [{ category: "naming" }],
      });
      expect(r.score).toBe(1);
      expect(r.missing).toHaveLength(0);
    });

    it("penalizes ambiguities", () => {
      const r = scoreCompleteness({
        intent: "add_feature",
        entities: [{ value: "search" }],
        techStack: ["vue"],
        inputText: "add search to the user list page",
        ambiguities: ["what kind of search?"],
        conventions: [{ category: "naming" }],
      });
      expect(r.score).toBeLessThan(1);
    });
  });

  /* ── Translation CRUD ──────────────────────────── */

  describe("translate", () => {
    it("translates with auto-classification", () => {
      const r = translate(db, { text: "create a new login component" });
      expect(r.translated).toBe(true);
      expect(r.translationId).toBeTruthy();
      expect(r.intent).toBe("create_component");
      expect(r.completeness).toBeGreaterThan(0);
    });

    it("accepts override intent", () => {
      const r = translate(db, { text: "do something", intent: "refactor" });
      expect(r.intent).toBe("refactor");
    });

    it("rejects missing text", () => {
      expect(translate(db, {}).reason).toBe("missing_text");
    });

    it("stores translation in db", () => {
      const { translationId } = translate(db, { text: "fix the bug" });
      const t = getTranslation(db, translationId);
      expect(t.input_text).toBe("fix the bug");
      expect(t.intent).toBe("fix_bug");
      expect(t.status).toBe("draft");
    });
  });

  describe("getTranslation / listTranslations", () => {
    it("returns null for unknown id", () => {
      expect(getTranslation(db, "nope")).toBeNull();
    });

    it("lists all translations", () => {
      translate(db, { text: "create component" });
      translate(db, { text: "fix bug" });
      expect(listTranslations(db)).toHaveLength(2);
    });

    it("filters by intent", () => {
      translate(db, { text: "create a new component" });
      translate(db, { text: "fix the flickering bug" });
      expect(listTranslations(db, { intent: "fix_bug" })).toHaveLength(1);
    });

    it("filters by status", () => {
      const { translationId } = translate(db, { text: "create component" });
      translate(db, { text: "fix bug" });
      updateTranslationStatus(db, translationId, "complete");
      expect(listTranslations(db, { status: "complete" })).toHaveLength(1);
    });
  });

  describe("updateTranslationStatus", () => {
    it("updates status", () => {
      const { translationId } = translate(db, { text: "create x" });
      const r = updateTranslationStatus(db, translationId, "complete");
      expect(r.updated).toBe(true);
      expect(getTranslation(db, translationId).status).toBe("complete");
    });

    it("rejects invalid status", () => {
      const { translationId } = translate(db, { text: "create x" });
      expect(updateTranslationStatus(db, translationId, "invalid").reason).toBe(
        "invalid_status",
      );
    });

    it("rejects unknown id", () => {
      expect(updateTranslationStatus(db, "nope", "complete").reason).toBe(
        "not_found",
      );
    });
  });

  describe("refineTranslation", () => {
    it("refines with new spec", () => {
      const { translationId } = translate(db, {
        text: "create a Vue component",
      });
      const r = refineTranslation(db, translationId, {
        spec: { component: "UserCard", framework: "vue" },
      });
      expect(r.refined).toBe(true);
      expect(r.completeness).toBeGreaterThan(0);
      expect(getTranslation(db, translationId).status).toBe("refined");
    });

    it("clears ambiguities on refine", () => {
      const { translationId } = translate(db, {
        text: "add something",
        ambiguities: '["what to add?"]',
      });
      refineTranslation(db, translationId, { ambiguities: "[]" });
      const t = getTranslation(db, translationId);
      expect(t.ambiguities).toBe("[]");
    });

    it("rejects unknown id", () => {
      expect(refineTranslation(db, "nope", {}).reason).toBe("not_found");
    });
  });

  describe("removeTranslation", () => {
    it("removes a translation", () => {
      const { translationId } = translate(db, { text: "create x" });
      expect(removeTranslation(db, translationId).removed).toBe(true);
      expect(getTranslation(db, translationId)).toBeNull();
    });

    it("rejects unknown id", () => {
      expect(removeTranslation(db, "nope").reason).toBe("not_found");
    });
  });

  /* ── Conventions ─────────────────────────────────── */

  describe("addConvention", () => {
    it("adds a convention", () => {
      const r = addConvention(db, {
        category: "naming",
        pattern: "camelCase for variables",
        confidence: 0.9,
      });
      expect(r.added).toBe(true);
      expect(r.conventionId).toBeTruthy();
    });

    it("rejects invalid category", () => {
      expect(
        addConvention(db, { category: "invalid", pattern: "x" }).reason,
      ).toBe("invalid_category");
    });

    it("rejects missing pattern", () => {
      expect(addConvention(db, { category: "naming" }).reason).toBe(
        "missing_pattern",
      );
    });

    it("clamps confidence to 0-1", () => {
      const { conventionId } = addConvention(db, {
        category: "naming",
        pattern: "test",
        confidence: 1.5,
      });
      expect(getConvention(db, conventionId).confidence).toBeLessThanOrEqual(1);
    });

    it("defaults confidence to 0.5", () => {
      const { conventionId } = addConvention(db, {
        category: "naming",
        pattern: "test",
      });
      expect(getConvention(db, conventionId).confidence).toBe(0.5);
    });
  });

  describe("listConventions / getConvention", () => {
    it("lists conventions", () => {
      addConvention(db, { category: "naming", pattern: "camelCase" });
      addConvention(db, { category: "testing", pattern: "vitest" });
      expect(listConventions(db)).toHaveLength(2);
    });

    it("filters by category", () => {
      addConvention(db, { category: "naming", pattern: "camelCase" });
      addConvention(db, { category: "testing", pattern: "vitest" });
      expect(listConventions(db, { category: "naming" })).toHaveLength(1);
    });

    it("returns null for unknown id", () => {
      expect(getConvention(db, "nope")).toBeNull();
    });

    it("sorts by confidence descending", () => {
      addConvention(db, {
        category: "naming",
        pattern: "low",
        confidence: 0.3,
      });
      addConvention(db, {
        category: "naming",
        pattern: "high",
        confidence: 0.9,
      });
      const list = listConventions(db);
      expect(list[0].pattern).toBe("high");
    });
  });

  describe("removeConvention", () => {
    it("removes a convention", () => {
      const { conventionId } = addConvention(db, {
        category: "naming",
        pattern: "test",
      });
      expect(removeConvention(db, conventionId).removed).toBe(true);
      expect(getConvention(db, conventionId)).toBeNull();
    });

    it("rejects unknown id", () => {
      expect(removeConvention(db, "nope").reason).toBe("not_found");
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getNlProgrammingStats", () => {
    it("returns zeros when empty", () => {
      const s = getNlProgrammingStats(db);
      expect(s.translations.total).toBe(0);
      expect(s.conventions.total).toBe(0);
    });

    it("computes correct stats", () => {
      translate(db, { text: "create a new component" });
      translate(db, { text: "fix the login bug" });
      addConvention(db, { category: "naming", pattern: "camelCase" });
      addConvention(db, { category: "testing", pattern: "vitest" });

      const s = getNlProgrammingStats(db);
      expect(s.translations.total).toBe(2);
      expect(s.translations.byIntent.create_component).toBe(1);
      expect(s.translations.byIntent.fix_bug).toBe(1);
      expect(s.translations.avgCompleteness).toBeGreaterThan(0);
      expect(s.conventions.total).toBe(2);
      expect(s.conventions.byCategory.naming).toBe(1);
      expect(s.conventions.byCategory.testing).toBe(1);
    });
  });
});
