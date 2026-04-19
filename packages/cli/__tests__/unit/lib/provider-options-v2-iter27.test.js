import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/provider-options.js";

describe("ProviderOptionsGov V2 Surface", () => {
  beforeEach(() => M._resetStateProviderOptionsGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.POPTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.POPTGOV_RESOLVE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.POPTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.POPTGOV_RESOLVE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePoptgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePoptgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPoptgovResolvesPerProfileV2(33);
      expect(M.getMaxPendingPoptgovResolvesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPoptgovProfileIdleMsV2(60000);
      expect(M.getPoptgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPoptgovResolveStuckMsV2(45000);
      expect(M.getPoptgovResolveStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePoptgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPoptgovResolveStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePoptgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePoptgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPoptgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default provider", () =>
      expect(
        M.registerPoptgovProfileV2({ id: "p1", owner: "a" }).provider,
      ).toBe("default"));
    it("activate", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePoptgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
      expect(M.stalePoptgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePoptgovProfileV2("p1");
      M.stalePoptgovProfileV2("p1");
      expect(M.activatePoptgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
      expect(M.archivePoptgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
      M.archivePoptgovProfileV2("p1");
      expect(() => M.touchPoptgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stalePoptgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPoptgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPoptgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPoptgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.registerPoptgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPoptgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPoptgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPoptgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePoptgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPoptgovProfileV2({ id, owner: "a" }),
      );
      M.activatePoptgovProfileV2("p1");
      M.activatePoptgovProfileV2("p2");
      expect(() => M.activatePoptgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePoptgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPoptgovProfileV2({ id, owner: "a" }),
      );
      M.activatePoptgovProfileV2("p1");
      M.activatePoptgovProfileV2("p2");
      M.stalePoptgovProfileV2("p1");
      M.activatePoptgovProfileV2("p3");
      expect(() => M.activatePoptgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePoptgovProfilesPerOwnerV2(1);
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.registerPoptgovProfileV2({ id: "p2", owner: "b" });
      M.activatePoptgovProfileV2("p1");
      expect(() => M.activatePoptgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("resolve lifecycle", () => {
    beforeEach(() => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
    });
    it("create→resolving→complete", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      M.resolvingPoptgovResolveV2("r1");
      const r = M.completeResolvePoptgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      M.resolvingPoptgovResolveV2("r1");
      expect(M.failPoptgovResolveV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPoptgovResolveV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeResolvePoptgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPoptgovResolveV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPoptgovResolvesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPoptgovResolveV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createPoptgovResolveV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("resolving counts as pending", () => {
      M.setMaxPendingPoptgovResolvesPerProfileV2(1);
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      M.resolvingPoptgovResolveV2("r1");
      expect(() =>
        M.createPoptgovResolveV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPoptgovResolvesPerProfileV2(1);
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      M.resolvingPoptgovResolveV2("r1");
      M.completeResolvePoptgovV2("r1");
      expect(() =>
        M.createPoptgovResolveV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPoptgovResolveV2("nope")).toBeNull());
    it("list", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      M.createPoptgovResolveV2({ id: "r2", profileId: "p1" });
      expect(M.listPoptgovResolvesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPoptgovResolveV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPoptgovResolveV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPoptgovResolveV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setPoptgovProfileIdleMsV2(1000);
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
      const r = M.autoStaleIdlePoptgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPoptgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      M.resolvingPoptgovResolveV2("r1");
      M.setPoptgovResolveStuckMsV2(100);
      const r = M.autoFailStuckPoptgovResolvesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPoptgovProfileIdleMsV2(1000);
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdlePoptgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getProviderOptionsGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.resolvesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPoptgovProfileV2({ id: "p1", owner: "a" });
      M.activatePoptgovProfileV2("p1");
      M.createPoptgovResolveV2({ id: "r1", profileId: "p1" });
      const s2 = M.getProviderOptionsGovStatsV2();
      expect(s2.totalPoptgovProfilesV2).toBe(1);
      expect(s2.totalPoptgovResolvesV2).toBe(1);
    });
  });
});
