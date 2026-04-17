import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  SCAFFOLD_TEMPLATE,
  REVIEW_SEVERITY,
  SECURITY_RULE,
  CICD_PLATFORM,
  ensureCodeAgentTables,
  createGeneration,
  getGeneration,
  listGenerations,
  reviewCode,
  getReview,
  listReviews,
  createScaffold,
  getScaffold,
  listScaffolds,
  getCodeAgentStats,
  _resetState,
} from "../../src/lib/code-agent.js";

describe("code-agent", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureCodeAgentTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureCodeAgentTables", () => {
    it("creates all three tables", () => {
      expect(db.tables.has("code_generations")).toBe(true);
      expect(db.tables.has("code_reviews")).toBe(true);
      expect(db.tables.has("code_scaffolds")).toBe(true);
    });

    it("is idempotent", () => {
      ensureCodeAgentTables(db);
      expect(db.tables.has("code_generations")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 5 scaffold templates", () => {
      expect(Object.keys(SCAFFOLD_TEMPLATE)).toHaveLength(5);
    });

    it("has 5 review severities", () => {
      expect(Object.keys(REVIEW_SEVERITY)).toHaveLength(5);
    });

    it("has 5 security rules", () => {
      expect(Object.keys(SECURITY_RULE)).toHaveLength(5);
    });

    it("has 3 CI/CD platforms", () => {
      expect(Object.keys(CICD_PLATFORM)).toHaveLength(3);
    });
  });

  /* ── Code Generation ─────────────────────────────── */

  describe("createGeneration", () => {
    it("creates a generation record", () => {
      const r = createGeneration(db, {
        prompt: "Create a REST API",
        language: "javascript",
        framework: "express",
        fileCount: 5,
        tokenCount: 2000,
      });
      expect(r.generationId).toBeTruthy();
      const g = getGeneration(db, r.generationId);
      expect(g.prompt).toBe("Create a REST API");
      expect(g.language).toBe("javascript");
      expect(g.framework).toBe("express");
      expect(g.file_count).toBe(5);
      expect(g.token_count).toBe(2000);
    });

    it("rejects missing prompt", () => {
      const r = createGeneration(db, { language: "python" });
      expect(r.generationId).toBeNull();
      expect(r.reason).toBe("missing_prompt");
    });

    it("stores generated code and metadata", () => {
      const { generationId } = createGeneration(db, {
        prompt: "Build login page",
        generatedCode: "const app = express();",
        metadata: '{"model":"gpt-4"}',
      });
      const g = getGeneration(db, generationId);
      expect(g.generated_code).toBe("const app = express();");
      expect(g.metadata).toBe('{"model":"gpt-4"}');
    });

    it("defaults optional fields", () => {
      const { generationId } = createGeneration(db, { prompt: "Hello" });
      const g = getGeneration(db, generationId);
      expect(g.language).toBeNull();
      expect(g.framework).toBeNull();
      expect(g.file_count).toBe(0);
      expect(g.token_count).toBe(0);
    });
  });

  describe("listGenerations", () => {
    it("lists all generations", () => {
      createGeneration(db, { prompt: "A", language: "python" });
      createGeneration(db, { prompt: "B", language: "javascript" });
      expect(listGenerations(db)).toHaveLength(2);
    });

    it("filters by language", () => {
      createGeneration(db, { prompt: "A", language: "python" });
      createGeneration(db, { prompt: "B", language: "javascript" });
      expect(listGenerations(db, { language: "python" })).toHaveLength(1);
    });

    it("filters by framework", () => {
      createGeneration(db, { prompt: "A", framework: "react" });
      createGeneration(db, { prompt: "B", framework: "vue" });
      expect(listGenerations(db, { framework: "react" })).toHaveLength(1);
    });

    it("returns null for unknown id", () => {
      expect(getGeneration(db, "nope")).toBeNull();
    });
  });

  /* ── Code Review ─────────────────────────────────── */

  describe("reviewCode", () => {
    it("detects eval usage", () => {
      const r = reviewCode(db, {
        code: 'const x = eval("1+1");',
        language: "javascript",
      });
      expect(r.reviewId).toBeTruthy();
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
      expect(r.securityIssues).toBeGreaterThanOrEqual(1);
      expect(r.severitySummary.high).toBeGreaterThanOrEqual(1);
    });

    it("detects SQL injection", () => {
      const r = reviewCode(db, {
        code: 'db.query("SELECT * FROM users WHERE id=" + userId);',
        language: "javascript",
      });
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
    });

    it("detects XSS via innerHTML", () => {
      const r = reviewCode(db, {
        code: "el.innerHTML = userInput;",
        language: "javascript",
      });
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
    });

    it("detects path traversal", () => {
      const r = reviewCode(db, {
        code: 'fs.readFileSync("../../etc/passwd");',
        language: "javascript",
      });
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
    });

    it("detects command injection", () => {
      const r = reviewCode(db, {
        code: "import os\nos.system(user_input)",
        language: "python",
      });
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
    });

    it("returns clean review for safe code", () => {
      const r = reviewCode(db, {
        code: "const sum = (a, b) => a + b;\nconsole.log(sum(1, 2));",
        language: "javascript",
      });
      expect(r.issuesFound).toBe(0);
      expect(r.securityIssues).toBe(0);
    });

    it("links to generation id", () => {
      const { generationId } = createGeneration(db, {
        prompt: "Make API",
        language: "javascript",
      });
      const { reviewId } = reviewCode(db, {
        generationId,
        code: "const x = 1;",
      });
      const review = getReview(db, reviewId);
      expect(review.generation_id).toBe(generationId);
    });

    it("computes code hash", () => {
      const { reviewId } = reviewCode(db, { code: "hello" });
      const review = getReview(db, reviewId);
      expect(review.code_hash).toBeTruthy();
      expect(review.code_hash.length).toBe(16);
    });

    it("rejects missing code", () => {
      const r = reviewCode(db, {});
      expect(r.reviewId).toBeNull();
      expect(r.reason).toBe("missing_code");
    });

    it("detects dangerouslySetInnerHTML", () => {
      const r = reviewCode(db, {
        code: "<div dangerouslySetInnerHTML={{__html: data}} />",
        language: "jsx",
      });
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
    });

    it("detects new Function constructor", () => {
      const r = reviewCode(db, {
        code: 'const fn = new Function("return " + x);',
        language: "javascript",
      });
      expect(r.issuesFound).toBeGreaterThanOrEqual(1);
    });
  });

  describe("listReviews", () => {
    it("lists reviews", () => {
      reviewCode(db, { code: "const x = 1;", language: "javascript" });
      reviewCode(db, { code: "x = 1", language: "python" });
      expect(listReviews(db)).toHaveLength(2);
    });

    it("filters by language", () => {
      reviewCode(db, { code: "const x = 1;", language: "javascript" });
      reviewCode(db, { code: "x = 1", language: "python" });
      expect(listReviews(db, { language: "python" })).toHaveLength(1);
    });

    it("returns null for unknown id", () => {
      expect(getReview(db, "nope")).toBeNull();
    });
  });

  /* ── Scaffold ────────────────────────────────────── */

  describe("createScaffold", () => {
    it("creates a scaffold record", () => {
      const r = createScaffold(db, {
        template: "react",
        projectName: "my-app",
        filesGenerated: 12,
        outputPath: "./my-app",
      });
      expect(r.scaffoldId).toBeTruthy();
      const s = getScaffold(db, r.scaffoldId);
      expect(s.template).toBe("react");
      expect(s.project_name).toBe("my-app");
      expect(s.files_generated).toBe(12);
    });

    it("rejects invalid template", () => {
      const r = createScaffold(db, {
        template: "django",
        projectName: "test",
      });
      expect(r.scaffoldId).toBeNull();
      expect(r.reason).toBe("invalid_template");
    });

    it("rejects missing project name", () => {
      const r = createScaffold(db, { template: "vue" });
      expect(r.scaffoldId).toBeNull();
      expect(r.reason).toBe("missing_project_name");
    });

    it("stores options JSON", () => {
      const { scaffoldId } = createScaffold(db, {
        template: "express",
        projectName: "api",
        options: '{"typescript":true}',
      });
      expect(getScaffold(db, scaffoldId).options).toBe('{"typescript":true}');
    });

    it("accepts all valid templates", () => {
      for (const tmpl of Object.values(SCAFFOLD_TEMPLATE)) {
        const r = createScaffold(db, {
          template: tmpl,
          projectName: `proj-${tmpl}`,
        });
        expect(r.scaffoldId).toBeTruthy();
      }
    });
  });

  describe("listScaffolds", () => {
    it("lists scaffolds", () => {
      createScaffold(db, { template: "react", projectName: "a" });
      createScaffold(db, { template: "vue", projectName: "b" });
      expect(listScaffolds(db)).toHaveLength(2);
    });

    it("filters by template", () => {
      createScaffold(db, { template: "react", projectName: "a" });
      createScaffold(db, { template: "vue", projectName: "b" });
      createScaffold(db, { template: "react", projectName: "c" });
      expect(listScaffolds(db, { template: "react" })).toHaveLength(2);
    });

    it("returns null for unknown id", () => {
      expect(getScaffold(db, "nope")).toBeNull();
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getCodeAgentStats", () => {
    it("returns zeros when empty", () => {
      const s = getCodeAgentStats(db);
      expect(s.generations.total).toBe(0);
      expect(s.reviews.total).toBe(0);
      expect(s.scaffolds.total).toBe(0);
    });

    it("computes correct stats", () => {
      createGeneration(db, {
        prompt: "A",
        language: "python",
        tokenCount: 1000,
        fileCount: 3,
      });
      createGeneration(db, {
        prompt: "B",
        language: "javascript",
        tokenCount: 2000,
        fileCount: 5,
      });
      reviewCode(db, { code: 'eval("x")', language: "javascript" });
      reviewCode(db, { code: "const x = 1;", language: "javascript" });
      createScaffold(db, { template: "react", projectName: "a" });
      createScaffold(db, { template: "react", projectName: "b" });
      createScaffold(db, { template: "vue", projectName: "c" });

      const s = getCodeAgentStats(db);
      expect(s.generations.total).toBe(2);
      expect(s.generations.totalTokens).toBe(3000);
      expect(s.generations.totalFiles).toBe(8);
      expect(s.generations.uniqueLanguages).toBe(2);
      expect(s.reviews.total).toBe(2);
      expect(s.reviews.totalIssues).toBeGreaterThanOrEqual(1);
      expect(s.scaffolds.total).toBe(3);
      expect(s.scaffolds.byTemplate.react).toBe(2);
      expect(s.scaffolds.byTemplate.vue).toBe(1);
    });
  });
});
