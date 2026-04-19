import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/browser-automation.js";

describe("BrowserAutomation V2 Surface", () => {
  beforeEach(() => M._resetStateBrowserAutomationGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.BAGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.BAGOV_NAVIGATION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.BAGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.BAGOV_NAVIGATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveBagovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveBagovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingBagovNavigationsPerProfileV2(33);
      expect(M.getMaxPendingBagovNavigationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setBagovProfileIdleMsV2(60000);
      expect(M.getBagovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setBagovNavigationStuckMsV2(45000);
      expect(M.getBagovNavigationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveBagovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setBagovNavigationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveBagovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveBagovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerBagovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default engine", () =>
      expect(M.registerBagovProfileV2({ id: "p1", owner: "a" }).engine).toBe(
        "chromium",
      ));
    it("activate", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateBagovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
      expect(M.staleBagovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateBagovProfileV2("p1");
      M.staleBagovProfileV2("p1");
      expect(M.activateBagovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
      expect(M.archiveBagovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
      M.archiveBagovProfileV2("p1");
      expect(() => M.touchBagovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleBagovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerBagovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerBagovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getBagovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.registerBagovProfileV2({ id: "p2", owner: "b" });
      expect(M.listBagovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getBagovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getBagovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveBagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerBagovProfileV2({ id, owner: "a" }),
      );
      M.activateBagovProfileV2("p1");
      M.activateBagovProfileV2("p2");
      expect(() => M.activateBagovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveBagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerBagovProfileV2({ id, owner: "a" }),
      );
      M.activateBagovProfileV2("p1");
      M.activateBagovProfileV2("p2");
      M.staleBagovProfileV2("p1");
      M.activateBagovProfileV2("p3");
      expect(() => M.activateBagovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveBagovProfilesPerOwnerV2(1);
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.registerBagovProfileV2({ id: "p2", owner: "b" });
      M.activateBagovProfileV2("p1");
      expect(() => M.activateBagovProfileV2("p2")).not.toThrow();
    });
  });

  describe("navigation lifecycle", () => {
    beforeEach(() => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
    });
    it("create→navigating→complete", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      M.navigatingBagovNavigationV2("r1");
      const r = M.completeNavigationBagovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      M.navigatingBagovNavigationV2("r1");
      expect(M.failBagovNavigationV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelBagovNavigationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeNavigationBagovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createBagovNavigationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingBagovNavigationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createBagovNavigationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createBagovNavigationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("navigating counts as pending", () => {
      M.setMaxPendingBagovNavigationsPerProfileV2(1);
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      M.navigatingBagovNavigationV2("r1");
      expect(() =>
        M.createBagovNavigationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingBagovNavigationsPerProfileV2(1);
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      M.navigatingBagovNavigationV2("r1");
      M.completeNavigationBagovV2("r1");
      expect(() =>
        M.createBagovNavigationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getBagovNavigationV2("nope")).toBeNull());
    it("list", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      M.createBagovNavigationV2({ id: "r2", profileId: "p1" });
      expect(M.listBagovNavigationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createBagovNavigationV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createBagovNavigationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelBagovNavigationV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setBagovProfileIdleMsV2(1000);
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
      const r = M.autoStaleIdleBagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getBagovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      M.navigatingBagovNavigationV2("r1");
      M.setBagovNavigationStuckMsV2(100);
      const r = M.autoFailStuckBagovNavigationsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setBagovProfileIdleMsV2(1000);
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleBagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getBrowserAutomationGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.navigationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerBagovProfileV2({ id: "p1", owner: "a" });
      M.activateBagovProfileV2("p1");
      M.createBagovNavigationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getBrowserAutomationGovStatsV2();
      expect(s2.totalBagovProfilesV2).toBe(1);
      expect(s2.totalBagovNavigationsV2).toBe(1);
    });
  });
});
