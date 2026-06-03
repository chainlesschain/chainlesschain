import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/plan-mode.js";

describe("Pmodegov V2 Surface", () => {
  beforeEach(() => M._resetStatePmodegovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PMODEGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PMODEGOV_PLAN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PMODEGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PMODEGOV_PLAN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePmodeProfilesPerOwnerV2(11);
      expect(M.getMaxActivePmodeProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPmodePlansPerProfileV2(33);
      expect(M.getMaxPendingPmodePlansPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPmodeProfileIdleMsV2(60000);
      expect(M.getPmodeProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPmodePlanStuckMsV2(45000);
      expect(M.getPmodePlanStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePmodeProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPmodePlanStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePmodeProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePmodeProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPmodeProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default template", () =>
      expect(M.registerPmodeProfileV2({ id: "p1", owner: "a" }).template).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePmodeProfileV2("p1").status).toBe("active");
    });
    it("paused", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
      expect(M.pausedPmodeProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePmodeProfileV2("p1");
      M.pausedPmodeProfileV2("p1");
      expect(M.activatePmodeProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
      expect(M.archivePmodeProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
      M.archivePmodeProfileV2("p1");
      expect(() => M.touchPmodeProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausedPmodeProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPmodeProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPmodeProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPmodeProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.registerPmodeProfileV2({ id: "p2", owner: "b" });
      expect(M.listPmodeProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPmodeProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPmodeProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePmodeProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPmodeProfileV2({ id, owner: "a" }),
      );
      M.activatePmodeProfileV2("p1");
      M.activatePmodeProfileV2("p2");
      expect(() => M.activatePmodeProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePmodeProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPmodeProfileV2({ id, owner: "a" }),
      );
      M.activatePmodeProfileV2("p1");
      M.activatePmodeProfileV2("p2");
      M.pausedPmodeProfileV2("p1");
      M.activatePmodeProfileV2("p3");
      expect(() => M.activatePmodeProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePmodeProfilesPerOwnerV2(1);
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.registerPmodeProfileV2({ id: "p2", owner: "b" });
      M.activatePmodeProfileV2("p1");
      expect(() => M.activatePmodeProfileV2("p2")).not.toThrow();
    });
  });

  describe("plan lifecycle", () => {
    beforeEach(() => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
    });
    it("create→planning→complete", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      M.planningPmodePlanV2("r1");
      const r = M.completePlanPmodeV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      M.planningPmodePlanV2("r1");
      expect(M.failPmodePlanV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPmodePlanV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePlanPmodeV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPmodePlanV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPmodePlansPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPmodePlanV2({ id, profileId: "p1" }),
      );
      expect(() => M.createPmodePlanV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("planning counts as pending", () => {
      M.setMaxPendingPmodePlansPerProfileV2(1);
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      M.planningPmodePlanV2("r1");
      expect(() =>
        M.createPmodePlanV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPmodePlansPerProfileV2(1);
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      M.planningPmodePlanV2("r1");
      M.completePlanPmodeV2("r1");
      expect(() =>
        M.createPmodePlanV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPmodePlanV2("nope")).toBeNull());
    it("list", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      M.createPmodePlanV2({ id: "r2", profileId: "p1" });
      expect(M.listPmodePlansV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPmodePlanV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPmodePlanV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPmodePlanV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPausedIdle", () => {
      M.setPmodeProfileIdleMsV2(1000);
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
      const r = M.autoPausedIdlePmodeProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPmodeProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      M.planningPmodePlanV2("r1");
      M.setPmodePlanStuckMsV2(100);
      const r = M.autoFailStuckPmodePlansV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPmodeProfileIdleMsV2(1000);
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPausedIdlePmodeProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPmodegovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.plansByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPmodeProfileV2({ id: "p1", owner: "a" });
      M.activatePmodeProfileV2("p1");
      M.createPmodePlanV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPmodegovStatsV2();
      expect(s2.totalPmodeProfilesV2).toBe(1);
      expect(s2.totalPmodePlansV2).toBe(1);
    });
  });
});
