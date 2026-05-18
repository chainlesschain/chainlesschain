import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-learning.js";

describe("CoworkLearning V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkLearningV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.LEARN_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.LEARN_SAMPLE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.LEARN_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.LEARN_SAMPLE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveLearnProfilesPerOwnerV2(11);
      expect(M.getMaxActiveLearnProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingLearnSamplesPerProfileV2(33);
      expect(M.getMaxPendingLearnSamplesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setLearnProfileIdleMsV2(60000);
      expect(M.getLearnProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setLearnSampleStuckMsV2(45000);
      expect(M.getLearnSampleStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveLearnProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setLearnSampleStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveLearnProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveLearnProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerLearnProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default topic", () =>
      expect(M.registerLearnProfileV2({ id: "p1", owner: "a" }).topic).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      expect(M.activateLearnProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
      expect(M.staleLearnProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      const a = M.activateLearnProfileV2("p1");
      M.staleLearnProfileV2("p1");
      expect(M.activateLearnProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
      expect(M.archiveLearnProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
      M.archiveLearnProfileV2("p1");
      expect(() => M.touchLearnProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleLearnProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerLearnProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerLearnProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getLearnProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.registerLearnProfileV2({ id: "p2", owner: "b" });
      expect(M.listLearnProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getLearnProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getLearnProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveLearnProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerLearnProfileV2({ id, owner: "a" }),
      );
      M.activateLearnProfileV2("p1");
      M.activateLearnProfileV2("p2");
      expect(() => M.activateLearnProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveLearnProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerLearnProfileV2({ id, owner: "a" }),
      );
      M.activateLearnProfileV2("p1");
      M.activateLearnProfileV2("p2");
      M.staleLearnProfileV2("p1");
      M.activateLearnProfileV2("p3");
      expect(() => M.activateLearnProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveLearnProfilesPerOwnerV2(1);
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.registerLearnProfileV2({ id: "p2", owner: "b" });
      M.activateLearnProfileV2("p1");
      expect(() => M.activateLearnProfileV2("p2")).not.toThrow();
    });
  });

  describe("sample lifecycle", () => {
    beforeEach(() => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
    });
    it("create→training→complete", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      M.trainingLearnSampleV2("r1");
      const r = M.completeSampleLearnV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      M.trainingLearnSampleV2("r1");
      expect(M.failLearnSampleV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      expect(M.cancelLearnSampleV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSampleLearnV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createLearnSampleV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingLearnSamplesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createLearnSampleV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createLearnSampleV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("training counts as pending", () => {
      M.setMaxPendingLearnSamplesPerProfileV2(1);
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      M.trainingLearnSampleV2("r1");
      expect(() =>
        M.createLearnSampleV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingLearnSamplesPerProfileV2(1);
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      M.trainingLearnSampleV2("r1");
      M.completeSampleLearnV2("r1");
      expect(() =>
        M.createLearnSampleV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getLearnSampleV2("nope")).toBeNull());
    it("list", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      M.createLearnSampleV2({ id: "r2", profileId: "p1" });
      expect(M.listLearnSamplesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createLearnSampleV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createLearnSampleV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      expect(M.cancelLearnSampleV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setLearnProfileIdleMsV2(1000);
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
      const r = M.autoStaleIdleLearnProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getLearnProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      M.trainingLearnSampleV2("r1");
      M.setLearnSampleStuckMsV2(100);
      const r = M.autoFailStuckLearnSamplesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setLearnProfileIdleMsV2(1000);
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleLearnProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkLearningGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.samplesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerLearnProfileV2({ id: "p1", owner: "a" });
      M.activateLearnProfileV2("p1");
      M.createLearnSampleV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkLearningGovStatsV2();
      expect(s2.totalLearnProfilesV2).toBe(1);
      expect(s2.totalLearnSamplesV2).toBe(1);
    });
  });
});
