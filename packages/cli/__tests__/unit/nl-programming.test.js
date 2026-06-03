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

/* ═════════════════════════════════════════════════════════ *
 *  Phase 28 V2 tests
 * ═════════════════════════════════════════════════════════ */

import {
  SPEC_MATURITY_V2,
  DIALOGUE_TURN_V2,
  NLPROG_DEFAULT_MAX_ACTIVE_SPECS_PER_AUTHOR,
  NLPROG_DEFAULT_MAX_PENDING_TURNS_PER_SPEC,
  NLPROG_DEFAULT_SPEC_IDLE_MS,
  NLPROG_DEFAULT_TURN_PENDING_MS,
  getDefaultMaxActiveSpecsPerAuthorV2,
  getMaxActiveSpecsPerAuthorV2,
  setMaxActiveSpecsPerAuthorV2,
  getDefaultMaxPendingTurnsPerSpecV2,
  getMaxPendingTurnsPerSpecV2,
  setMaxPendingTurnsPerSpecV2,
  getDefaultSpecIdleMsV2,
  getSpecIdleMsV2,
  setSpecIdleMsV2,
  getDefaultTurnPendingMsV2,
  getTurnPendingMsV2,
  setTurnPendingMsV2,
  registerSpecV2,
  getSpecV2,
  setSpecMaturityV2,
  refineSpec,
  approveSpec,
  implementSpec,
  archiveSpec,
  touchSpecActivity,
  registerDialogueTurnV2,
  getDialogueTurnV2,
  setDialogueTurnStatusV2,
  answerTurn,
  dismissTurn,
  escalateTurn,
  getActiveSpecCount,
  getPendingTurnCount,
  autoArchiveIdleSpecs,
  autoDismissStalePendingTurns,
  getNlProgrammingStatsV2,
  _resetStateV2,
} from "../../src/lib/nl-programming.js";

