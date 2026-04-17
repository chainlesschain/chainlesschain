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

  // Phase 86 V2
  AGENT_MATURITY_V2,
  GEN_JOB_V2,
  CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER,
  CGA_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER,
  CGA_DEFAULT_AGENT_IDLE_MS,
  CGA_DEFAULT_JOB_STUCK_MS,
  getDefaultMaxActiveAgentsPerOwnerV2,
  getMaxActiveAgentsPerOwnerV2,
  setMaxActiveAgentsPerOwnerV2,
  getDefaultMaxRunningJobsPerOwnerV2,
  getMaxRunningJobsPerOwnerV2,
  setMaxRunningJobsPerOwnerV2,
  getDefaultAgentIdleMsV2,
  getAgentIdleMsV2,
  setAgentIdleMsV2,
  getDefaultJobStuckMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerAgentV2,
  getAgentV2,
  setAgentMaturityV2,
  activateAgent,
  deprecateAgent,
  retireAgent,
  touchAgentInvocation,
  enqueueGenJobV2,
  getGenJobV2,
  setGenJobStatusV2,
  startGenJob,
  succeedGenJob,
  failGenJob,
  cancelGenJob,
  getActiveAgentCount,
  getRunningJobCount,
  autoRetireIdleAgents,
  autoFailStuckGenJobs,
  getCodeAgentStatsV2,
  _resetStateV2,
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

/* ═════════════════════════════════════════════════════════ *
 *  Phase 86 V2 — Agent Maturity + Generation Job
 * ═════════════════════════════════════════════════════════ */

