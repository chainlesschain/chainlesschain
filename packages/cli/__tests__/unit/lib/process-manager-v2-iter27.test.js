import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/process-manager.js";

describe("ProcessManagerGov V2 Surface", () => {
  beforeEach(() => M._resetStateProcessManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PMGRGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PMGRGOV_PROC_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PMGRGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PMGRGOV_PROC_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePmgrgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePmgrgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPmgrgovProcsPerProfileV2(33);
      expect(M.getMaxPendingPmgrgovProcsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPmgrgovProfileIdleMsV2(60000);
      expect(M.getPmgrgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPmgrgovProcStuckMsV2(45000);
      expect(M.getPmgrgovProcStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePmgrgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPmgrgovProcStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePmgrgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePmgrgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPmgrgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default kind", () =>
      expect(M.registerPmgrgovProfileV2({ id: "p1", owner: "a" }).kind).toBe(
        "service",
      ));
    it("activate", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePmgrgovProfileV2("p1").status).toBe("active");
    });
    it("stop", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
      expect(M.stopPmgrgovProfileV2("p1").status).toBe("stopped");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePmgrgovProfileV2("p1");
      M.stopPmgrgovProfileV2("p1");
      expect(M.activatePmgrgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
      expect(M.archivePmgrgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
      M.archivePmgrgovProfileV2("p1");
      expect(() => M.touchPmgrgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stopPmgrgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPmgrgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPmgrgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPmgrgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.registerPmgrgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPmgrgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPmgrgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPmgrgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePmgrgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPmgrgovProfileV2({ id, owner: "a" }),
      );
      M.activatePmgrgovProfileV2("p1");
      M.activatePmgrgovProfileV2("p2");
      expect(() => M.activatePmgrgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePmgrgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPmgrgovProfileV2({ id, owner: "a" }),
      );
      M.activatePmgrgovProfileV2("p1");
      M.activatePmgrgovProfileV2("p2");
      M.stopPmgrgovProfileV2("p1");
      M.activatePmgrgovProfileV2("p3");
      expect(() => M.activatePmgrgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePmgrgovProfilesPerOwnerV2(1);
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.registerPmgrgovProfileV2({ id: "p2", owner: "b" });
      M.activatePmgrgovProfileV2("p1");
      expect(() => M.activatePmgrgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("proc lifecycle", () => {
    beforeEach(() => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
    });
    it("create→starting→complete", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      M.startingPmgrgovProcV2("r1");
      const r = M.completeProcPmgrgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      M.startingPmgrgovProcV2("r1");
      expect(M.failPmgrgovProcV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPmgrgovProcV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeProcPmgrgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPmgrgovProcV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPmgrgovProcsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPmgrgovProcV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createPmgrgovProcV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("starting counts as pending", () => {
      M.setMaxPendingPmgrgovProcsPerProfileV2(1);
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      M.startingPmgrgovProcV2("r1");
      expect(() =>
        M.createPmgrgovProcV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPmgrgovProcsPerProfileV2(1);
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      M.startingPmgrgovProcV2("r1");
      M.completeProcPmgrgovV2("r1");
      expect(() =>
        M.createPmgrgovProcV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPmgrgovProcV2("nope")).toBeNull());
    it("list", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      M.createPmgrgovProcV2({ id: "r2", profileId: "p1" });
      expect(M.listPmgrgovProcsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPmgrgovProcV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPmgrgovProcV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPmgrgovProcV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStopIdle", () => {
      M.setPmgrgovProfileIdleMsV2(1000);
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
      const r = M.autoStopIdlePmgrgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPmgrgovProfileV2("p1").status).toBe("stopped");
    });
    it("autoFailStuck", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      M.startingPmgrgovProcV2("r1");
      M.setPmgrgovProcStuckMsV2(100);
      const r = M.autoFailStuckPmgrgovProcsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPmgrgovProfileIdleMsV2(1000);
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStopIdlePmgrgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getProcessManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.procsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPmgrgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgrgovProfileV2("p1");
      M.createPmgrgovProcV2({ id: "r1", profileId: "p1" });
      const s2 = M.getProcessManagerGovStatsV2();
      expect(s2.totalPmgrgovProfilesV2).toBe(1);
      expect(s2.totalPmgrgovProcsV2).toBe(1);
    });
  });
});