describe("nl-programming V2", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("SPEC_MATURITY_V2 frozen with 5 states", () => {
      expect(Object.values(SPEC_MATURITY_V2)).toEqual([
        "draft",
        "refining",
        "approved",
        "implemented",
        "archived",
      ]);
      expect(Object.isFrozen(SPEC_MATURITY_V2)).toBe(true);
    });

    it("DIALOGUE_TURN_V2 frozen with 4 states", () => {
      expect(Object.values(DIALOGUE_TURN_V2)).toEqual([
        "pending",
        "answered",
        "dismissed",
        "escalated",
      ]);
      expect(Object.isFrozen(DIALOGUE_TURN_V2)).toBe(true);
    });
  });

  describe("config defaults + setters", () => {
    it("exposes frozen defaults", () => {
      expect(NLPROG_DEFAULT_MAX_ACTIVE_SPECS_PER_AUTHOR).toBe(30);
      expect(NLPROG_DEFAULT_MAX_PENDING_TURNS_PER_SPEC).toBe(20);
      expect(NLPROG_DEFAULT_SPEC_IDLE_MS).toBe(45 * 86400000);
      expect(NLPROG_DEFAULT_TURN_PENDING_MS).toBe(7 * 86400000);
      expect(getDefaultMaxActiveSpecsPerAuthorV2()).toBe(30);
      expect(getDefaultMaxPendingTurnsPerSpecV2()).toBe(20);
      expect(getDefaultSpecIdleMsV2()).toBe(45 * 86400000);
      expect(getDefaultTurnPendingMsV2()).toBe(7 * 86400000);
    });

    it("mutates config values", () => {
      setMaxActiveSpecsPerAuthorV2(5);
      setMaxPendingTurnsPerSpecV2(3);
      setSpecIdleMsV2(1000);
      setTurnPendingMsV2(500);
      expect(getMaxActiveSpecsPerAuthorV2()).toBe(5);
      expect(getMaxPendingTurnsPerSpecV2()).toBe(3);
      expect(getSpecIdleMsV2()).toBe(1000);
      expect(getTurnPendingMsV2()).toBe(500);
    });

    it("rejects non-positive", () => {
      expect(() => setMaxActiveSpecsPerAuthorV2(0)).toThrow();
      expect(() => setMaxPendingTurnsPerSpecV2(-1)).toThrow();
      expect(() => setSpecIdleMsV2(NaN)).toThrow();
      expect(() => setTurnPendingMsV2("x")).toThrow();
    });

    it("_resetStateV2 restores defaults + clears maps", () => {
      setMaxActiveSpecsPerAuthorV2(10);
      registerSpecV2(null, { specId: "s", authorId: "a" });
      registerDialogueTurnV2(null, {
        turnId: "t",
        specId: "s",
        question: "q",
      });
      _resetStateV2();
      expect(getMaxActiveSpecsPerAuthorV2()).toBe(30);
      expect(getSpecV2("s")).toBeNull();
      expect(getDialogueTurnV2("t")).toBeNull();
    });
  });

  describe("registerSpecV2", () => {
    it("creates draft spec", () => {
      const s = registerSpecV2(null, {
        specId: "s1",
        authorId: "alice",
        title: "User login",
      });
      expect(s.status).toBe("draft");
      expect(s.authorId).toBe("alice");
      expect(s.title).toBe("User login");
    });

    it("accepts approved initial", () => {
      const s = registerSpecV2(null, {
        specId: "s",
        authorId: "a",
        initialStatus: "approved",
      });
      expect(s.status).toBe("approved");
    });

    it("throws missing specId/authorId", () => {
      expect(() => registerSpecV2(null, { authorId: "a" })).toThrow();
      expect(() => registerSpecV2(null, { specId: "s" })).toThrow();
    });

    it("throws on duplicate", () => {
      registerSpecV2(null, { specId: "s", authorId: "a" });
      expect(() =>
        registerSpecV2(null, { specId: "s", authorId: "a" }),
      ).toThrow(/already exists/);
    });

    it("throws on invalid initial", () => {
      expect(() =>
        registerSpecV2(null, {
          specId: "s",
          authorId: "a",
          initialStatus: "x",
        }),
      ).toThrow();
    });

    it("throws on terminal initial (archived)", () => {
      expect(() =>
        registerSpecV2(null, {
          specId: "s",
          authorId: "a",
          initialStatus: "archived",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces per-author active cap", () => {
      setMaxActiveSpecsPerAuthorV2(2);
      registerSpecV2(null, { specId: "s1", authorId: "a" });
      registerSpecV2(null, { specId: "s2", authorId: "a" });
      expect(() =>
        registerSpecV2(null, { specId: "s3", authorId: "a" }),
      ).toThrow(/cap/);
    });

    it("active cap counts draft + refining + approved", () => {
      setMaxActiveSpecsPerAuthorV2(3);
      registerSpecV2(null, { specId: "s1", authorId: "a" });
      registerSpecV2(null, {
        specId: "s2",
        authorId: "a",
        initialStatus: "refining",
      });
      registerSpecV2(null, {
        specId: "s3",
        authorId: "a",
        initialStatus: "approved",
      });
      expect(getActiveSpecCount("a")).toBe(3);
      expect(() =>
        registerSpecV2(null, { specId: "s4", authorId: "a" }),
      ).toThrow(/cap/);
    });
  });

  describe("setSpecMaturityV2 + shortcuts", () => {
    beforeEach(() => {
      registerSpecV2(null, { specId: "s", authorId: "a" });
    });

    it("draft → refining → approved → implemented → archived", () => {
      refineSpec(null, "s");
      expect(getSpecV2("s").status).toBe("refining");
      approveSpec(null, "s");
      expect(getSpecV2("s").status).toBe("approved");
      implementSpec(null, "s");
      expect(getSpecV2("s").status).toBe("implemented");
      archiveSpec(null, "s");
      expect(getSpecV2("s").status).toBe("archived");
    });

    it("rejects direct draft → implemented (skipping approved)", () => {
      expect(() => implementSpec(null, "s")).toThrow(/Invalid transition/);
    });

    it("archived is terminal", () => {
      archiveSpec(null, "s");
      expect(() => refineSpec(null, "s")).toThrow(/Invalid transition/);
    });

    it("refining → draft (backwards)", () => {
      refineSpec(null, "s");
      setSpecMaturityV2(null, "s", "draft");
      expect(getSpecV2("s").status).toBe("draft");
    });

    it("implemented → archived only", () => {
      refineSpec(null, "s");
      approveSpec(null, "s");
      implementSpec(null, "s");
      expect(() => setSpecMaturityV2(null, "s", "refining")).toThrow();
    });

    it("patch-merges metadata + reason", () => {
      refineSpec(null, "s", "needs-work");
      const r = getSpecV2("s");
      expect(r.lastReason).toBe("needs-work");
      setSpecMaturityV2(null, "s", "approved", {
        reason: "lgtm",
        metadata: { reviewer: "bob" },
      });
      const r2 = getSpecV2("s");
      expect(r2.lastReason).toBe("lgtm");
      expect(r2.metadata.reviewer).toBe("bob");
    });

    it("throws unknown spec", () => {
      expect(() => refineSpec(null, "nope")).toThrow(/Unknown spec/);
    });
  });

  describe("touchSpecActivity", () => {
    it("bumps lastActivityAt", async () => {
      registerSpecV2(null, { specId: "s", authorId: "a" });
      const before = getSpecV2("s").lastActivityAt;
      await new Promise((r) => setTimeout(r, 5));
      const t = touchSpecActivity("s");
      expect(t.lastActivityAt).toBeGreaterThan(before);
    });

    it("throws unknown", () => {
      expect(() => touchSpecActivity("x")).toThrow();
    });
  });

  describe("registerDialogueTurnV2", () => {
    beforeEach(() => {
      registerSpecV2(null, { specId: "s", authorId: "a" });
    });

    it("creates pending turn", () => {
      const t = registerDialogueTurnV2(null, {
        turnId: "t1",
        specId: "s",
        role: "assistant",
        question: "Which framework?",
      });
      expect(t.status).toBe("pending");
      expect(t.role).toBe("assistant");
    });

    it("accepts escalated initial", () => {
      const t = registerDialogueTurnV2(null, {
        turnId: "t",
        specId: "s",
        initialStatus: "escalated",
      });
      expect(t.status).toBe("escalated");
    });

    it("throws missing required / unknown spec / duplicate", () => {
      expect(() => registerDialogueTurnV2(null, { specId: "s" })).toThrow();
      expect(() => registerDialogueTurnV2(null, { turnId: "t" })).toThrow();
      expect(() =>
        registerDialogueTurnV2(null, { turnId: "t", specId: "nope" }),
      ).toThrow(/Unknown spec/);
      registerDialogueTurnV2(null, { turnId: "t", specId: "s" });
      expect(() =>
        registerDialogueTurnV2(null, { turnId: "t", specId: "s" }),
      ).toThrow(/already/);
    });

    it("throws terminal initial (answered/dismissed)", () => {
      expect(() =>
        registerDialogueTurnV2(null, {
          turnId: "t",
          specId: "s",
          initialStatus: "answered",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces per-spec pending cap", () => {
      setMaxPendingTurnsPerSpecV2(2);
      registerDialogueTurnV2(null, { turnId: "t1", specId: "s" });
      registerDialogueTurnV2(null, { turnId: "t2", specId: "s" });
      expect(() =>
        registerDialogueTurnV2(null, { turnId: "t3", specId: "s" }),
      ).toThrow(/cap/);
    });
  });

  describe("setDialogueTurnStatusV2 + shortcuts", () => {
    beforeEach(() => {
      registerSpecV2(null, { specId: "s", authorId: "a" });
      registerDialogueTurnV2(null, {
        turnId: "t",
        specId: "s",
        question: "q",
      });
    });

    it("pending → answered (stores answer)", () => {
      answerTurn(null, "t", "React", "decided");
      const r = getDialogueTurnV2("t");
      expect(r.status).toBe("answered");
      expect(r.answer).toBe("React");
      expect(r.lastReason).toBe("decided");
    });

    it("pending → dismissed / escalated", () => {
      dismissTurn(null, "t", "irrelevant");
      expect(getDialogueTurnV2("t").status).toBe("dismissed");
    });

    it("escalated → answered / dismissed (recovery)", () => {
      escalateTurn(null, "t");
      answerTurn(null, "t", "use TS");
      expect(getDialogueTurnV2("t").status).toBe("answered");
    });

    it("terminals block further transitions", () => {
      answerTurn(null, "t", "yes");
      expect(() => dismissTurn(null, "t")).toThrow(/Invalid transition/);
    });

    it("patch-merges metadata", () => {
      setDialogueTurnStatusV2(null, "t", "answered", {
        answer: "42",
        metadata: { confidence: 0.9 },
      });
      const r = getDialogueTurnV2("t");
      expect(r.metadata.confidence).toBe(0.9);
    });

    it("throws unknown", () => {
      expect(() => answerTurn(null, "nope", "x")).toThrow(/Unknown turn/);
    });
  });

  describe("counts", () => {
    it("getActiveSpecCount scopes by author", () => {
      registerSpecV2(null, { specId: "s1", authorId: "a" });
      registerSpecV2(null, {
        specId: "s2",
        authorId: "a",
        initialStatus: "approved",
      });
      registerSpecV2(null, { specId: "s3", authorId: "b" });
      registerSpecV2(null, {
        specId: "s4",
        authorId: "a",
        initialStatus: "refining",
      });
      refineSpec(null, "s1");
      approveSpec(null, "s1");
      implementSpec(null, "s1"); // s1 now implemented (non-active)
      expect(getActiveSpecCount()).toBe(3); // s2, s3, s4
      expect(getActiveSpecCount("a")).toBe(2); // s2, s4
      expect(getActiveSpecCount("b")).toBe(1);
    });

    it("getPendingTurnCount scopes by spec", () => {
      registerSpecV2(null, { specId: "s1", authorId: "a" });
      registerSpecV2(null, { specId: "s2", authorId: "a" });
      registerDialogueTurnV2(null, { turnId: "t1", specId: "s1" });
      registerDialogueTurnV2(null, { turnId: "t2", specId: "s1" });
      registerDialogueTurnV2(null, { turnId: "t3", specId: "s2" });
      escalateTurn(null, "t2");
      expect(getPendingTurnCount()).toBe(2);
      expect(getPendingTurnCount("s1")).toBe(1);
      expect(getPendingTurnCount("s2")).toBe(1);
    });
  });

  describe("auto-flip bulk", () => {
    it("autoArchiveIdleSpecs flips draft/refining/approved/implemented past idle", () => {
      registerSpecV2(null, { specId: "s1", authorId: "a" });
      registerSpecV2(null, {
        specId: "s2",
        authorId: "a",
        initialStatus: "approved",
      });
      // archived already terminal (cannot register — skip)
      setSpecIdleMsV2(100);
      const future = _nowMock();
      const r = autoArchiveIdleSpecs(null, future);
      expect(r.count).toBe(2);
      for (const id of ["s1", "s2"])
        expect(getSpecV2(id).status).toBe("archived");
    });

    it("autoDismissStalePendingTurns flips only pending", () => {
      registerSpecV2(null, { specId: "s", authorId: "a" });
      registerDialogueTurnV2(null, { turnId: "t1", specId: "s" });
      registerDialogueTurnV2(null, { turnId: "t2", specId: "s" });
      escalateTurn(null, "t2");
      setTurnPendingMsV2(100);
      const future = _nowMock();
      const r = autoDismissStalePendingTurns(null, future);
      expect(r.count).toBe(1);
      expect(getDialogueTurnV2("t1").status).toBe("dismissed");
      expect(getDialogueTurnV2("t2").status).toBe("escalated");
    });
  });

  describe("getNlProgrammingStatsV2", () => {
    it("returns zero-init enum keys for empty state", () => {
      const s = getNlProgrammingStatsV2();
      expect(s.totalSpecsV2).toBe(0);
      expect(s.totalTurnsV2).toBe(0);
      expect(s.maxActiveSpecsPerAuthor).toBe(30);
      expect(s.maxPendingTurnsPerSpec).toBe(20);
      expect(Object.keys(s.specsByStatus).sort()).toEqual(
        ["approved", "archived", "draft", "implemented", "refining"].sort(),
      );
      expect(Object.keys(s.turnsByStatus).sort()).toEqual(
        ["answered", "dismissed", "escalated", "pending"].sort(),
      );
      for (const v of Object.values(s.specsByStatus)) expect(v).toBe(0);
      for (const v of Object.values(s.turnsByStatus)) expect(v).toBe(0);
    });

    it("counts specs + turns by status", () => {
      registerSpecV2(null, { specId: "s1", authorId: "a" });
      registerSpecV2(null, {
        specId: "s2",
        authorId: "a",
        initialStatus: "approved",
      });
      registerDialogueTurnV2(null, { turnId: "t", specId: "s1" });
      answerTurn(null, "t", "yes");
      const s = getNlProgrammingStatsV2();
      expect(s.totalSpecsV2).toBe(2);
      expect(s.specsByStatus.draft).toBe(1);
      expect(s.specsByStatus.approved).toBe(1);
      expect(s.totalTurnsV2).toBe(1);
      expect(s.turnsByStatus.answered).toBe(1);
    });
  });
});

function _nowMock() {
  return Date.now() + 10000;
}
