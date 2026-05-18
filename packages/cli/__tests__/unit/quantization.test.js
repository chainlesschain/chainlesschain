import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  JOB_STATUS,
  QUANT_TYPE,
  GGUF_LEVELS,
  GPTQ_BITS,
  ensureQuantizationTables,
  createJob,
  getJob,
  listJobs,
  startJob,
  updateProgress,
  completeJob,
  failJob,
  cancelJob,
  deleteJob,
  getQuantizationStats,
  _resetState,
} from "../../src/lib/quantization.js";

describe("quantization", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureQuantizationTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureQuantizationTables", () => {
    it("creates the table", () => {
      expect(db.tables.has("quantization_jobs")).toBe(true);
    });

    it("is idempotent", () => {
      ensureQuantizationTables(db);
      expect(db.tables.has("quantization_jobs")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 5 job statuses", () => {
      expect(Object.keys(JOB_STATUS)).toHaveLength(5);
    });

    it("has 2 quant types", () => {
      expect(Object.keys(QUANT_TYPE)).toHaveLength(2);
    });

    it("has 14 GGUF levels", () => {
      expect(GGUF_LEVELS).toHaveLength(14);
    });

    it("has 4 GPTQ bit widths", () => {
      expect(GPTQ_BITS).toHaveLength(4);
      expect(GPTQ_BITS).toEqual([2, 3, 4, 8]);
    });

    it("GGUF levels have correct structure", () => {
      for (const l of GGUF_LEVELS) {
        expect(l).toHaveProperty("level");
        expect(l).toHaveProperty("bits");
        expect(l).toHaveProperty("description");
        expect(typeof l.bits).toBe("number");
      }
    });

    it("Q4_K_M is recommended", () => {
      const q4km = GGUF_LEVELS.find((l) => l.level === "Q4_K_M");
      expect(q4km).toBeTruthy();
      expect(q4km.description).toContain("推荐");
    });
  });

  /* ── Job Creation ─────────────────────────────────── */

  describe("createJob", () => {
    it("creates a GGUF job", () => {
      const r = createJob(db, {
        inputPath: "/models/llama.safetensors",
        outputPath: "/models/llama-q4.gguf",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      expect(r.created).toBe(true);
      expect(r.jobId).toBeTruthy();
    });

    it("creates a GPTQ job", () => {
      const r = createJob(db, {
        inputPath: "/models/llama",
        quantType: "gptq",
        config: { bits: 4, groupSize: 128 },
      });
      expect(r.created).toBe(true);
    });

    it("rejects missing input path", () => {
      expect(
        createJob(db, { quantType: "gguf", quantLevel: "Q4_K_M" }).reason,
      ).toBe("missing_input_path");
    });

    it("rejects invalid quant type", () => {
      expect(
        createJob(db, { inputPath: "/m", quantType: "invalid" }).reason,
      ).toBe("invalid_quant_type");
    });

    it("rejects missing GGUF level", () => {
      expect(createJob(db, { inputPath: "/m", quantType: "gguf" }).reason).toBe(
        "missing_quant_level",
      );
    });

    it("rejects invalid GGUF level", () => {
      expect(
        createJob(db, { inputPath: "/m", quantType: "gguf", quantLevel: "Q99" })
          .reason,
      ).toBe("invalid_gguf_level");
    });

    it("rejects invalid GPTQ bits", () => {
      expect(
        createJob(db, {
          inputPath: "/m",
          quantType: "gptq",
          config: { bits: 5 },
        }).reason,
      ).toBe("invalid_gptq_bits");
    });

    it("stores job in db", () => {
      const { jobId } = createJob(db, {
        inputPath: "/models/llama.safetensors",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      const j = getJob(db, jobId);
      expect(j.input_path).toBe("/models/llama.safetensors");
      expect(j.quant_type).toBe("gguf");
      expect(j.quant_level).toBe("Q4_K_M");
      expect(j.status).toBe("pending");
      expect(j.progress).toBe(0);
    });

    it("accepts config as JSON string", () => {
      const r = createJob(db, {
        inputPath: "/m",
        quantType: "gptq",
        config: '{"bits":4}',
      });
      expect(r.created).toBe(true);
      const j = getJob(db, r.jobId);
      expect(j.config).toBe('{"bits":4}');
    });
  });

  /* ── Job Lifecycle ────────────────────────────────── */

  describe("startJob", () => {
    it("starts a pending job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      const r = startJob(db, jobId);
      expect(r.started).toBe(true);
      expect(getJob(db, jobId).status).toBe("running");
      expect(getJob(db, jobId).started_at).toBeTruthy();
    });

    it("rejects starting a non-pending job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      expect(startJob(db, jobId).reason).toBe("not_pending");
    });

    it("rejects unknown id", () => {
      expect(startJob(db, "nope").reason).toBe("not_found");
    });
  });

  describe("updateProgress", () => {
    it("updates progress on running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      const r = updateProgress(db, jobId, 50);
      expect(r.updated).toBe(true);
      expect(r.progress).toBe(50);
      expect(getJob(db, jobId).progress).toBe(50);
    });

    it("clamps progress to 0-100", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      expect(updateProgress(db, jobId, 150).progress).toBe(100);
      expect(updateProgress(db, jobId, -5).progress).toBe(0);
    });

    it("rejects non-running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      expect(updateProgress(db, jobId, 50).reason).toBe("not_running");
    });

    it("rejects unknown id", () => {
      expect(updateProgress(db, "nope", 50).reason).toBe("not_found");
    });
  });

  describe("completeJob", () => {
    it("completes a running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      const r = completeJob(db, jobId, {
        outputPath: "/out.gguf",
        fileSizeBytes: 4096,
      });
      expect(r.completed).toBe(true);
      const j = getJob(db, jobId);
      expect(j.status).toBe("completed");
      expect(j.progress).toBe(100);
      expect(j.output_path).toBe("/out.gguf");
      expect(j.file_size_bytes).toBe(4096);
      expect(j.completed_at).toBeTruthy();
    });

    it("rejects non-running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      expect(completeJob(db, jobId).reason).toBe("not_running");
    });

    it("rejects unknown id", () => {
      expect(completeJob(db, "nope").reason).toBe("not_found");
    });
  });

  describe("failJob", () => {
    it("fails a running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      const r = failJob(db, jobId, "out of memory");
      expect(r.failed).toBe(true);
      const j = getJob(db, jobId);
      expect(j.status).toBe("failed");
      expect(j.error_message).toBe("out of memory");
    });

    it("fails a pending job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      expect(failJob(db, jobId, "cancelled by user").failed).toBe(true);
    });

    it("rejects completed job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      completeJob(db, jobId);
      expect(failJob(db, jobId).reason).toBe("not_active");
    });

    it("rejects unknown id", () => {
      expect(failJob(db, "nope").reason).toBe("not_found");
    });
  });

  describe("cancelJob", () => {
    it("cancels a pending job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      expect(cancelJob(db, jobId).cancelled).toBe(true);
      expect(getJob(db, jobId).status).toBe("cancelled");
    });

    it("cancels a running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      expect(cancelJob(db, jobId).cancelled).toBe(true);
    });

    it("rejects cancelling completed job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      completeJob(db, jobId);
      expect(cancelJob(db, jobId).reason).toBe("already_terminal");
    });

    it("rejects cancelling already cancelled job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      cancelJob(db, jobId);
      expect(cancelJob(db, jobId).reason).toBe("already_terminal");
    });

    it("rejects unknown id", () => {
      expect(cancelJob(db, "nope").reason).toBe("not_found");
    });
  });

  describe("deleteJob", () => {
    it("deletes a pending job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      expect(deleteJob(db, jobId).deleted).toBe(true);
      expect(getJob(db, jobId)).toBeNull();
    });

    it("deletes a completed job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      completeJob(db, jobId);
      expect(deleteJob(db, jobId).deleted).toBe(true);
    });

    it("rejects deleting a running job", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      startJob(db, jobId);
      expect(deleteJob(db, jobId).reason).toBe("still_running");
    });

    it("rejects unknown id", () => {
      expect(deleteJob(db, "nope").reason).toBe("not_found");
    });
  });

  /* ── Query ───────────────────────────────────────── */

  describe("getJob / listJobs", () => {
    it("returns null for unknown id", () => {
      expect(getJob(db, "nope")).toBeNull();
    });

    it("lists all jobs", () => {
      createJob(db, {
        inputPath: "/m1",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      createJob(db, { inputPath: "/m2", quantType: "gptq" });
      expect(listJobs(db)).toHaveLength(2);
    });

    it("filters by status", () => {
      const { jobId } = createJob(db, {
        inputPath: "/m1",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      createJob(db, {
        inputPath: "/m2",
        quantType: "gguf",
        quantLevel: "Q8_0",
      });
      startJob(db, jobId);
      expect(listJobs(db, { status: "running" })).toHaveLength(1);
      expect(listJobs(db, { status: "pending" })).toHaveLength(1);
    });

    it("filters by quant type", () => {
      createJob(db, {
        inputPath: "/m1",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      createJob(db, { inputPath: "/m2", quantType: "gptq" });
      expect(listJobs(db, { quantType: "gguf" })).toHaveLength(1);
      expect(listJobs(db, { quantType: "gptq" })).toHaveLength(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createJob(db, {
          inputPath: `/m${i}`,
          quantType: "gguf",
          quantLevel: "Q4_K_M",
        });
      }
      expect(listJobs(db, { limit: 3 })).toHaveLength(3);
    });

    it("sorts by created_at descending", () => {
      createJob(db, {
        inputPath: "/m1",
        quantType: "gguf",
        quantLevel: "Q2_K",
      });
      createJob(db, {
        inputPath: "/m2",
        quantType: "gguf",
        quantLevel: "Q8_0",
      });
      const list = listJobs(db);
      expect(list[0].created_at).toBeGreaterThanOrEqual(list[1].created_at);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getQuantizationStats", () => {
    it("returns zeros when empty", () => {
      const s = getQuantizationStats(db);
      expect(s.total).toBe(0);
      expect(s.completed).toBe(0);
      expect(s.totalSizeBytes).toBe(0);
      expect(s.avgDurationMs).toBe(0);
    });

    it("computes correct stats", () => {
      const { jobId: j1 } = createJob(db, {
        inputPath: "/m1",
        quantType: "gguf",
        quantLevel: "Q4_K_M",
      });
      const { jobId: j2 } = createJob(db, {
        inputPath: "/m2",
        quantType: "gptq",
      });
      createJob(db, {
        inputPath: "/m3",
        quantType: "gguf",
        quantLevel: "Q8_0",
      });

      startJob(db, j1);
      completeJob(db, j1, { fileSizeBytes: 1024 });
      startJob(db, j2);
      completeJob(db, j2, { fileSizeBytes: 2048 });

      const s = getQuantizationStats(db);
      expect(s.total).toBe(3);
      expect(s.completed).toBe(2);
      expect(s.byStatus.completed).toBe(2);
      expect(s.byStatus.pending).toBe(1);
      expect(s.byType.gguf).toBe(2);
      expect(s.byType.gptq).toBe(1);
      expect(s.byLevel.Q4_K_M).toBe(1);
      expect(s.byLevel.Q8_0).toBe(1);
      expect(s.totalSizeBytes).toBe(3072);
    });
  });
});

/* ═════════════════════════════════════════════════════════ *
 *  Phase 20 V2 tests
 * ═════════════════════════════════════════════════════════ */

import {
  MODEL_MATURITY_V2,
  JOB_TICKET_V2,
  QUANT_DEFAULT_MAX_ACTIVE_MODELS_PER_OWNER,
  QUANT_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER,
  QUANT_DEFAULT_MODEL_IDLE_MS,
  QUANT_DEFAULT_JOB_STUCK_MS,
  getDefaultMaxActiveModelsPerOwnerV2,
  getMaxActiveModelsPerOwnerV2,
  setMaxActiveModelsPerOwnerV2,
  getDefaultMaxRunningJobsPerOwnerV2,
  getMaxRunningJobsPerOwnerV2,
  setMaxRunningJobsPerOwnerV2,
  getDefaultModelIdleMsV2,
  getModelIdleMsV2,
  setModelIdleMsV2,
  getDefaultJobStuckMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerModelV2,
  getModelV2,
  setModelMaturityV2,
  activateModel,
  deprecateModel,
  retireModel,
  touchModelUsage,
  enqueueJobTicketV2,
  getJobTicketV2,
  setJobTicketStatusV2,
  startJobTicket,
  completeJobTicket,
  failJobTicket,
  cancelJobTicket,
  getActiveModelCount,
  getRunningJobCount,
  autoRetireIdleModels,
  autoFailStuckJobTickets,
  getQuantizationStatsV2,
  _resetStateV2,
} from "../../src/lib/quantization.js";

describe("quantization V2", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("MODEL_MATURITY_V2 frozen with 4 states", () => {
      expect(Object.values(MODEL_MATURITY_V2)).toEqual([
        "onboarding",
        "active",
        "deprecated",
        "retired",
      ]);
      expect(Object.isFrozen(MODEL_MATURITY_V2)).toBe(true);
    });

    it("JOB_TICKET_V2 frozen with 5 states", () => {
      expect(Object.values(JOB_TICKET_V2)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "canceled",
      ]);
      expect(Object.isFrozen(JOB_TICKET_V2)).toBe(true);
    });
  });

  describe("config defaults + setters", () => {
    it("exposes frozen defaults", () => {
      expect(QUANT_DEFAULT_MAX_ACTIVE_MODELS_PER_OWNER).toBe(50);
      expect(QUANT_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER).toBe(3);
      expect(QUANT_DEFAULT_MODEL_IDLE_MS).toBe(120 * 86400000);
      expect(QUANT_DEFAULT_JOB_STUCK_MS).toBe(6 * 3600000);
      expect(getDefaultMaxActiveModelsPerOwnerV2()).toBe(50);
      expect(getDefaultMaxRunningJobsPerOwnerV2()).toBe(3);
      expect(getDefaultModelIdleMsV2()).toBe(120 * 86400000);
      expect(getDefaultJobStuckMsV2()).toBe(6 * 3600000);
    });

    it("mutates config values", () => {
      setMaxActiveModelsPerOwnerV2(5);
      setMaxRunningJobsPerOwnerV2(2);
      setModelIdleMsV2(1000);
      setJobStuckMsV2(500);
      expect(getMaxActiveModelsPerOwnerV2()).toBe(5);
      expect(getMaxRunningJobsPerOwnerV2()).toBe(2);
      expect(getModelIdleMsV2()).toBe(1000);
      expect(getJobStuckMsV2()).toBe(500);
    });

    it("rejects non-positive", () => {
      expect(() => setMaxActiveModelsPerOwnerV2(0)).toThrow();
      expect(() => setMaxRunningJobsPerOwnerV2(-1)).toThrow();
      expect(() => setModelIdleMsV2(NaN)).toThrow();
      expect(() => setJobStuckMsV2("x")).toThrow();
    });

    it("_resetStateV2 restores defaults + clears maps", () => {
      setMaxActiveModelsPerOwnerV2(10);
      registerModelV2(null, { modelId: "m", ownerId: "o" });
      enqueueJobTicketV2(null, {
        ticketId: "t",
        ownerId: "o",
        modelId: "m",
        quantType: "gguf",
      });
      _resetStateV2();
      expect(getMaxActiveModelsPerOwnerV2()).toBe(50);
      expect(getModelV2("m")).toBeNull();
      expect(getJobTicketV2("t")).toBeNull();
    });
  });

  describe("registerModelV2", () => {
    it("creates onboarding model", () => {
      const m = registerModelV2(null, {
        modelId: "m1",
        ownerId: "alice",
        family: "llama",
      });
      expect(m.status).toBe("onboarding");
      expect(m.ownerId).toBe("alice");
      expect(m.family).toBe("llama");
    });

    it("accepts active initial", () => {
      const m = registerModelV2(null, {
        modelId: "m",
        ownerId: "a",
        initialStatus: "active",
      });
      expect(m.status).toBe("active");
    });

    it("throws missing modelId/ownerId", () => {
      expect(() => registerModelV2(null, { ownerId: "a" })).toThrow();
      expect(() => registerModelV2(null, { modelId: "m" })).toThrow();
    });

    it("throws on duplicate", () => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
      expect(() =>
        registerModelV2(null, { modelId: "m", ownerId: "a" }),
      ).toThrow(/already exists/);
    });

    it("throws on invalid initial", () => {
      expect(() =>
        registerModelV2(null, {
          modelId: "m",
          ownerId: "a",
          initialStatus: "x",
        }),
      ).toThrow();
    });

    it("throws on terminal initial", () => {
      expect(() =>
        registerModelV2(null, {
          modelId: "m",
          ownerId: "a",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces per-owner active cap", () => {
      setMaxActiveModelsPerOwnerV2(2);
      registerModelV2(null, {
        modelId: "m1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerModelV2(null, {
        modelId: "m2",
        ownerId: "a",
        initialStatus: "active",
      });
      expect(() =>
        registerModelV2(null, {
          modelId: "m3",
          ownerId: "a",
          initialStatus: "active",
        }),
      ).toThrow(/cap/);
    });
  });

  describe("setModelMaturityV2 + shortcuts", () => {
    beforeEach(() => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
    });

    it("onboarding → active → deprecated → active → retired", () => {
      activateModel(null, "m", "ready");
      expect(getModelV2("m").status).toBe("active");
      deprecateModel(null, "m", "old");
      expect(getModelV2("m").status).toBe("deprecated");
      activateModel(null, "m", "re-enabled");
      expect(getModelV2("m").status).toBe("active");
      retireModel(null, "m");
      expect(getModelV2("m").status).toBe("retired");
    });

    it("rejects invalid transition (onboarding → deprecated)", () => {
      expect(() => deprecateModel(null, "m")).toThrow(/Invalid transition/);
    });

    it("retired is terminal", () => {
      activateModel(null, "m");
      retireModel(null, "m");
      expect(() => activateModel(null, "m")).toThrow();
    });

    it("enforces cap on transition to active", () => {
      setMaxActiveModelsPerOwnerV2(1);
      registerModelV2(null, {
        modelId: "m2",
        ownerId: "a",
        initialStatus: "active",
      });
      expect(() => activateModel(null, "m")).toThrow(/cap/);
    });

    it("patch-merges metadata + reason", () => {
      activateModel(null, "m");
      setModelMaturityV2(null, "m", "deprecated", {
        reason: "deprecating",
        metadata: { note: "legacy" },
      });
      const r = getModelV2("m");
      expect(r.lastReason).toBe("deprecating");
      expect(r.metadata.note).toBe("legacy");
    });

    it("throws unknown model", () => {
      expect(() => activateModel(null, "nope")).toThrow(/Unknown model/);
    });
  });

  describe("touchModelUsage", () => {
    it("bumps lastUsedAt", async () => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
      const before = getModelV2("m").lastUsedAt;
      await new Promise((r) => setTimeout(r, 5));
      const touched = touchModelUsage("m");
      expect(touched.lastUsedAt).toBeGreaterThan(before);
    });

    it("throws unknown", () => {
      expect(() => touchModelUsage("x")).toThrow();
    });
  });

  describe("enqueueJobTicketV2", () => {
    beforeEach(() => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
    });

    it("enqueues queued ticket", () => {
      const t = enqueueJobTicketV2(null, {
        ticketId: "t1",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
        level: "Q4_K_M",
      });
      expect(t.status).toBe("queued");
      expect(t.level).toBe("Q4_K_M");
    });

    it("throws missing required", () => {
      expect(() => enqueueJobTicketV2(null, { ownerId: "a" })).toThrow();
      expect(() =>
        enqueueJobTicketV2(null, { ticketId: "t", ownerId: "a", modelId: "m" }),
      ).toThrow(/quantType/);
    });

    it("throws on duplicate", () => {
      enqueueJobTicketV2(null, {
        ticketId: "t",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
      expect(() =>
        enqueueJobTicketV2(null, {
          ticketId: "t",
          ownerId: "a",
          modelId: "m",
          quantType: "gguf",
        }),
      ).toThrow(/already/);
    });
  });

  describe("setJobTicketStatusV2 + shortcuts", () => {
    beforeEach(() => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
      enqueueJobTicketV2(null, {
        ticketId: "t",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
    });

    it("queued → running → completed", () => {
      startJobTicket(null, "t");
      expect(getJobTicketV2("t").status).toBe("running");
      expect(getJobTicketV2("t").startedAt).toBeDefined();
      completeJobTicket(null, "t");
      expect(getJobTicketV2("t").status).toBe("completed");
    });

    it("queued → failed / canceled", () => {
      failJobTicket(null, "t", "oops");
      expect(getJobTicketV2("t").status).toBe("failed");
    });

    it("running → canceled", () => {
      startJobTicket(null, "t");
      cancelJobTicket(null, "t");
      expect(getJobTicketV2("t").status).toBe("canceled");
    });

    it("terminal states block further transitions", () => {
      startJobTicket(null, "t");
      completeJobTicket(null, "t");
      expect(() => failJobTicket(null, "t")).toThrow(/Invalid transition/);
      expect(() => cancelJobTicket(null, "t")).toThrow(/Invalid transition/);
    });

    it("enforces running-job cap", () => {
      setMaxRunningJobsPerOwnerV2(1);
      enqueueJobTicketV2(null, {
        ticketId: "t2",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
      startJobTicket(null, "t");
      expect(() => startJobTicket(null, "t2")).toThrow(/cap/);
    });

    it("startedAt stamp-once on RUNNING entry", async () => {
      startJobTicket(null, "t");
      const first = getJobTicketV2("t").startedAt;
      await new Promise((r) => setTimeout(r, 5));
      completeJobTicket(null, "t");
      expect(getJobTicketV2("t").startedAt).toBe(first);
    });

    it("patch-merges metadata/reason", () => {
      startJobTicket(null, "t");
      setJobTicketStatusV2(null, "t", "completed", {
        reason: "done",
        metadata: { bytes: 1024 },
      });
      const r = getJobTicketV2("t");
      expect(r.lastReason).toBe("done");
      expect(r.metadata.bytes).toBe(1024);
    });

    it("throws unknown ticket", () => {
      expect(() => startJobTicket(null, "nope")).toThrow(/Unknown ticket/);
    });
  });

  describe("counts", () => {
    it("getActiveModelCount scopes by owner", () => {
      registerModelV2(null, {
        modelId: "m1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerModelV2(null, {
        modelId: "m2",
        ownerId: "a",
        initialStatus: "active",
      });
      registerModelV2(null, {
        modelId: "m3",
        ownerId: "b",
        initialStatus: "active",
      });
      registerModelV2(null, { modelId: "m4", ownerId: "a" }); // onboarding
      expect(getActiveModelCount()).toBe(3);
      expect(getActiveModelCount("a")).toBe(2);
      expect(getActiveModelCount("b")).toBe(1);
    });

    it("getRunningJobCount scopes by owner", () => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
      enqueueJobTicketV2(null, {
        ticketId: "t1",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
      enqueueJobTicketV2(null, {
        ticketId: "t2",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
      enqueueJobTicketV2(null, {
        ticketId: "t3",
        ownerId: "b",
        modelId: "m",
        quantType: "gguf",
      });
      startJobTicket(null, "t1");
      startJobTicket(null, "t3");
      expect(getRunningJobCount()).toBe(2);
      expect(getRunningJobCount("a")).toBe(1);
      expect(getRunningJobCount("b")).toBe(1);
    });
  });

  describe("auto-flip bulk", () => {
    it("autoRetireIdleModels flips active + deprecated past idle window", () => {
      registerModelV2(null, {
        modelId: "m1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerModelV2(null, {
        modelId: "m2",
        ownerId: "a",
        initialStatus: "active",
      });
      setModelMaturityV2(null, "m2", "deprecated");
      registerModelV2(null, { modelId: "m3", ownerId: "a" }); // onboarding, skipped
      setModelIdleMsV2(100);
      const future = Date.now() + 1000;
      const r = autoRetireIdleModels(null, future);
      expect(r.count).toBe(2);
      expect(r.flipped.sort()).toEqual(["m1", "m2"]);
      expect(getModelV2("m3").status).toBe("onboarding");
    });

    it("autoFailStuckJobTickets flips only running", () => {
      registerModelV2(null, { modelId: "m", ownerId: "a" });
      enqueueJobTicketV2(null, {
        ticketId: "t1",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
      enqueueJobTicketV2(null, {
        ticketId: "t2",
        ownerId: "a",
        modelId: "m",
        quantType: "gguf",
      });
      startJobTicket(null, "t1");
      setJobStuckMsV2(100);
      const future = Date.now() + 1000;
      const r = autoFailStuckJobTickets(null, future);
      expect(r.count).toBe(1);
      expect(r.flipped).toEqual(["t1"]);
      expect(getJobTicketV2("t1").status).toBe("failed");
      expect(getJobTicketV2("t2").status).toBe("queued");
    });
  });

  describe("getQuantizationStatsV2", () => {
    it("returns zero-init enum keys for empty state", () => {
      const s = getQuantizationStatsV2();
      expect(s.totalModelsV2).toBe(0);
      expect(s.totalTicketsV2).toBe(0);
      expect(s.maxActiveModelsPerOwner).toBe(50);
      expect(s.maxRunningJobsPerOwner).toBe(3);
      expect(Object.keys(s.modelsByStatus).sort()).toEqual(
        ["active", "deprecated", "onboarding", "retired"].sort(),
      );
      expect(Object.keys(s.ticketsByStatus).sort()).toEqual(
        ["canceled", "completed", "failed", "queued", "running"].sort(),
      );
      for (const v of Object.values(s.modelsByStatus)) expect(v).toBe(0);
      for (const v of Object.values(s.ticketsByStatus)) expect(v).toBe(0);
    });

    it("counts models + tickets by status", () => {
      registerModelV2(null, {
        modelId: "m1",
        ownerId: "a",
        initialStatus: "active",
      });
      registerModelV2(null, { modelId: "m2", ownerId: "a" });
      enqueueJobTicketV2(null, {
        ticketId: "t1",
        ownerId: "a",
        modelId: "m1",
        quantType: "gguf",
      });
      startJobTicket(null, "t1");
      const s = getQuantizationStatsV2();
      expect(s.totalModelsV2).toBe(2);
      expect(s.modelsByStatus.active).toBe(1);
      expect(s.modelsByStatus.onboarding).toBe(1);
      expect(s.totalTicketsV2).toBe(1);
      expect(s.ticketsByStatus.running).toBe(1);
    });
  });
});
