import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/bi-engine.js";

describe("BiEngine V2 Surface", () => {
  beforeEach(() => M._resetStateBiEngineGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.BIGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.BIGOV_QUERY_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.BIGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.BIGOV_QUERY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveBigovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveBigovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingBigovQuerysPerProfileV2(33);
      expect(M.getMaxPendingBigovQuerysPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setBigovProfileIdleMsV2(60000);
      expect(M.getBigovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setBigovQueryStuckMsV2(45000);
      expect(M.getBigovQueryStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveBigovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setBigovQueryStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveBigovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveBigovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerBigovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default dataset", () =>
      expect(M.registerBigovProfileV2({ id: "p1", owner: "a" }).dataset).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateBigovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
      expect(M.staleBigovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateBigovProfileV2("p1");
      M.staleBigovProfileV2("p1");
      expect(M.activateBigovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
      expect(M.archiveBigovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
      M.archiveBigovProfileV2("p1");
      expect(() => M.touchBigovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleBigovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerBigovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerBigovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getBigovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.registerBigovProfileV2({ id: "p2", owner: "b" });
      expect(M.listBigovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getBigovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getBigovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveBigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerBigovProfileV2({ id, owner: "a" }),
      );
      M.activateBigovProfileV2("p1");
      M.activateBigovProfileV2("p2");
      expect(() => M.activateBigovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveBigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerBigovProfileV2({ id, owner: "a" }),
      );
      M.activateBigovProfileV2("p1");
      M.activateBigovProfileV2("p2");
      M.staleBigovProfileV2("p1");
      M.activateBigovProfileV2("p3");
      expect(() => M.activateBigovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveBigovProfilesPerOwnerV2(1);
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.registerBigovProfileV2({ id: "p2", owner: "b" });
      M.activateBigovProfileV2("p1");
      expect(() => M.activateBigovProfileV2("p2")).not.toThrow();
    });
  });

  describe("query lifecycle", () => {
    beforeEach(() => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
    });
    it("create→querying→complete", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      M.queryingBigovQueryV2("r1");
      const r = M.completeQueryBigovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      M.queryingBigovQueryV2("r1");
      expect(M.failBigovQueryV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      expect(M.cancelBigovQueryV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeQueryBigovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createBigovQueryV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingBigovQuerysPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createBigovQueryV2({ id, profileId: "p1" }),
      );
      expect(() => M.createBigovQueryV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("querying counts as pending", () => {
      M.setMaxPendingBigovQuerysPerProfileV2(1);
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      M.queryingBigovQueryV2("r1");
      expect(() =>
        M.createBigovQueryV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingBigovQuerysPerProfileV2(1);
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      M.queryingBigovQueryV2("r1");
      M.completeQueryBigovV2("r1");
      expect(() =>
        M.createBigovQueryV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getBigovQueryV2("nope")).toBeNull());
    it("list", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      M.createBigovQueryV2({ id: "r2", profileId: "p1" });
      expect(M.listBigovQuerysV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createBigovQueryV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createBigovQueryV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      expect(M.cancelBigovQueryV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setBigovProfileIdleMsV2(1000);
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
      const r = M.autoStaleIdleBigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getBigovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      M.queryingBigovQueryV2("r1");
      M.setBigovQueryStuckMsV2(100);
      const r = M.autoFailStuckBigovQuerysV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setBigovProfileIdleMsV2(1000);
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleBigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getBiEngineGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.querysByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerBigovProfileV2({ id: "p1", owner: "a" });
      M.activateBigovProfileV2("p1");
      M.createBigovQueryV2({ id: "r1", profileId: "p1" });
      const s2 = M.getBiEngineGovStatsV2();
      expect(s2.totalBigovProfilesV2).toBe(1);
      expect(s2.totalBigovQuerysV2).toBe(1);
    });
  });
});
