import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/bi-engine.js";

describe("BI Engine V2 Surface", () => {
  beforeEach(() => M._resetStateBiEngineV2());

  describe("enums", () => {
    it("dataset maturity has 4 states", () =>
      expect(Object.keys(M.BI_DATASET_MATURITY_V2)).toHaveLength(4));
    it("query lifecycle has 5 states", () =>
      expect(Object.keys(M.BI_QUERY_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.BI_DATASET_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.BI_QUERY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveBiDatasetsPerOwnerV2", () => {
      M.setMaxActiveBiDatasetsPerOwnerV2(20);
      expect(M.getMaxActiveBiDatasetsPerOwnerV2()).toBe(20);
    });
    it("setMaxPendingBiQueriesPerDatasetV2", () => {
      M.setMaxPendingBiQueriesPerDatasetV2(50);
      expect(M.getMaxPendingBiQueriesPerDatasetV2()).toBe(50);
    });
    it("setBiDatasetIdleMsV2", () => {
      M.setBiDatasetIdleMsV2(1800000);
      expect(M.getBiDatasetIdleMsV2()).toBe(1800000);
    });
    it("setBiQueryStuckMsV2", () => {
      M.setBiQueryStuckMsV2(30000);
      expect(M.getBiQueryStuckMsV2()).toBe(30000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveBiDatasetsPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setBiQueryStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingBiQueriesPerDatasetV2(6.9);
      expect(M.getMaxPendingBiQueriesPerDatasetV2()).toBe(6);
    });
  });

  describe("dataset lifecycle", () => {
    it("register", () => {
      const d = M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      expect(d.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      const d = M.activateBiDatasetV2("d1");
      expect(d.status).toBe("active");
      expect(d.activatedAt).toBeTruthy();
    });
    it("stale active→stale", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      M.activateBiDatasetV2("d1");
      expect(M.staleBiDatasetV2("d1").status).toBe("stale");
    });
    it("recovery stale→active preserves activatedAt", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      const d = M.activateBiDatasetV2("d1");
      M.staleBiDatasetV2("d1");
      const re = M.activateBiDatasetV2("d1");
      expect(re.activatedAt).toBe(d.activatedAt);
    });
    it("archive terminal stamps archivedAt", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      M.activateBiDatasetV2("d1");
      const d = M.archiveBiDatasetV2("d1");
      expect(d.status).toBe("archived");
      expect(d.archivedAt).toBeTruthy();
    });
    it("cannot touch archived", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      M.activateBiDatasetV2("d1");
      M.archiveBiDatasetV2("d1");
      expect(() => M.touchBiDatasetV2("d1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      expect(() => M.staleBiDatasetV2("d1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "alice" });
      expect(() => M.registerBiDatasetV2({ id: "d1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerBiDatasetV2({ id: "d1" })).toThrow());
    it("list all", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "a" });
      M.registerBiDatasetV2({ id: "d2", owner: "b" });
      expect(M.listBiDatasetsV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getBiDatasetV2("none")).toBeNull());
    it("defensive copy", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "a", metadata: { k: 5 } });
      const d = M.getBiDatasetV2("d1");
      d.metadata.k = 99;
      expect(M.getBiDatasetV2("d1").metadata.k).toBe(5);
    });
  });

  describe("active-dataset cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveBiDatasetsPerOwnerV2(2);
      ["d1", "d2", "d3"].forEach((id) =>
        M.registerBiDatasetV2({ id, owner: "o" }),
      );
      M.activateBiDatasetV2("d1");
      M.activateBiDatasetV2("d2");
      expect(() => M.activateBiDatasetV2("d3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveBiDatasetsPerOwnerV2(2);
      ["d1", "d2", "d3"].forEach((id) =>
        M.registerBiDatasetV2({ id, owner: "o" }),
      );
      M.activateBiDatasetV2("d1");
      M.activateBiDatasetV2("d2");
      M.staleBiDatasetV2("d1");
      M.activateBiDatasetV2("d3");
      expect(() => M.activateBiDatasetV2("d1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveBiDatasetsPerOwnerV2(1);
      M.registerBiDatasetV2({ id: "d1", owner: "o1" });
      M.registerBiDatasetV2({ id: "d2", owner: "o2" });
      M.activateBiDatasetV2("d1");
      expect(() => M.activateBiDatasetV2("d2")).not.toThrow();
    });
  });

  describe("query lifecycle", () => {
    beforeEach(() => {
      M.registerBiDatasetV2({ id: "d1", owner: "o" });
      M.activateBiDatasetV2("d1");
    });
    it("create→start→complete", () => {
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      M.startBiQueryV2("q1");
      const q = M.completeBiQueryV2("q1");
      expect(q.status).toBe("completed");
    });
    it("fail stores reason", () => {
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      M.startBiQueryV2("q1");
      const q = M.failBiQueryV2("q1", "oom");
      expect(q.metadata.failReason).toBe("oom");
    });
    it("cancel queued", () => {
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      expect(M.cancelBiQueryV2("q1").status).toBe("cancelled");
    });
    it("cannot complete from queued", () => {
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      expect(() => M.completeBiQueryV2("q1")).toThrow();
    });
    it("unknown dataset rejected", () =>
      expect(() =>
        M.createBiQueryV2({ id: "q1", datasetId: "none" }),
      ).toThrow());
    it("per-dataset pending cap", () => {
      M.setMaxPendingBiQueriesPerDatasetV2(2);
      ["q1", "q2"].forEach((id) => M.createBiQueryV2({ id, datasetId: "d1" }));
      expect(() => M.createBiQueryV2({ id: "q3", datasetId: "d1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingBiQueriesPerDatasetV2(1);
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      M.startBiQueryV2("q1");
      expect(() => M.createBiQueryV2({ id: "q2", datasetId: "d1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingBiQueriesPerDatasetV2(1);
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      M.startBiQueryV2("q1");
      M.completeBiQueryV2("q1");
      expect(() =>
        M.createBiQueryV2({ id: "q2", datasetId: "d1" }),
      ).not.toThrow();
    });
    it("default sql empty", () => {
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      expect(M.getBiQueryV2("q1").sql).toBe("");
    });
    it("sql preserved", () => {
      M.createBiQueryV2({ id: "q1", datasetId: "d1", sql: "SELECT 1" });
      expect(M.getBiQueryV2("q1").sql).toBe("SELECT 1");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setBiDatasetIdleMsV2(1000);
      M.registerBiDatasetV2({ id: "d1", owner: "o" });
      M.activateBiDatasetV2("d1");
      const r = M.autoStaleIdleBiDatasetsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getBiDatasetV2("d1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "o" });
      M.activateBiDatasetV2("d1");
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      M.startBiQueryV2("q1");
      M.setBiQueryStuckMsV2(100);
      const r = M.autoFailStuckBiQueriesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getBiQueryV2("q1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getBiEngineStatsV2();
      expect(s.datasetsByStatus.pending).toBe(0);
      expect(s.queriesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerBiDatasetV2({ id: "d1", owner: "o" });
      M.activateBiDatasetV2("d1");
      M.createBiQueryV2({ id: "q1", datasetId: "d1" });
      const s = M.getBiEngineStatsV2();
      expect(s.totalDatasetsV2).toBe(1);
      expect(s.totalQueriesV2).toBe(1);
    });
  });
});
