import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/token-incentive.js";

describe("TokenIncentive V2 Surface", () => {
  beforeEach(() => M._resetStateTokenIncentiveV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.INCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.INCGOV_PAYOUT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.INCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.INCGOV_PAYOUT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveIncgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveIncgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingIncgovPayoutsPerProfileV2(33);
      expect(M.getMaxPendingIncgovPayoutsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setIncgovProfileIdleMsV2(60000);
      expect(M.getIncgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setIncgovPayoutStuckMsV2(45000);
      expect(M.getIncgovPayoutStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveIncgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setIncgovPayoutStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveIncgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveIncgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerIncgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default token", () =>
      expect(M.registerIncgovProfileV2({ id: "p1", owner: "a" }).token).toBe(
        "CLC",
      ));
    it("activate", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateIncgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
      expect(M.pauseIncgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateIncgovProfileV2("p1");
      M.pauseIncgovProfileV2("p1");
      expect(M.activateIncgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
      expect(M.archiveIncgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
      M.archiveIncgovProfileV2("p1");
      expect(() => M.touchIncgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseIncgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerIncgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerIncgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getIncgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.registerIncgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listIncgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getIncgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getIncgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveIncgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerIncgovProfileV2({ id, owner: "a" }),
      );
      M.activateIncgovProfileV2("p1");
      M.activateIncgovProfileV2("p2");
      expect(() => M.activateIncgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveIncgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerIncgovProfileV2({ id, owner: "a" }),
      );
      M.activateIncgovProfileV2("p1");
      M.activateIncgovProfileV2("p2");
      M.pauseIncgovProfileV2("p1");
      M.activateIncgovProfileV2("p3");
      expect(() => M.activateIncgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveIncgovProfilesPerOwnerV2(1);
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.registerIncgovProfileV2({ id: "p2", owner: "b" });
      M.activateIncgovProfileV2("p1");
      expect(() => M.activateIncgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("payout lifecycle", () => {
    beforeEach(() => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
    });
    it("create→processing→complete", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      M.processingIncgovPayoutV2("r1");
      const r = M.completePayoutIncgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      M.processingIncgovPayoutV2("r1");
      expect(M.failIncgovPayoutV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      expect(M.cancelIncgovPayoutV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePayoutIncgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createIncgovPayoutV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingIncgovPayoutsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createIncgovPayoutV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createIncgovPayoutV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("processing counts as pending", () => {
      M.setMaxPendingIncgovPayoutsPerProfileV2(1);
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      M.processingIncgovPayoutV2("r1");
      expect(() =>
        M.createIncgovPayoutV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingIncgovPayoutsPerProfileV2(1);
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      M.processingIncgovPayoutV2("r1");
      M.completePayoutIncgovV2("r1");
      expect(() =>
        M.createIncgovPayoutV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getIncgovPayoutV2("nope")).toBeNull());
    it("list", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      M.createIncgovPayoutV2({ id: "r2", profileId: "p1" });
      expect(M.listIncgovPayoutsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createIncgovPayoutV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createIncgovPayoutV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      expect(M.cancelIncgovPayoutV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setIncgovProfileIdleMsV2(1000);
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
      const r = M.autoPauseIdleIncgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getIncgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      M.processingIncgovPayoutV2("r1");
      M.setIncgovPayoutStuckMsV2(100);
      const r = M.autoFailStuckIncgovPayoutsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setIncgovProfileIdleMsV2(1000);
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleIncgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTokenIncentiveGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.payoutsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerIncgovProfileV2({ id: "p1", owner: "a" });
      M.activateIncgovProfileV2("p1");
      M.createIncgovPayoutV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTokenIncentiveGovStatsV2();
      expect(s2.totalIncgovProfilesV2).toBe(1);
      expect(s2.totalIncgovPayoutsV2).toBe(1);
    });
  });
});
