import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/community-governance.js";

describe("CommunityGovernance V2 Surface", () => {
  beforeEach(() => M._resetStateCommunityGovernanceGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.COMMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.COMMGOV_MOTION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.COMMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.COMMGOV_MOTION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCommgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCommgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCommgovMotionsPerProfileV2(33);
      expect(M.getMaxPendingCommgovMotionsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCommgovProfileIdleMsV2(60000);
      expect(M.getCommgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCommgovMotionStuckMsV2(45000);
      expect(M.getCommgovMotionStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCommgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCommgovMotionStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCommgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCommgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCommgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default chamber", () =>
      expect(M.registerCommgovProfileV2({ id: "p1", owner: "a" }).chamber).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCommgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
      expect(M.pauseCommgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCommgovProfileV2("p1");
      M.pauseCommgovProfileV2("p1");
      expect(M.activateCommgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
      expect(M.archiveCommgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
      M.archiveCommgovProfileV2("p1");
      expect(() => M.touchCommgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseCommgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCommgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCommgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCommgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.registerCommgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCommgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCommgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCommgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCommgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCommgovProfileV2({ id, owner: "a" }),
      );
      M.activateCommgovProfileV2("p1");
      M.activateCommgovProfileV2("p2");
      expect(() => M.activateCommgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCommgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCommgovProfileV2({ id, owner: "a" }),
      );
      M.activateCommgovProfileV2("p1");
      M.activateCommgovProfileV2("p2");
      M.pauseCommgovProfileV2("p1");
      M.activateCommgovProfileV2("p3");
      expect(() => M.activateCommgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCommgovProfilesPerOwnerV2(1);
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.registerCommgovProfileV2({ id: "p2", owner: "b" });
      M.activateCommgovProfileV2("p1");
      expect(() => M.activateCommgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("motion lifecycle", () => {
    beforeEach(() => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
    });
    it("create→voting→complete", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      M.votingCommgovMotionV2("r1");
      const r = M.completeMotionCommgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      M.votingCommgovMotionV2("r1");
      expect(M.failCommgovMotionV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCommgovMotionV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMotionCommgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCommgovMotionV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCommgovMotionsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCommgovMotionV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCommgovMotionV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("voting counts as pending", () => {
      M.setMaxPendingCommgovMotionsPerProfileV2(1);
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      M.votingCommgovMotionV2("r1");
      expect(() =>
        M.createCommgovMotionV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCommgovMotionsPerProfileV2(1);
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      M.votingCommgovMotionV2("r1");
      M.completeMotionCommgovV2("r1");
      expect(() =>
        M.createCommgovMotionV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCommgovMotionV2("nope")).toBeNull());
    it("list", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      M.createCommgovMotionV2({ id: "r2", profileId: "p1" });
      expect(M.listCommgovMotionsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCommgovMotionV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCommgovMotionV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCommgovMotionV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setCommgovProfileIdleMsV2(1000);
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
      const r = M.autoPauseIdleCommgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCommgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      M.votingCommgovMotionV2("r1");
      M.setCommgovMotionStuckMsV2(100);
      const r = M.autoFailStuckCommgovMotionsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCommgovProfileIdleMsV2(1000);
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleCommgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCommunityGovernanceGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.motionsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCommgovProfileV2({ id: "p1", owner: "a" });
      M.activateCommgovProfileV2("p1");
      M.createCommgovMotionV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCommunityGovernanceGovStatsV2();
      expect(s2.totalCommgovProfilesV2).toBe(1);
      expect(s2.totalCommgovMotionsV2).toBe(1);
    });
  });
});
