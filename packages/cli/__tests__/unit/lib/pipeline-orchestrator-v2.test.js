import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/pipeline-orchestrator.js";

describe("Pipeline Orchestrator V2 Surface", () => {
  beforeEach(() => M._resetStatePipelineOrchestratorV2());

  describe("enums", () => {
    it("pipeline maturity has 4 states", () =>
      expect(Object.keys(M.PIPELINE_MATURITY_V2)).toHaveLength(4));
    it("run lifecycle has 5 states", () =>
      expect(Object.keys(M.PIPELINE_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.PIPELINE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PIPELINE_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActivePipelinesPerOwnerV2", () => {
      M.setMaxActivePipelinesPerOwnerV2(25);
      expect(M.getMaxActivePipelinesPerOwnerV2()).toBe(25);
    });
    it("setMaxPendingPipelineRunsPerPipelineV2", () => {
      M.setMaxPendingPipelineRunsPerPipelineV2(40);
      expect(M.getMaxPendingPipelineRunsPerPipelineV2()).toBe(40);
    });
    it("setPipelineIdleMsV2", () => {
      M.setPipelineIdleMsV2(3600000);
      expect(M.getPipelineIdleMsV2()).toBe(3600000);
    });
    it("setPipelineRunStuckMsV2", () => {
      M.setPipelineRunStuckMsV2(60000);
      expect(M.getPipelineRunStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActivePipelinesPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setPipelineRunStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingPipelineRunsPerPipelineV2(7.9);
      expect(M.getMaxPendingPipelineRunsPerPipelineV2()).toBe(7);
    });
  });

  describe("pipeline lifecycle", () => {
    it("register", () => {
      const p = M.registerPipelineV2({ id: "p1", owner: "alice" });
      expect(p.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      const p = M.activatePipelineV2("p1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBeTruthy();
    });
    it("pause active→paused", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      M.activatePipelineV2("p1");
      expect(M.pausePipelineV2("p1").status).toBe("paused");
    });
    it("recovery paused→active preserves activatedAt", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      const p = M.activatePipelineV2("p1");
      M.pausePipelineV2("p1");
      const re = M.activatePipelineV2("p1");
      expect(re.activatedAt).toBe(p.activatedAt);
    });
    it("archive terminal stamps archivedAt", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      M.activatePipelineV2("p1");
      const p = M.archivePipelineV2("p1");
      expect(p.status).toBe("archived");
      expect(p.archivedAt).toBeTruthy();
    });
    it("cannot touch archived", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      M.activatePipelineV2("p1");
      M.archivePipelineV2("p1");
      expect(() => M.touchPipelineV2("p1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      expect(() => M.pausePipelineV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPipelineV2({ id: "p1", owner: "alice" });
      expect(() => M.registerPipelineV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerPipelineV2({ id: "p1" })).toThrow());
    it("list all", () => {
      M.registerPipelineV2({ id: "p1", owner: "a" });
      M.registerPipelineV2({ id: "p2", owner: "b" });
      expect(M.listPipelinesV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getPipelineV2("none")).toBeNull());
    it("defensive copy metadata", () => {
      M.registerPipelineV2({ id: "p1", owner: "a", metadata: { k: 5 } });
      const p = M.getPipelineV2("p1");
      p.metadata.k = 99;
      expect(M.getPipelineV2("p1").metadata.k).toBe(5);
    });
    it("default name == id", () => {
      M.registerPipelineV2({ id: "p1", owner: "a" });
      expect(M.getPipelineV2("p1").name).toBe("p1");
    });
    it("name preserved", () => {
      M.registerPipelineV2({ id: "p1", owner: "a", name: "My Pipeline" });
      expect(M.getPipelineV2("p1").name).toBe("My Pipeline");
    });
  });

  describe("active-pipeline cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActivePipelinesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPipelineV2({ id, owner: "o" }),
      );
      M.activatePipelineV2("p1");
      M.activatePipelineV2("p2");
      expect(() => M.activatePipelineV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePipelinesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPipelineV2({ id, owner: "o" }),
      );
      M.activatePipelineV2("p1");
      M.activatePipelineV2("p2");
      M.pausePipelineV2("p1");
      M.activatePipelineV2("p3");
      expect(() => M.activatePipelineV2("p1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActivePipelinesPerOwnerV2(1);
      M.registerPipelineV2({ id: "p1", owner: "o1" });
      M.registerPipelineV2({ id: "p2", owner: "o2" });
      M.activatePipelineV2("p1");
      expect(() => M.activatePipelineV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerPipelineV2({ id: "p1", owner: "o" });
      M.activatePipelineV2("p1");
    });
    it("create→start→complete", () => {
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      M.startPipelineRunV2("r1");
      const r = M.completePipelineRunV2("r1");
      expect(r.status).toBe("completed");
    });
    it("fail stores reason", () => {
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      M.startPipelineRunV2("r1");
      const r = M.failPipelineRunV2("r1", "err");
      expect(r.metadata.failReason).toBe("err");
    });
    it("cancel queued", () => {
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      expect(M.cancelPipelineRunV2("r1").status).toBe("cancelled");
    });
    it("cannot complete from queued", () => {
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      expect(() => M.completePipelineRunV2("r1")).toThrow();
    });
    it("unknown pipeline rejected", () =>
      expect(() =>
        M.createPipelineRunV2({ id: "r1", pipelineId: "none" }),
      ).toThrow());
    it("per-pipeline pending cap", () => {
      M.setMaxPendingPipelineRunsPerPipelineV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPipelineRunV2({ id, pipelineId: "p1" }),
      );
      expect(() =>
        M.createPipelineRunV2({ id: "r3", pipelineId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("running counts as pending", () => {
      M.setMaxPendingPipelineRunsPerPipelineV2(1);
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      M.startPipelineRunV2("r1");
      expect(() =>
        M.createPipelineRunV2({ id: "r2", pipelineId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPipelineRunsPerPipelineV2(1);
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      M.startPipelineRunV2("r1");
      M.completePipelineRunV2("r1");
      expect(() =>
        M.createPipelineRunV2({ id: "r2", pipelineId: "p1" }),
      ).not.toThrow();
    });
    it("default trigger manual", () => {
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      expect(M.getPipelineRunV2("r1").trigger).toBe("manual");
    });
    it("trigger preserved", () => {
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1", trigger: "cron" });
      expect(M.getPipelineRunV2("r1").trigger).toBe("cron");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setPipelineIdleMsV2(1000);
      M.registerPipelineV2({ id: "p1", owner: "o" });
      M.activatePipelineV2("p1");
      const r = M.autoPauseIdlePipelinesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPipelineV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerPipelineV2({ id: "p1", owner: "o" });
      M.activatePipelineV2("p1");
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      M.startPipelineRunV2("r1");
      M.setPipelineRunStuckMsV2(100);
      const r = M.autoFailStuckPipelineRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPipelineRunV2("r1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getPipelineOrchestratorGovStatsV2();
      expect(s.pipelinesByStatus.pending).toBe(0);
      expect(s.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPipelineV2({ id: "p1", owner: "o" });
      M.activatePipelineV2("p1");
      M.createPipelineRunV2({ id: "r1", pipelineId: "p1" });
      const s = M.getPipelineOrchestratorGovStatsV2();
      expect(s.totalPipelinesV2).toBe(1);
      expect(s.totalRunsV2).toBe(1);
    });
  });
});
