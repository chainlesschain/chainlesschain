import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/response-cache.js";

describe("ResponseCacheGov V2 Surface", () => {
  beforeEach(() => M._resetStateResponseCacheGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.RCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.RCGOV_REFRESH_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.RCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.RCGOV_REFRESH_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveRcgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveRcgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingRcgovRefreshsPerProfileV2(33);
      expect(M.getMaxPendingRcgovRefreshsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setRcgovProfileIdleMsV2(60000);
      expect(M.getRcgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setRcgovRefreshStuckMsV2(45000);
      expect(M.getRcgovRefreshStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveRcgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setRcgovRefreshStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveRcgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveRcgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerRcgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default lane", () =>
      expect(M.registerRcgovProfileV2({ id: "p1", owner: "a" }).lane).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateRcgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
      expect(M.staleRcgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateRcgovProfileV2("p1");
      M.staleRcgovProfileV2("p1");
      expect(M.activateRcgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
      expect(M.archiveRcgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
      M.archiveRcgovProfileV2("p1");
      expect(() => M.touchRcgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleRcgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerRcgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerRcgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getRcgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.registerRcgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listRcgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getRcgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getRcgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveRcgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRcgovProfileV2({ id, owner: "a" }),
      );
      M.activateRcgovProfileV2("p1");
      M.activateRcgovProfileV2("p2");
      expect(() => M.activateRcgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveRcgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRcgovProfileV2({ id, owner: "a" }),
      );
      M.activateRcgovProfileV2("p1");
      M.activateRcgovProfileV2("p2");
      M.staleRcgovProfileV2("p1");
      M.activateRcgovProfileV2("p3");
      expect(() => M.activateRcgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveRcgovProfilesPerOwnerV2(1);
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.registerRcgovProfileV2({ id: "p2", owner: "b" });
      M.activateRcgovProfileV2("p1");
      expect(() => M.activateRcgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("refresh lifecycle", () => {
    beforeEach(() => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
    });
    it("create→refreshing→complete", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      M.refreshingRcgovRefreshV2("r1");
      const r = M.completeRefreshRcgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      M.refreshingRcgovRefreshV2("r1");
      expect(M.failRcgovRefreshV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRcgovRefreshV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRefreshRcgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createRcgovRefreshV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingRcgovRefreshsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createRcgovRefreshV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createRcgovRefreshV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("refreshing counts as pending", () => {
      M.setMaxPendingRcgovRefreshsPerProfileV2(1);
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      M.refreshingRcgovRefreshV2("r1");
      expect(() =>
        M.createRcgovRefreshV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingRcgovRefreshsPerProfileV2(1);
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      M.refreshingRcgovRefreshV2("r1");
      M.completeRefreshRcgovV2("r1");
      expect(() =>
        M.createRcgovRefreshV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getRcgovRefreshV2("nope")).toBeNull());
    it("list", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      M.createRcgovRefreshV2({ id: "r2", profileId: "p1" });
      expect(M.listRcgovRefreshsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createRcgovRefreshV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createRcgovRefreshV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRcgovRefreshV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setRcgovProfileIdleMsV2(1000);
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
      const r = M.autoStaleIdleRcgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getRcgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      M.refreshingRcgovRefreshV2("r1");
      M.setRcgovRefreshStuckMsV2(100);
      const r = M.autoFailStuckRcgovRefreshsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setRcgovProfileIdleMsV2(1000);
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleRcgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getResponseCacheGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.refreshsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerRcgovProfileV2({ id: "p1", owner: "a" });
      M.activateRcgovProfileV2("p1");
      M.createRcgovRefreshV2({ id: "r1", profileId: "p1" });
      const s2 = M.getResponseCacheGovStatsV2();
      expect(s2.totalRcgovProfilesV2).toBe(1);
      expect(s2.totalRcgovRefreshsV2).toBe(1);
    });
  });
});
