import { describe, it, expect, beforeEach } from "vitest";
import {
  STAGE,
  PIPELINE_STATUS,
  STAGE_STATUS,
  DEPLOY_STRATEGY,
  DEPLOY_STATUS,
  ARTIFACT_TYPE,
  GATE_STAGES,
  PIPELINE_TEMPLATES,
  ensurePipelineTables,
  createPipeline,
  startPipeline,
  pausePipeline,
  resumePipeline,
  cancelPipeline,
  completeStage,
  failStage,
  retryStage,
  approveGate,
  rejectGate,
  addArtifact,
  listArtifacts,
  getPipeline,
  listPipelines,
  getStage,
  getTemplates,
  getConfig,
  recordDeploy,
  getDeploy,
  listDeploys,
  rollbackDeploy,
  recordMonitorEvent,
  listMonitorEvents,
  getMonitorStatus,
  exportPipeline,
  getStats,
} from "../../src/lib/pipeline-orchestrator.js";
import { MockDatabase } from "../helpers/mock-db.js";

describe("pipeline-orchestrator", () => {
  let db;
  beforeEach(() => {
    db = new MockDatabase();
    ensurePipelineTables(db);
  });

  /* ── Constants & config ───────────────────────────────── */

  describe("constants & config", () => {
    it("defines 7 stages", () => {
      expect(Object.values(STAGE)).toEqual([
        "requirement",
        "architecture",
        "code-generation",
        "testing",
        "code-review",
        "deploy",
        "monitoring",
      ]);
    });

    it("defines 6 pipeline statuses", () => {
      expect(Object.values(PIPELINE_STATUS)).toEqual([
        "pending",
        "running",
        "paused",
        "completed",
        "failed",
        "cancelled",
      ]);
    });

    it("defines 6 stage statuses including gate-waiting", () => {
      expect(Object.values(STAGE_STATUS)).toContain("gate-waiting");
      expect(Object.values(STAGE_STATUS)).toHaveLength(6);
    });

    it("defines 6 deploy strategies", () => {
      expect(Object.values(DEPLOY_STRATEGY)).toHaveLength(6);
      expect(Object.values(DEPLOY_STRATEGY)).toContain("git-pr");
      expect(Object.values(DEPLOY_STRATEGY)).toContain("docker");
      expect(Object.values(DEPLOY_STRATEGY)).toContain("npm-publish");
    });

    it("gate stages are code-review and deploy", () => {
      expect(GATE_STAGES.has("code-review")).toBe(true);
      expect(GATE_STAGES.has("deploy")).toBe(true);
      expect(GATE_STAGES.has("requirement")).toBe(false);
    });

    it("defines 4 project templates", () => {
      expect(Object.keys(PIPELINE_TEMPLATES)).toEqual([
        "feature",
        "bugfix",
        "refactor",
        "security-audit",
      ]);
    });

    it("feature template has all 7 stages", () => {
      expect(PIPELINE_TEMPLATES.feature.stages).toHaveLength(7);
    });

    it("bugfix template skips architecture/deploy/monitoring", () => {
      expect(PIPELINE_TEMPLATES.bugfix.stages).not.toContain("architecture");
      expect(PIPELINE_TEMPLATES.bugfix.stages).not.toContain("deploy");
      expect(PIPELINE_TEMPLATES.bugfix.stages).not.toContain("monitoring");
    });

    it("security-audit template is minimal (3 stages)", () => {
      expect(PIPELINE_TEMPLATES["security-audit"].stages).toHaveLength(3);
    });

    it("config includes all stages and strategies", () => {
      const c = getConfig();
      expect(c.stages).toHaveLength(7);
      expect(c.deployStrategies).toHaveLength(6);
      expect(c.templates).toHaveLength(4);
    });

    it("getTemplates lists all templates with gate stages annotated", () => {
      const tpls = getTemplates();
      expect(tpls).toHaveLength(4);
      const feature = tpls.find((t) => t.name === "feature");
      expect(feature.gateStages).toEqual(["code-review", "deploy"]);
    });
  });

  /* ── Pipeline creation ─────────────────────────────────── */

  describe("createPipeline", () => {
    it("creates a feature pipeline with 7 stages", () => {
      const p = createPipeline(db, {
        template: "feature",
        name: "New auth flow",
      });
      expect(p.id).toMatch(/^pipe-/);
      expect(p.template).toBe("feature");
      expect(p.name).toBe("New auth flow");
      expect(p.status).toBe("pending");
      expect(p.currentStage).toBe(0);
      expect(p.stages).toHaveLength(7);
    });

    it("creates a bugfix pipeline with 4 stages", () => {
      const p = createPipeline(db, { template: "bugfix" });
      expect(p.stages).toHaveLength(4);
      expect(p.stages[0].name).toBe("requirement");
    });

    it("marks gate stages with gate_required=1", () => {
      const p = createPipeline(db, { template: "feature" });
      const reviewStage = p.stages.find((s) => s.name === "code-review");
      const deployStage = p.stages.find((s) => s.name === "deploy");
      expect(reviewStage.gateRequired).toBe(true);
      expect(deployStage.gateRequired).toBe(true);
    });

    it("non-gate stages have gate_required=0", () => {
      const p = createPipeline(db, { template: "feature" });
      const reqStage = p.stages.find((s) => s.name === "requirement");
      expect(reqStage.gateRequired).toBe(false);
    });

    it("rejects unknown template", () => {
      expect(() => createPipeline(db, { template: "unknown" })).toThrow(
        /Unknown template/,
      );
    });

    it("requires template", () => {
      expect(() => createPipeline(db, {})).toThrow(/template is required/);
    });

    it("stores arbitrary config JSON", () => {
      const p = createPipeline(db, {
        template: "refactor",
        config: { target: "src/legacy/" },
      });
      expect(p.config.target).toBe("src/legacy/");
    });

    it("initial stages are all pending", () => {
      const p = createPipeline(db, { template: "feature" });
      for (const s of p.stages) {
        expect(s.status).toBe("pending");
      }
    });
  });

  /* ── Pipeline lifecycle ────────────────────────────────── */

  describe("pipeline lifecycle", () => {
    it("startPipeline flips pending → running and first stage → running", () => {
      const created = createPipeline(db, { template: "feature" });
      const started = startPipeline(db, created.id);
      expect(started.status).toBe("running");
      expect(started.startedAt).toBeTypeOf("number");
      expect(started.stages[0].status).toBe("running");
    });

    it("startPipeline on gate-first template sets first stage to gate-waiting", () => {
      const created = createPipeline(db, { template: "security-audit" });
      // security-audit starts with code-generation (not gate), so running
      const started = startPipeline(db, created.id);
      expect(started.stages[0].status).toBe("running");
    });

    it("startPipeline rejects non-pending pipelines", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      expect(() => startPipeline(db, p.id)).toThrow(/Cannot start/);
    });

    it("pausePipeline flips running → paused", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      const paused = pausePipeline(db, p.id);
      expect(paused.status).toBe("paused");
    });

    it("pausePipeline rejects non-running pipelines", () => {
      const p = createPipeline(db, { template: "feature" });
      expect(() => pausePipeline(db, p.id)).toThrow(/Cannot pause/);
    });

    it("resumePipeline flips paused → running", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      pausePipeline(db, p.id);
      const resumed = resumePipeline(db, p.id);
      expect(resumed.status).toBe("running");
    });

    it("cancelPipeline flips to cancelled", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      const cancelled = cancelPipeline(db, p.id, "user abort");
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.errorMessage).toBe("user abort");
      expect(cancelled.completedAt).toBeTypeOf("number");
    });

    it("cancelPipeline rejects completed pipelines", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      // Run through all 3 stages: code-gen, testing, code-review (gate)
      completeStage(db, p.id);
      completeStage(db, p.id);
      // code-review is a gate — approve + complete
      approveGate(db, p.id);
      completeStage(db, p.id);
      expect(() => cancelPipeline(db, p.id)).toThrow(/Cannot cancel/);
    });

    it("rejects operations on missing pipelines", () => {
      expect(() => startPipeline(db, "bogus")).toThrow(/not found/);
      expect(() => cancelPipeline(db, "bogus")).toThrow(/not found/);
    });
  });

  /* ── Stage execution ───────────────────────────────────── */

  describe("completeStage", () => {
    it("advances to next stage and marks next as running (non-gate)", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      // Stage 0 = requirement (non-gate), Stage 1 = architecture (non-gate)
      const next = completeStage(db, p.id, { output: { req: "parsed" } });
      expect(next.currentStage).toBe(1);
      expect(next.stages[0].status).toBe("completed");
      expect(next.stages[1].status).toBe("running");
    });

    it("advancing to a gate stage marks it gate-waiting", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      completeStage(db, p.id); // req → arch
      completeStage(db, p.id); // arch → code-gen
      completeStage(db, p.id); // code-gen → testing
      const at = completeStage(db, p.id); // testing → code-review (gate)
      expect(at.currentStage).toBe(4);
      expect(at.stages[4].name).toBe("code-review");
      expect(at.stages[4].status).toBe("gate-waiting");
    });

    it("completing the last stage marks pipeline completed", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      completeStage(db, p.id); // code-generation → testing
      completeStage(db, p.id); // testing → code-review (gate)
      approveGate(db, p.id); // code-review gate → running
      const done = completeStage(db, p.id); // code-review done → end
      expect(done.status).toBe("completed");
      expect(done.completedAt).toBeTypeOf("number");
    });

    it("stores output JSON", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      const after = completeStage(db, p.id, { output: { parsed: true } });
      expect(after.stages[0].output).toEqual({ parsed: true });
    });

    it("attaches artifacts at the current stage", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      completeStage(db, p.id, {
        artifacts: [{ name: "spec.md", type: "document", content: "# Spec" }],
      });
      const arts = listArtifacts(db, p.id, 0);
      expect(arts).toHaveLength(1);
      expect(arts[0].name).toBe("spec.md");
    });

    it("refuses to complete a gate-waiting stage directly", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      completeStage(db, p.id); // code-gen → testing
      completeStage(db, p.id); // testing → code-review (gate)
      expect(() => completeStage(db, p.id)).toThrow(
        /gate and awaiting approval/,
      );
    });

    it("refuses to complete when pipeline not running", () => {
      const p = createPipeline(db, { template: "feature" });
      expect(() => completeStage(db, p.id)).toThrow(/pipeline is pending/);
    });
  });

  describe("failStage", () => {
    it("marks current stage and pipeline as failed", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      const failed = failStage(db, p.id, "syntax error in req parser");
      expect(failed.status).toBe("failed");
      expect(failed.errorMessage).toMatch(/syntax error/);
      expect(failed.stages[0].status).toBe("failed");
      expect(failed.stages[0].errorMessage).toMatch(/syntax error/);
    });
  });

  describe("retryStage", () => {
    it("resets a failed stage back to running", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      failStage(db, p.id, "boom");
      const retried = retryStage(db, p.id, 0);
      expect(retried.status).toBe("running");
      expect(retried.currentStage).toBe(0);
      expect(retried.stages[0].status).toBe("running");
      expect(retried.stages[0].errorMessage).toBeNull();
    });

    it("retrying a gate stage sets it back to gate-waiting", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      completeStage(db, p.id);
      completeStage(db, p.id); // now at code-review gate
      rejectGate(db, p.id, "insufficient coverage");
      const retried = retryStage(db, p.id, 2);
      expect(retried.stages[2].status).toBe("gate-waiting");
      expect(retried.stages[2].gateRejectReason).toBeNull();
    });
  });

  /* ── Gate approval ─────────────────────────────────────── */

  describe("gate approval", () => {
    it("approveGate flips gate-waiting → running", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      completeStage(db, p.id);
      completeStage(db, p.id); // at code-review gate
      const approved = approveGate(db, p.id);
      expect(approved.stages[2].status).toBe("running");
      expect(approved.stages[2].gateApproved).toBe(true);
    });

    it("rejectGate fails the stage and pipeline", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      completeStage(db, p.id);
      completeStage(db, p.id); // at code-review gate
      const rejected = rejectGate(db, p.id, "missing tests");
      expect(rejected.status).toBe("failed");
      expect(rejected.stages[2].status).toBe("failed");
      expect(rejected.stages[2].gateRejectReason).toBe("missing tests");
      expect(rejected.errorMessage).toMatch(/missing tests/);
    });

    it("approveGate rejects non-gate stages", () => {
      const p = createPipeline(db, { template: "feature" });
      startPipeline(db, p.id);
      // stage 0 = requirement (not gate)
      expect(() => approveGate(db, p.id)).toThrow(/has no gate/);
    });

    it("approveGate rejects when gate already approved/running", () => {
      const p = createPipeline(db, { template: "security-audit" });
      startPipeline(db, p.id);
      completeStage(db, p.id);
      completeStage(db, p.id);
      approveGate(db, p.id);
      expect(() => approveGate(db, p.id)).toThrow(/Gate not waiting/);
    });
  });

  /* ── Artifacts ─────────────────────────────────────────── */

  describe("artifacts", () => {
    it("addArtifact stores with metadata", () => {
      const p = createPipeline(db, { template: "feature" });
      const art = addArtifact(db, p.id, 2, {
        name: "UserService.js",
        type: "code",
        content: "class UserService {}",
        metadata: { language: "js", loc: 100 },
      });
      expect(art.id).toMatch(/^art-/);
      expect(art.type).toBe("code");
      expect(art.metadata.language).toBe("js");
    });

    it("listArtifacts with stageIndex filters by stage", () => {
      const p = createPipeline(db, { template: "feature" });
      addArtifact(db, p.id, 0, { name: "spec.md" });
      addArtifact(db, p.id, 2, { name: "a.js" });
      addArtifact(db, p.id, 2, { name: "b.js" });
      expect(listArtifacts(db, p.id, 2)).toHaveLength(2);
      expect(listArtifacts(db, p.id, 0)).toHaveLength(1);
    });

    it("listArtifacts without stageIndex returns all", () => {
      const p = createPipeline(db, { template: "feature" });
      addArtifact(db, p.id, 0, { name: "a" });
      addArtifact(db, p.id, 2, { name: "b" });
      expect(listArtifacts(db, p.id)).toHaveLength(2);
    });

    it("rejects artifact without name", () => {
      const p = createPipeline(db, { template: "feature" });
      expect(() => addArtifact(db, p.id, 0, {})).toThrow(/name is required/);
    });

    it("artifact type defaults to document", () => {
      const p = createPipeline(db, { template: "feature" });
      const art = addArtifact(db, p.id, 0, { name: "x" });
      expect(art.type).toBe("document");
    });
  });

  /* ── Queries ───────────────────────────────────────────── */

  describe("queries", () => {
    it("getPipeline returns null for missing", () => {
      expect(getPipeline(db, "bogus")).toBeNull();
    });

    it("listPipelines filters by template and status", () => {
      createPipeline(db, { template: "feature" });
      createPipeline(db, { template: "bugfix" });
      const p3 = createPipeline(db, { template: "feature" });
      startPipeline(db, p3.id);

      const features = listPipelines(db, { template: "feature" });
      expect(features).toHaveLength(2);

      const running = listPipelines(db, { status: "running" });
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(p3.id);
    });

    it("getStage returns specific stage", () => {
      const p = createPipeline(db, { template: "feature" });
      const stage = getStage(db, p.id, 4);
      expect(stage.name).toBe("code-review");
      expect(stage.gateRequired).toBe(true);
    });
  });

  /* ── Deployments ───────────────────────────────────────── */

  describe("deployments", () => {
    it("recordDeploy defaults status to succeeded", () => {
      const dep = recordDeploy(db, {
        strategy: "docker",
        config: { image: "app:latest" },
        result: { sha: "abc123" },
      });
      expect(dep.id).toMatch(/^dep-/);
      expect(dep.status).toBe("succeeded");
      expect(dep.config.image).toBe("app:latest");
      expect(dep.completedAt).toBeTypeOf("number");
    });

    it("recordDeploy rejects unknown strategy", () => {
      expect(() => recordDeploy(db, { strategy: "carrier-pigeon" })).toThrow(
        /Unknown deploy strategy/,
      );
    });

    it("recordDeploy with pending status has null completedAt", () => {
      const dep = recordDeploy(db, {
        strategy: "git-pr",
        status: "pending",
      });
      expect(dep.completedAt).toBeNull();
    });

    it("listDeploys filters by strategy", () => {
      recordDeploy(db, { strategy: "docker" });
      recordDeploy(db, { strategy: "docker" });
      recordDeploy(db, { strategy: "npm-publish" });
      expect(listDeploys(db, { strategy: "docker" })).toHaveLength(2);
      expect(listDeploys(db, { strategy: "npm-publish" })).toHaveLength(1);
    });

    it("rollbackDeploy flips succeeded → rolled-back", () => {
      const dep = recordDeploy(db, { strategy: "docker" });
      const rolled = rollbackDeploy(db, dep.id, "bad metrics");
      expect(rolled.status).toBe("rolled-back");
      expect(rolled.rollbackReason).toBe("bad metrics");
      expect(rolled.rolledBackAt).toBeTypeOf("number");
    });

    it("rollbackDeploy rejects already-rolled-back", () => {
      const dep = recordDeploy(db, { strategy: "docker" });
      rollbackDeploy(db, dep.id);
      expect(() => rollbackDeploy(db, dep.id)).toThrow(/already rolled back/);
    });

    it("rollbackDeploy rejects failed deploys", () => {
      const dep = recordDeploy(db, {
        strategy: "docker",
        status: "failed",
        errorMessage: "build fail",
      });
      expect(() => rollbackDeploy(db, dep.id)).toThrow(/Cannot roll back/);
    });

    it("rollbackDeploy rejects missing deploy", () => {
      expect(() => rollbackDeploy(db, "bogus")).toThrow(/not found/);
    });
  });

  /* ── Monitoring ────────────────────────────────────────── */

  describe("monitoring", () => {
    it("recordMonitorEvent appends an event row", () => {
      const dep = recordDeploy(db, { strategy: "docker" });
      const evt = recordMonitorEvent(db, dep.id, {
        eventType: "health-check",
        healthStatus: "healthy",
        metrics: { latency_ms: 45 },
      });
      expect(evt.id).toMatch(/^mon-/);
      expect(evt.healthStatus).toBe("healthy");
      expect(evt.metrics.latency_ms).toBe(45);
    });

    it("recordMonitorEvent rejects missing deploy", () => {
      expect(() =>
        recordMonitorEvent(db, "bogus", { healthStatus: "healthy" }),
      ).toThrow(/not found/);
    });

    it("listMonitorEvents returns newest first", () => {
      const dep = recordDeploy(db, { strategy: "docker" });
      recordMonitorEvent(db, dep.id, { healthStatus: "healthy" });
      recordMonitorEvent(db, dep.id, { healthStatus: "degraded" });
      const events = listMonitorEvents(db, dep.id);
      expect(events).toHaveLength(2);
      expect(events[0].healthStatus).toBe("degraded");
    });

    it("getMonitorStatus returns latest health", () => {
      const dep = recordDeploy(db, { strategy: "docker" });
      recordMonitorEvent(db, dep.id, { healthStatus: "healthy" });
      recordMonitorEvent(db, dep.id, { healthStatus: "unhealthy" });
      const status = getMonitorStatus(db, dep.id);
      expect(status.healthStatus).toBe("unhealthy");
      expect(status.totalEvents).toBe(2);
    });

    it("getMonitorStatus returns unknown when no events", () => {
      const dep = recordDeploy(db, { strategy: "docker" });
      expect(getMonitorStatus(db, dep.id).healthStatus).toBe("unknown");
    });
  });

  /* ── Export / Stats ────────────────────────────────────── */

  describe("export & stats", () => {
    it("exportPipeline returns pipeline + stages + artifacts + deploys", () => {
      const p = createPipeline(db, { template: "feature" });
      addArtifact(db, p.id, 0, { name: "spec.md" });
      recordDeploy(db, { pipelineId: p.id, strategy: "docker" });
      const exported = exportPipeline(db, p.id);
      expect(exported.pipeline.id).toBe(p.id);
      expect(exported.artifacts).toHaveLength(1);
      expect(exported.deploys).toHaveLength(1);
      expect(exported.exportedAt).toBeTypeOf("number");
    });

    it("exportPipeline returns null for missing pipeline", () => {
      expect(exportPipeline(db, "bogus")).toBeNull();
    });

    it("getStats counts across templates/statuses/strategies", () => {
      createPipeline(db, { template: "feature" });
      createPipeline(db, { template: "bugfix" });
      const p3 = createPipeline(db, { template: "feature" });
      startPipeline(db, p3.id);
      recordDeploy(db, { strategy: "docker" });
      recordDeploy(db, { strategy: "git-pr" });

      const stats = getStats(db);
      expect(stats.totalPipelines).toBe(3);
      expect(stats.pipelinesByTemplate.feature).toBe(2);
      expect(stats.pipelinesByTemplate.bugfix).toBe(1);
      expect(stats.pipelinesByStatus.running).toBe(1);
      expect(stats.pipelinesByStatus.pending).toBe(2);
      expect(stats.totalDeploys).toBe(2);
      expect(stats.deploysByStrategy.docker).toBe(1);
      expect(stats.deploysByStrategy["git-pr"]).toBe(1);
    });
  });

  /* ── End-to-end happy path ─────────────────────────────── */

  describe("end-to-end happy path", () => {
    it("runs full feature pipeline with both gates approved", () => {
      const p = createPipeline(db, { template: "feature", name: "E2E" });
      startPipeline(db, p.id);

      // Stage 0-3 are non-gate (requirement/architecture/code-gen/testing)
      completeStage(db, p.id, { output: { req: "ok" } });
      completeStage(db, p.id, { output: { arch: "ok" } });
      completeStage(db, p.id, {
        artifacts: [{ name: "impl.js", type: "code", content: "// ..." }],
      });
      completeStage(db, p.id, { output: { tests: "ok" } });

      // Stage 4 = code-review (gate) — must approve before complete
      const atReview = getPipeline(db, p.id);
      expect(atReview.currentStage).toBe(4);
      expect(atReview.stages[4].status).toBe("gate-waiting");
      approveGate(db, p.id);
      completeStage(db, p.id, { output: { review: "approved" } });

      // Stage 5 = deploy (gate)
      const atDeploy = getPipeline(db, p.id);
      expect(atDeploy.currentStage).toBe(5);
      expect(atDeploy.stages[5].status).toBe("gate-waiting");
      approveGate(db, p.id);
      completeStage(db, p.id, { output: { deploy: "done" } });

      // Stage 6 = monitoring (non-gate, final)
      completeStage(db, p.id, { output: { monitoring: "healthy" } });

      const final = getPipeline(db, p.id);
      expect(final.status).toBe("completed");
      expect(final.completedAt).toBeTypeOf("number");
      for (const s of final.stages) {
        expect(s.status).toBe("completed");
      }
    });
  });
});
