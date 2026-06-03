import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/did-manager.js";

describe("DidManager V2 Surface", () => {
  beforeEach(() => M._resetStateDidManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DIDGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DIDGOV_RESOLUTION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DIDGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DIDGOV_RESOLUTION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDidgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDidgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDidgovResolutionsPerProfileV2(33);
      expect(M.getMaxPendingDidgovResolutionsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDidgovProfileIdleMsV2(60000);
      expect(M.getDidgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDidgovResolutionStuckMsV2(45000);
      expect(M.getDidgovResolutionStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDidgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDidgovResolutionStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDidgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDidgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDidgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default method", () =>
      expect(M.registerDidgovProfileV2({ id: "p1", owner: "a" }).method).toBe(
        "key",
      ));
    it("activate", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDidgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
      expect(M.suspendDidgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDidgovProfileV2("p1");
      M.suspendDidgovProfileV2("p1");
      expect(M.activateDidgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
      expect(M.archiveDidgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
      M.archiveDidgovProfileV2("p1");
      expect(() => M.touchDidgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendDidgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDidgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDidgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDidgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.registerDidgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listDidgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDidgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDidgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDidgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDidgovProfileV2({ id, owner: "a" }),
      );
      M.activateDidgovProfileV2("p1");
      M.activateDidgovProfileV2("p2");
      expect(() => M.activateDidgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDidgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDidgovProfileV2({ id, owner: "a" }),
      );
      M.activateDidgovProfileV2("p1");
      M.activateDidgovProfileV2("p2");
      M.suspendDidgovProfileV2("p1");
      M.activateDidgovProfileV2("p3");
      expect(() => M.activateDidgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDidgovProfilesPerOwnerV2(1);
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.registerDidgovProfileV2({ id: "p2", owner: "b" });
      M.activateDidgovProfileV2("p1");
      expect(() => M.activateDidgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("resolution lifecycle", () => {
    beforeEach(() => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
    });
    it("create→resolving→complete", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      M.resolvingDidgovResolutionV2("r1");
      const r = M.completeResolutionDidgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      M.resolvingDidgovResolutionV2("r1");
      expect(M.failDidgovResolutionV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDidgovResolutionV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeResolutionDidgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDidgovResolutionV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDidgovResolutionsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDidgovResolutionV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createDidgovResolutionV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("resolving counts as pending", () => {
      M.setMaxPendingDidgovResolutionsPerProfileV2(1);
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      M.resolvingDidgovResolutionV2("r1");
      expect(() =>
        M.createDidgovResolutionV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDidgovResolutionsPerProfileV2(1);
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      M.resolvingDidgovResolutionV2("r1");
      M.completeResolutionDidgovV2("r1");
      expect(() =>
        M.createDidgovResolutionV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDidgovResolutionV2("nope")).toBeNull());
    it("list", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      M.createDidgovResolutionV2({ id: "r2", profileId: "p1" });
      expect(M.listDidgovResolutionsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDidgovResolutionV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDidgovResolutionV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDidgovResolutionV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setDidgovProfileIdleMsV2(1000);
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
      const r = M.autoSuspendIdleDidgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDidgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      M.resolvingDidgovResolutionV2("r1");
      M.setDidgovResolutionStuckMsV2(100);
      const r = M.autoFailStuckDidgovResolutionsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDidgovProfileIdleMsV2(1000);
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleDidgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDidManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.resolutionsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDidgovProfileV2({ id: "p1", owner: "a" });
      M.activateDidgovProfileV2("p1");
      M.createDidgovResolutionV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDidManagerGovStatsV2();
      expect(s2.totalDidgovProfilesV2).toBe(1);
      expect(s2.totalDidgovResolutionsV2).toBe(1);
    });
  });
});
