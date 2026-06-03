import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evolution-system.js";

describe("Esysgov V2 Surface", () => {
  beforeEach(() => M._resetStateEsysgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.ESYSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.ESYSGOV_CYCLE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.ESYSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ESYSGOV_CYCLE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEsysProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEsysProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEsysCyclesPerProfileV2(33);
      expect(M.getMaxPendingEsysCyclesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEsysProfileIdleMsV2(60000);
      expect(M.getEsysProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEsysCycleStuckMsV2(45000);
      expect(M.getEsysCycleStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEsysProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setEsysCycleStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEsysProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEsysProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEsysProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default lane", () =>
      expect(M.registerEsysProfileV2({ id: "p1", owner: "a" }).lane).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEsysProfileV2("p1").status).toBe("active");
    });
    it("paused", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
      expect(M.pausedEsysProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEsysProfileV2("p1");
      M.pausedEsysProfileV2("p1");
      expect(M.activateEsysProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
      expect(M.archiveEsysProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
      M.archiveEsysProfileV2("p1");
      expect(() => M.touchEsysProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausedEsysProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerEsysProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEsysProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEsysProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.registerEsysProfileV2({ id: "p2", owner: "b" });
      expect(M.listEsysProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEsysProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEsysProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEsysProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEsysProfileV2({ id, owner: "a" }),
      );
      M.activateEsysProfileV2("p1");
      M.activateEsysProfileV2("p2");
      expect(() => M.activateEsysProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEsysProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEsysProfileV2({ id, owner: "a" }),
      );
      M.activateEsysProfileV2("p1");
      M.activateEsysProfileV2("p2");
      M.pausedEsysProfileV2("p1");
      M.activateEsysProfileV2("p3");
      expect(() => M.activateEsysProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEsysProfilesPerOwnerV2(1);
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.registerEsysProfileV2({ id: "p2", owner: "b" });
      M.activateEsysProfileV2("p1");
      expect(() => M.activateEsysProfileV2("p2")).not.toThrow();
    });
  });

  describe("cycle lifecycle", () => {
    beforeEach(() => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
    });
    it("create→evolving→complete", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      M.evolvingEsysCycleV2("r1");
      const r = M.completeCycleEsysV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      M.evolvingEsysCycleV2("r1");
      expect(M.failEsysCycleV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEsysCycleV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCycleEsysV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEsysCycleV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEsysCyclesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createEsysCycleV2({ id, profileId: "p1" }),
      );
      expect(() => M.createEsysCycleV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("evolving counts as pending", () => {
      M.setMaxPendingEsysCyclesPerProfileV2(1);
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      M.evolvingEsysCycleV2("r1");
      expect(() =>
        M.createEsysCycleV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEsysCyclesPerProfileV2(1);
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      M.evolvingEsysCycleV2("r1");
      M.completeCycleEsysV2("r1");
      expect(() =>
        M.createEsysCycleV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEsysCycleV2("nope")).toBeNull());
    it("list", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      M.createEsysCycleV2({ id: "r2", profileId: "p1" });
      expect(M.listEsysCyclesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEsysCycleV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createEsysCycleV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEsysCycleV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPausedIdle", () => {
      M.setEsysProfileIdleMsV2(1000);
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
      const r = M.autoPausedIdleEsysProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEsysProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      M.evolvingEsysCycleV2("r1");
      M.setEsysCycleStuckMsV2(100);
      const r = M.autoFailStuckEsysCyclesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEsysProfileIdleMsV2(1000);
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPausedIdleEsysProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getEsysgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.cyclesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEsysProfileV2({ id: "p1", owner: "a" });
      M.activateEsysProfileV2("p1");
      M.createEsysCycleV2({ id: "r1", profileId: "p1" });
      const s2 = M.getEsysgovStatsV2();
      expect(s2.totalEsysProfilesV2).toBe(1);
      expect(s2.totalEsysCyclesV2).toBe(1);
    });
  });
});
