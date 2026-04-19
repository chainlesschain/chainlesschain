import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/content-recommendation.js";

describe("ContentRecommendationGov V2 Surface", () => {
  beforeEach(() => M._resetStateContentRecommendationGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.RCMDGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.RCMDGOV_RECOMMENDATION_LIFECYCLE_V2)).toHaveLength(
        5,
      ));
    it("frozen", () => {
      expect(Object.isFrozen(M.RCMDGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.RCMDGOV_RECOMMENDATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveRcmdgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveRcmdgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingRcmdgovRecommendationsPerProfileV2(33);
      expect(M.getMaxPendingRcmdgovRecommendationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setRcmdgovProfileIdleMsV2(60000);
      expect(M.getRcmdgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setRcmdgovRecommendationStuckMsV2(45000);
      expect(M.getRcmdgovRecommendationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveRcmdgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setRcmdgovRecommendationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveRcmdgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveRcmdgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerRcmdgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default channel", () =>
      expect(M.registerRcmdgovProfileV2({ id: "p1", owner: "a" }).channel).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateRcmdgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
      expect(M.staleRcmdgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateRcmdgovProfileV2("p1");
      M.staleRcmdgovProfileV2("p1");
      expect(M.activateRcmdgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
      expect(M.archiveRcmdgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
      M.archiveRcmdgovProfileV2("p1");
      expect(() => M.touchRcmdgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleRcmdgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerRcmdgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerRcmdgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getRcmdgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.registerRcmdgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listRcmdgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getRcmdgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getRcmdgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveRcmdgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRcmdgovProfileV2({ id, owner: "a" }),
      );
      M.activateRcmdgovProfileV2("p1");
      M.activateRcmdgovProfileV2("p2");
      expect(() => M.activateRcmdgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveRcmdgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRcmdgovProfileV2({ id, owner: "a" }),
      );
      M.activateRcmdgovProfileV2("p1");
      M.activateRcmdgovProfileV2("p2");
      M.staleRcmdgovProfileV2("p1");
      M.activateRcmdgovProfileV2("p3");
      expect(() => M.activateRcmdgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveRcmdgovProfilesPerOwnerV2(1);
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.registerRcmdgovProfileV2({ id: "p2", owner: "b" });
      M.activateRcmdgovProfileV2("p1");
      expect(() => M.activateRcmdgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("recommendation lifecycle", () => {
    beforeEach(() => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
    });
    it("create→scoring→complete", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      M.scoringRcmdgovRecommendationV2("r1");
      const r = M.completeRecommendationRcmdgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      M.scoringRcmdgovRecommendationV2("r1");
      expect(M.failRcmdgovRecommendationV2("r1", "x").metadata.failReason).toBe(
        "x",
      );
    });
    it("cancel from queued", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRcmdgovRecommendationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRecommendationRcmdgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createRcmdgovRecommendationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingRcmdgovRecommendationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createRcmdgovRecommendationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createRcmdgovRecommendationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("scoring counts as pending", () => {
      M.setMaxPendingRcmdgovRecommendationsPerProfileV2(1);
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      M.scoringRcmdgovRecommendationV2("r1");
      expect(() =>
        M.createRcmdgovRecommendationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingRcmdgovRecommendationsPerProfileV2(1);
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      M.scoringRcmdgovRecommendationV2("r1");
      M.completeRecommendationRcmdgovV2("r1");
      expect(() =>
        M.createRcmdgovRecommendationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () =>
      expect(M.getRcmdgovRecommendationV2("nope")).toBeNull());
    it("list", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      M.createRcmdgovRecommendationV2({ id: "r2", profileId: "p1" });
      expect(M.listRcmdgovRecommendationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() =>
        M.createRcmdgovRecommendationV2({ profileId: "p1" }),
      ).toThrow());
    it("duplicate id", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      expect(
        M.cancelRcmdgovRecommendationV2("r1", "y").metadata.cancelReason,
      ).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setRcmdgovProfileIdleMsV2(1000);
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
      const r = M.autoStaleIdleRcmdgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getRcmdgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      M.scoringRcmdgovRecommendationV2("r1");
      M.setRcmdgovRecommendationStuckMsV2(100);
      const r = M.autoFailStuckRcmdgovRecommendationsV2({
        now: Date.now() + 5000,
      });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setRcmdgovProfileIdleMsV2(1000);
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleRcmdgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getContentRecommendationGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.recommendationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerRcmdgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcmdgovProfileV2("p1");
      M.createRcmdgovRecommendationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getContentRecommendationGovStatsV2();
      expect(s2.totalRcmdgovProfilesV2).toBe(1);
      expect(s2.totalRcmdgovRecommendationsV2).toBe(1);
    });
  });
});
