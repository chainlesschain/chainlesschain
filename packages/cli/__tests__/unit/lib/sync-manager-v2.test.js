import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sync-manager.js";

describe("SyncManager V2 Surface", () => {
  beforeEach(() => M._resetStateSyncManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SYNCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SYNCGOV_BATCH_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SYNCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SYNCGOV_BATCH_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSyncgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSyncgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSyncgovBatchsPerProfileV2(33);
      expect(M.getMaxPendingSyncgovBatchsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSyncgovProfileIdleMsV2(60000);
      expect(M.getSyncgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSyncgovBatchStuckMsV2(45000);
      expect(M.getSyncgovBatchStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSyncgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSyncgovBatchStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSyncgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSyncgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSyncgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default target", () =>
      expect(M.registerSyncgovProfileV2({ id: "p1", owner: "a" }).target).toBe(
        "primary",
      ));
    it("activate", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSyncgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
      expect(M.staleSyncgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSyncgovProfileV2("p1");
      M.staleSyncgovProfileV2("p1");
      expect(M.activateSyncgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
      expect(M.archiveSyncgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
      M.archiveSyncgovProfileV2("p1");
      expect(() => M.touchSyncgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleSyncgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSyncgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSyncgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSyncgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.registerSyncgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSyncgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSyncgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSyncgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSyncgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSyncgovProfileV2({ id, owner: "a" }),
      );
      M.activateSyncgovProfileV2("p1");
      M.activateSyncgovProfileV2("p2");
      expect(() => M.activateSyncgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSyncgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSyncgovProfileV2({ id, owner: "a" }),
      );
      M.activateSyncgovProfileV2("p1");
      M.activateSyncgovProfileV2("p2");
      M.staleSyncgovProfileV2("p1");
      M.activateSyncgovProfileV2("p3");
      expect(() => M.activateSyncgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSyncgovProfilesPerOwnerV2(1);
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.registerSyncgovProfileV2({ id: "p2", owner: "b" });
      M.activateSyncgovProfileV2("p1");
      expect(() => M.activateSyncgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("batch lifecycle", () => {
    beforeEach(() => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
    });
    it("create→replicating→complete", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      M.replicatingSyncgovBatchV2("r1");
      const r = M.completeBatchSyncgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      M.replicatingSyncgovBatchV2("r1");
      expect(M.failSyncgovBatchV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSyncgovBatchV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeBatchSyncgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSyncgovBatchV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSyncgovBatchsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSyncgovBatchV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSyncgovBatchV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("replicating counts as pending", () => {
      M.setMaxPendingSyncgovBatchsPerProfileV2(1);
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      M.replicatingSyncgovBatchV2("r1");
      expect(() =>
        M.createSyncgovBatchV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSyncgovBatchsPerProfileV2(1);
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      M.replicatingSyncgovBatchV2("r1");
      M.completeBatchSyncgovV2("r1");
      expect(() =>
        M.createSyncgovBatchV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSyncgovBatchV2("nope")).toBeNull());
    it("list", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      M.createSyncgovBatchV2({ id: "r2", profileId: "p1" });
      expect(M.listSyncgovBatchsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSyncgovBatchV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSyncgovBatchV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSyncgovBatchV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setSyncgovProfileIdleMsV2(1000);
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
      const r = M.autoStaleIdleSyncgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSyncgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      M.replicatingSyncgovBatchV2("r1");
      M.setSyncgovBatchStuckMsV2(100);
      const r = M.autoFailStuckSyncgovBatchsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSyncgovProfileIdleMsV2(1000);
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleSyncgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSyncManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.batchsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSyncgovProfileV2({ id: "p1", owner: "a" });
      M.activateSyncgovProfileV2("p1");
      M.createSyncgovBatchV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSyncManagerGovStatsV2();
      expect(s2.totalSyncgovProfilesV2).toBe(1);
      expect(s2.totalSyncgovBatchsV2).toBe(1);
    });
  });
});
