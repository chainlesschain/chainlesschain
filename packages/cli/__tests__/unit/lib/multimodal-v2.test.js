import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/multimodal.js";

describe("Multimodal V2 Surface", () => {
  beforeEach(() => M._resetStateMultimodalGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.MMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.MMGOV_JOB_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.MMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.MMGOV_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveMmgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveMmgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingMmgovJobsPerProfileV2(33);
      expect(M.getMaxPendingMmgovJobsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setMmgovProfileIdleMsV2(60000);
      expect(M.getMmgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setMmgovJobStuckMsV2(45000);
      expect(M.getMmgovJobStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveMmgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setMmgovJobStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveMmgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveMmgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerMmgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default kind", () =>
      expect(M.registerMmgovProfileV2({ id: "p1", owner: "a" }).kind).toBe(
        "text",
      ));
    it("activate", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateMmgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
      expect(M.staleMmgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateMmgovProfileV2("p1");
      M.staleMmgovProfileV2("p1");
      expect(M.activateMmgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
      expect(M.archiveMmgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
      M.archiveMmgovProfileV2("p1");
      expect(() => M.touchMmgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleMmgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerMmgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerMmgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getMmgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.registerMmgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listMmgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getMmgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getMmgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveMmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMmgovProfileV2({ id, owner: "a" }),
      );
      M.activateMmgovProfileV2("p1");
      M.activateMmgovProfileV2("p2");
      expect(() => M.activateMmgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveMmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMmgovProfileV2({ id, owner: "a" }),
      );
      M.activateMmgovProfileV2("p1");
      M.activateMmgovProfileV2("p2");
      M.staleMmgovProfileV2("p1");
      M.activateMmgovProfileV2("p3");
      expect(() => M.activateMmgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveMmgovProfilesPerOwnerV2(1);
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.registerMmgovProfileV2({ id: "p2", owner: "b" });
      M.activateMmgovProfileV2("p1");
      expect(() => M.activateMmgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("job lifecycle", () => {
    beforeEach(() => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
    });
    it("create→processing→complete", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      M.processingMmgovJobV2("r1");
      const r = M.completeJobMmgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      M.processingMmgovJobV2("r1");
      expect(M.failMmgovJobV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMmgovJobV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeJobMmgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createMmgovJobV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingMmgovJobsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createMmgovJobV2({ id, profileId: "p1" }));
      expect(() => M.createMmgovJobV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("processing counts as pending", () => {
      M.setMaxPendingMmgovJobsPerProfileV2(1);
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      M.processingMmgovJobV2("r1");
      expect(() => M.createMmgovJobV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingMmgovJobsPerProfileV2(1);
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      M.processingMmgovJobV2("r1");
      M.completeJobMmgovV2("r1");
      expect(() =>
        M.createMmgovJobV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getMmgovJobV2("nope")).toBeNull());
    it("list", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      M.createMmgovJobV2({ id: "r2", profileId: "p1" });
      expect(M.listMmgovJobsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createMmgovJobV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      expect(() => M.createMmgovJobV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMmgovJobV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setMmgovProfileIdleMsV2(1000);
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
      const r = M.autoStaleIdleMmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getMmgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      M.processingMmgovJobV2("r1");
      M.setMmgovJobStuckMsV2(100);
      const r = M.autoFailStuckMmgovJobsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setMmgovProfileIdleMsV2(1000);
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleMmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getMultimodalGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.jobsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerMmgovProfileV2({ id: "p1", owner: "a" });
      M.activateMmgovProfileV2("p1");
      M.createMmgovJobV2({ id: "r1", profileId: "p1" });
      const s2 = M.getMultimodalGovStatsV2();
      expect(s2.totalMmgovProfilesV2).toBe(1);
      expect(s2.totalMmgovJobsV2).toBe(1);
    });
  });
});
