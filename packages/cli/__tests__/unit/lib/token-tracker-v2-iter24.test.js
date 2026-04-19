import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/token-tracker.js";

describe("TokenTrackerGov V2 Surface", () => {
  beforeEach(() => M._resetStateTokenTrackerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TOKTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TOKTGOV_USAGE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TOKTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TOKTGOV_USAGE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveToktgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveToktgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingToktgovUsagesPerProfileV2(33);
      expect(M.getMaxPendingToktgovUsagesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setToktgovProfileIdleMsV2(60000);
      expect(M.getToktgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setToktgovUsageStuckMsV2(45000);
      expect(M.getToktgovUsageStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveToktgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setToktgovUsageStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveToktgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveToktgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerToktgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default budget", () =>
      expect(M.registerToktgovProfileV2({ id: "p1", owner: "a" }).budget).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateToktgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
      expect(M.staleToktgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateToktgovProfileV2("p1");
      M.staleToktgovProfileV2("p1");
      expect(M.activateToktgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
      expect(M.archiveToktgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
      M.archiveToktgovProfileV2("p1");
      expect(() => M.touchToktgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleToktgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerToktgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerToktgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getToktgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.registerToktgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listToktgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getToktgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getToktgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveToktgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerToktgovProfileV2({ id, owner: "a" }),
      );
      M.activateToktgovProfileV2("p1");
      M.activateToktgovProfileV2("p2");
      expect(() => M.activateToktgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveToktgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerToktgovProfileV2({ id, owner: "a" }),
      );
      M.activateToktgovProfileV2("p1");
      M.activateToktgovProfileV2("p2");
      M.staleToktgovProfileV2("p1");
      M.activateToktgovProfileV2("p3");
      expect(() => M.activateToktgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveToktgovProfilesPerOwnerV2(1);
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.registerToktgovProfileV2({ id: "p2", owner: "b" });
      M.activateToktgovProfileV2("p1");
      expect(() => M.activateToktgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("usage lifecycle", () => {
    beforeEach(() => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
    });
    it("create→recording→complete", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      M.recordingToktgovUsageV2("r1");
      const r = M.completeUsageToktgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      M.recordingToktgovUsageV2("r1");
      expect(M.failToktgovUsageV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      expect(M.cancelToktgovUsageV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeUsageToktgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createToktgovUsageV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingToktgovUsagesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createToktgovUsageV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createToktgovUsageV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("recording counts as pending", () => {
      M.setMaxPendingToktgovUsagesPerProfileV2(1);
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      M.recordingToktgovUsageV2("r1");
      expect(() =>
        M.createToktgovUsageV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingToktgovUsagesPerProfileV2(1);
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      M.recordingToktgovUsageV2("r1");
      M.completeUsageToktgovV2("r1");
      expect(() =>
        M.createToktgovUsageV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getToktgovUsageV2("nope")).toBeNull());
    it("list", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      M.createToktgovUsageV2({ id: "r2", profileId: "p1" });
      expect(M.listToktgovUsagesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createToktgovUsageV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createToktgovUsageV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      expect(M.cancelToktgovUsageV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setToktgovProfileIdleMsV2(1000);
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
      const r = M.autoStaleIdleToktgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getToktgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      M.recordingToktgovUsageV2("r1");
      M.setToktgovUsageStuckMsV2(100);
      const r = M.autoFailStuckToktgovUsagesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setToktgovProfileIdleMsV2(1000);
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleToktgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTokenTrackerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.usagesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerToktgovProfileV2({ id: "p1", owner: "a" });
      M.activateToktgovProfileV2("p1");
      M.createToktgovUsageV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTokenTrackerGovStatsV2();
      expect(s2.totalToktgovProfilesV2).toBe(1);
      expect(s2.totalToktgovUsagesV2).toBe(1);
    });
  });
});
