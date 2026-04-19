import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/privacy-computing.js";

describe("PrivacyComputing V2 Surface", () => {
  beforeEach(() => M._resetStatePrivacyComputingV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PCGOV_JOB_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PCGOV_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePcgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePcgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPcgovJobsPerProfileV2(33);
      expect(M.getMaxPendingPcgovJobsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPcgovProfileIdleMsV2(60000);
      expect(M.getPcgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPcgovJobStuckMsV2(45000);
      expect(M.getPcgovJobStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePcgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPcgovJobStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePcgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePcgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPcgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default technique", () =>
      expect(M.registerPcgovProfileV2({ id: "p1", owner: "a" }).technique).toBe(
        "mpc",
      ));
    it("activate", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePcgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
      expect(M.suspendPcgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePcgovProfileV2("p1");
      M.suspendPcgovProfileV2("p1");
      expect(M.activatePcgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
      expect(M.archivePcgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
      M.archivePcgovProfileV2("p1");
      expect(() => M.touchPcgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendPcgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPcgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPcgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPcgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.registerPcgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPcgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPcgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPcgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePcgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPcgovProfileV2({ id, owner: "a" }),
      );
      M.activatePcgovProfileV2("p1");
      M.activatePcgovProfileV2("p2");
      expect(() => M.activatePcgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePcgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPcgovProfileV2({ id, owner: "a" }),
      );
      M.activatePcgovProfileV2("p1");
      M.activatePcgovProfileV2("p2");
      M.suspendPcgovProfileV2("p1");
      M.activatePcgovProfileV2("p3");
      expect(() => M.activatePcgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePcgovProfilesPerOwnerV2(1);
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.registerPcgovProfileV2({ id: "p2", owner: "b" });
      M.activatePcgovProfileV2("p1");
      expect(() => M.activatePcgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("job lifecycle", () => {
    beforeEach(() => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
    });
    it("create→computing→complete", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      M.computingPcgovJobV2("r1");
      const r = M.completeJobPcgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      M.computingPcgovJobV2("r1");
      expect(M.failPcgovJobV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPcgovJobV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeJobPcgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPcgovJobV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPcgovJobsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createPcgovJobV2({ id, profileId: "p1" }));
      expect(() => M.createPcgovJobV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("computing counts as pending", () => {
      M.setMaxPendingPcgovJobsPerProfileV2(1);
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      M.computingPcgovJobV2("r1");
      expect(() => M.createPcgovJobV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPcgovJobsPerProfileV2(1);
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      M.computingPcgovJobV2("r1");
      M.completeJobPcgovV2("r1");
      expect(() =>
        M.createPcgovJobV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPcgovJobV2("nope")).toBeNull());
    it("list", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      M.createPcgovJobV2({ id: "r2", profileId: "p1" });
      expect(M.listPcgovJobsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPcgovJobV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.createPcgovJobV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPcgovJobV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setPcgovProfileIdleMsV2(1000);
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
      const r = M.autoSuspendIdlePcgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPcgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      M.computingPcgovJobV2("r1");
      M.setPcgovJobStuckMsV2(100);
      const r = M.autoFailStuckPcgovJobsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPcgovProfileIdleMsV2(1000);
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdlePcgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPrivacyComputingGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.jobsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePcgovProfileV2("p1");
      M.createPcgovJobV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPrivacyComputingGovStatsV2();
      expect(s2.totalPcgovProfilesV2).toBe(1);
      expect(s2.totalPcgovJobsV2).toBe(1);
    });
  });
});
