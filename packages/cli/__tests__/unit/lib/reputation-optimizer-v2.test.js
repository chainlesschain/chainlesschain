import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/reputation-optimizer.js";

describe("ReputationOptimizer V2 Surface", () => {
  beforeEach(() => M._resetStateReputationOptimizerV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.REPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.REPGOV_CYCLE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.REPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.REPGOV_CYCLE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveRepgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveRepgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingRepgovCyclesPerProfileV2(33);
      expect(M.getMaxPendingRepgovCyclesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setRepgovProfileIdleMsV2(60000);
      expect(M.getRepgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setRepgovCycleStuckMsV2(45000);
      expect(M.getRepgovCycleStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveRepgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setRepgovCycleStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveRepgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveRepgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerRepgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default objective", () =>
      expect(
        M.registerRepgovProfileV2({ id: "p1", owner: "a" }).objective,
      ).toBe("quality"));
    it("activate", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateRepgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
      expect(M.staleRepgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateRepgovProfileV2("p1");
      M.staleRepgovProfileV2("p1");
      expect(M.activateRepgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
      expect(M.archiveRepgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
      M.archiveRepgovProfileV2("p1");
      expect(() => M.touchRepgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleRepgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerRepgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerRepgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getRepgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.registerRepgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listRepgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getRepgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getRepgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveRepgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRepgovProfileV2({ id, owner: "a" }),
      );
      M.activateRepgovProfileV2("p1");
      M.activateRepgovProfileV2("p2");
      expect(() => M.activateRepgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveRepgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRepgovProfileV2({ id, owner: "a" }),
      );
      M.activateRepgovProfileV2("p1");
      M.activateRepgovProfileV2("p2");
      M.staleRepgovProfileV2("p1");
      M.activateRepgovProfileV2("p3");
      expect(() => M.activateRepgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveRepgovProfilesPerOwnerV2(1);
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.registerRepgovProfileV2({ id: "p2", owner: "b" });
      M.activateRepgovProfileV2("p1");
      expect(() => M.activateRepgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("cycle lifecycle", () => {
    beforeEach(() => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      M.runningRepgovCycleV2("r1");
      const r = M.completeCycleRepgovV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("running");
    });
    it("fail", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      M.runningRepgovCycleV2("r1");
      expect(M.failRepgovCycleV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRepgovCycleV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCycleRepgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createRepgovCycleV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingRepgovCyclesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createRepgovCycleV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createRepgovCycleV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("running counts as pending", () => {
      M.setMaxPendingRepgovCyclesPerProfileV2(1);
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      M.runningRepgovCycleV2("r1");
      expect(() =>
        M.createRepgovCycleV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingRepgovCyclesPerProfileV2(1);
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      M.runningRepgovCycleV2("r1");
      M.completeCycleRepgovV2("r1");
      expect(() =>
        M.createRepgovCycleV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getRepgovCycleV2("nope")).toBeNull());
    it("list", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      M.createRepgovCycleV2({ id: "r2", profileId: "p1" });
      expect(M.listRepgovCyclesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createRepgovCycleV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createRepgovCycleV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRepgovCycleV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setRepgovProfileIdleMsV2(1000);
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
      const r = M.autoStaleIdleRepgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getRepgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      M.runningRepgovCycleV2("r1");
      M.setRepgovCycleStuckMsV2(100);
      const r = M.autoFailStuckRepgovCyclesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setRepgovProfileIdleMsV2(1000);
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleRepgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getReputationOptimizerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.cyclesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerRepgovProfileV2({ id: "p1", owner: "a" });
      M.activateRepgovProfileV2("p1");
      M.createRepgovCycleV2({ id: "r1", profileId: "p1" });
      const s2 = M.getReputationOptimizerGovStatsV2();
      expect(s2.totalRepgovProfilesV2).toBe(1);
      expect(s2.totalRepgovCyclesV2).toBe(1);
    });
  });
});
