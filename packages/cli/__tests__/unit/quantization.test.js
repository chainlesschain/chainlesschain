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