describe("code-agent V2 (Phase 86)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("AGENT_MATURITY_V2 has 4 frozen states", () => {
      expect(Object.keys(AGENT_MATURITY_V2)).toHaveLength(4);
      expect(Object.isFrozen(AGENT_MATURITY_V2)).toBe(true);
      expect(AGENT_MATURITY_V2.DRAFT).toBe("draft");
      expect(AGENT_MATURITY_V2.RETIRED).toBe("retired");
    });

    it("GEN_JOB_V2 has 5 frozen states", () => {
      expect(Object.keys(GEN_JOB_V2)).toHaveLength(5);
      expect(Object.isFrozen(GEN_JOB_V2)).toBe(true);
      expect(GEN_JOB_V2.SUCCEEDED).toBe("succeeded");
      expect(GEN_JOB_V2.CANCELED).toBe("canceled");
    });
  });

  describe("config + setters", () => {
    it("exposes defaults + getters", () => {
      expect(getDefaultMaxActiveAgentsPerOwnerV2()).toBe(
        CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER,
      );
      expect(getDefaultMaxRunningJobsPerOwnerV2()).toBe(
        CGA_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER,
      );
      expect(getDefaultAgentIdleMsV2()).toBe(CGA_DEFAULT_AGENT_IDLE_MS);
      expect(getDefaultJobStuckMsV2()).toBe(CGA_DEFAULT_JOB_STUCK_MS);
      expect(getMaxActiveAgentsPerOwnerV2()).toBe(
        CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER,
      );
    });

    it("setters validate positive", () => {
      expect(setMaxActiveAgentsPerOwnerV2(5)).toBe(5);
      expect(setMaxRunningJobsPerOwnerV2(2)).toBe(2);
      expect(setAgentIdleMsV2(60000)).toBe(60000);
      expect(setJobStuckMsV2(30000)).toBe(30000);
      expect(() => setMaxActiveAgentsPerOwnerV2(0)).toThrow(/positive/);
      expect(() => setJobStuckMsV2(-1)).toThrow(/positive/);
      expect(() => setAgentIdleMsV2("abc")).toThrow(/positive/);
    });
  });

  describe("registerAgentV2", () => {
    it("registers with draft default", () => {
      const r = registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
      expect(r.status).toBe("draft");
      expect(r.name).toBe("a1");
    });

    it("validates required", () => {
      expect(() => registerAgentV2(null, {})).toThrow(/agentId/);
      expect(() => registerAgentV2(null, { agentId: "a" })).toThrow(/ownerId/);
    });

    it("rejects duplicate + invalid/terminal initial", () => {
      registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
      expect(() =>
        registerAgentV2(null, { agentId: "a1", ownerId: "u2" }),
      ).toThrow(/already exists/);
      expect(() =>
        registerAgentV2(null, {
          agentId: "a2",
          ownerId: "u1",
          initialStatus: "galaxy",
        }),
      ).toThrow(/Invalid initial status/);
      expect(() =>
        registerAgentV2(null, {
          agentId: "a2",
          ownerId: "u1",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces active cap on register", () => {
      setMaxActiveAgentsPerOwnerV2(1);
      registerAgentV2(null, {
        agentId: "a1",
        ownerId: "u1",
        initialStatus: "active",
      });
      expect(() =>
        registerAgentV2(null, {
          agentId: "a2",
          ownerId: "u1",
          initialStatus: "active",
        }),
      ).toThrow(/cap/);
    });
  });

  describe("setAgentMaturityV2 + shortcuts", () => {
    beforeEach(() => {
      registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
    });

    it("draft → active → deprecated → active", () => {
      activateAgent(null, "a1");
      deprecateAgent(null, "a1");
      activateAgent(null, "a1");
      expect(getAgentV2("a1").status).toBe("active");
    });

    it("retire is terminal", () => {
      retireAgent(null, "a1");
      expect(() => activateAgent(null, "a1")).toThrow(/Invalid transition/);
    });

    it("rejects unknown + invalid status + invalid transition", () => {
      expect(() => activateAgent(null, "nope")).toThrow(/Unknown/);
      expect(() => setAgentMaturityV2(null, "a1", "galaxy")).toThrow(
        /Invalid status/,
      );
      expect(() => deprecateAgent(null, "a1")).toThrow(/Invalid transition/);
    });

    it("enforces active cap on re-activate", () => {
      setMaxActiveAgentsPerOwnerV2(1);
      activateAgent(null, "a1");
      registerAgentV2(null, { agentId: "a2", ownerId: "u1" });
      expect(() => activateAgent(null, "a2")).toThrow(/cap/);
    });

    it("merges reason + metadata", () => {
      const r = setAgentMaturityV2(null, "a1", "active", {
        reason: "ok",
        metadata: { k: "v" },
      });
      expect(r.lastReason).toBe("ok");
      expect(r.metadata.k).toBe("v");
    });
  });

  describe("touchAgentInvocation", () => {
    it("updates lastInvokedAt", async () => {
      registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
      const before = getAgentV2("a1").lastInvokedAt;
      await new Promise((r) => setTimeout(r, 2));
      const r = touchAgentInvocation("a1");
      expect(r.lastInvokedAt).toBeGreaterThanOrEqual(before);
    });

    it("throws unknown", () => {
      expect(() => touchAgentInvocation("nope")).toThrow(/Unknown/);
    });
  });

  describe("enqueueGenJobV2 + lifecycle", () => {
    it("enqueues queued", () => {
      const r = enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u1",
        agentId: "a1",
        prompt: "hi",
      });
      expect(r.status).toBe("queued");
    });

    it("validates required + duplicate", () => {
      expect(() => enqueueGenJobV2(null, {})).toThrow(/jobId/);
      expect(() => enqueueGenJobV2(null, { jobId: "j" })).toThrow(/ownerId/);
      expect(() => enqueueGenJobV2(null, { jobId: "j", ownerId: "u" })).toThrow(
        /agentId/,
      );
      expect(() =>
        enqueueGenJobV2(null, { jobId: "j", ownerId: "u", agentId: "a" }),
      ).toThrow(/prompt/);
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      expect(() =>
        enqueueGenJobV2(null, {
          jobId: "j1",
          ownerId: "u",
          agentId: "a",
          prompt: "p",
        }),
      ).toThrow(/already exists/);
    });

    it("queued → running → succeeded", () => {
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u1",
        agentId: "a1",
        prompt: "p",
      });
      const s = startGenJob(null, "j1");
      expect(s.status).toBe("running");
      expect(s.startedAt).toBeGreaterThan(0);
      succeedGenJob(null, "j1");
      expect(getGenJobV2("j1").status).toBe("succeeded");
    });

    it("queued → failed / canceled both valid", () => {
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      failGenJob(null, "j1");
      enqueueGenJobV2(null, {
        jobId: "j2",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      cancelGenJob(null, "j2");
      expect(getGenJobV2("j1").status).toBe("failed");
      expect(getGenJobV2("j2").status).toBe("canceled");
    });

    it("terminals reject further transitions", () => {
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      startGenJob(null, "j1");
      succeedGenJob(null, "j1");
      expect(() => failGenJob(null, "j1")).toThrow(/Invalid transition/);
    });

    it("running cap enforced", () => {
      setMaxRunningJobsPerOwnerV2(1);
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      enqueueGenJobV2(null, {
        jobId: "j2",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      startGenJob(null, "j1");
      expect(() => startGenJob(null, "j2")).toThrow(/cap/);
    });

    it("rejects unknown", () => {
      expect(() => startGenJob(null, "nope")).toThrow(/Unknown/);
    });
  });

  describe("counts + auto-flips + stats", () => {
    it("counts active agents and running jobs", () => {
      registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
      registerAgentV2(null, { agentId: "a2", ownerId: "u2" });
      activateAgent(null, "a1");
      activateAgent(null, "a2");
      expect(getActiveAgentCount()).toBe(2);
      expect(getActiveAgentCount("u1")).toBe(1);

      setMaxRunningJobsPerOwnerV2(5);
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u1",
        agentId: "a1",
        prompt: "p",
      });
      enqueueGenJobV2(null, {
        jobId: "j2",
        ownerId: "u2",
        agentId: "a2",
        prompt: "p",
      });
      startGenJob(null, "j1");
      startGenJob(null, "j2");
      expect(getRunningJobCount()).toBe(2);
      expect(getRunningJobCount("u1")).toBe(1);
    });

    it("autoRetireIdleAgents flips active + deprecated", () => {
      registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
      activateAgent(null, "a1");
      registerAgentV2(null, { agentId: "a2", ownerId: "u1" });
      activateAgent(null, "a2");
      deprecateAgent(null, "a2");
      registerAgentV2(null, { agentId: "a3", ownerId: "u1" }); // draft stays
      const now = Date.now() + CGA_DEFAULT_AGENT_IDLE_MS + 1;
      const r = autoRetireIdleAgents(null, now);
      expect(r.count).toBe(2);
      expect(r.flipped.sort()).toEqual(["a1", "a2"]);
      expect(getAgentV2("a3").status).toBe("draft");
    });

    it("autoFailStuckGenJobs flips only RUNNING", () => {
      setMaxRunningJobsPerOwnerV2(5);
      enqueueGenJobV2(null, {
        jobId: "j1",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      enqueueGenJobV2(null, {
        jobId: "j2",
        ownerId: "u",
        agentId: "a",
        prompt: "p",
      });
      startGenJob(null, "j1"); // running
      // j2 stays queued
      const now = Date.now() + CGA_DEFAULT_JOB_STUCK_MS + 1;
      const r = autoFailStuckGenJobs(null, now);
      expect(r.count).toBe(1);
      expect(r.flipped).toEqual(["j1"]);
      expect(getGenJobV2("j2").status).toBe("queued");
    });

    it("stats zero-initializes all enum keys", () => {
      const s = getCodeAgentStatsV2();
      expect(s.totalAgentsV2).toBe(0);
      for (const k of Object.values(AGENT_MATURITY_V2))
        expect(s.agentsByStatus[k]).toBe(0);
      for (const k of Object.values(GEN_JOB_V2))
        expect(s.jobsByStatus[k]).toBe(0);
    });
  });

  describe("_resetStateV2", () => {
    it("clears maps + restores config defaults", () => {
      setMaxActiveAgentsPerOwnerV2(99);
      registerAgentV2(null, { agentId: "a1", ownerId: "u1" });
      _resetStateV2();
      expect(getMaxActiveAgentsPerOwnerV2()).toBe(
        CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER,
      );
      expect(getAgentV2("a1")).toBeNull();
    });
  });
});
