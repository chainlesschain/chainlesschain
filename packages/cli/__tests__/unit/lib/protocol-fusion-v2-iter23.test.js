import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/protocol-fusion.js";

describe("ProtocolFusionGov V2 Surface", () => {
  beforeEach(() => M._resetStateProtocolFusionGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PFGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PFGOV_ROUTE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PFGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PFGOV_ROUTE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePfgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePfgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPfgovRoutesPerProfileV2(33);
      expect(M.getMaxPendingPfgovRoutesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPfgovProfileIdleMsV2(60000);
      expect(M.getPfgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPfgovRouteStuckMsV2(45000);
      expect(M.getPfgovRouteStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePfgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPfgovRouteStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePfgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePfgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPfgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default protocol", () =>
      expect(M.registerPfgovProfileV2({ id: "p1", owner: "a" }).protocol).toBe(
        "hybrid",
      ));
    it("activate", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePfgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
      expect(M.degradePfgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePfgovProfileV2("p1");
      M.degradePfgovProfileV2("p1");
      expect(M.activatePfgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
      expect(M.archivePfgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
      M.archivePfgovProfileV2("p1");
      expect(() => M.touchPfgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradePfgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPfgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPfgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPfgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.registerPfgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPfgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPfgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPfgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePfgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPfgovProfileV2({ id, owner: "a" }),
      );
      M.activatePfgovProfileV2("p1");
      M.activatePfgovProfileV2("p2");
      expect(() => M.activatePfgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePfgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPfgovProfileV2({ id, owner: "a" }),
      );
      M.activatePfgovProfileV2("p1");
      M.activatePfgovProfileV2("p2");
      M.degradePfgovProfileV2("p1");
      M.activatePfgovProfileV2("p3");
      expect(() => M.activatePfgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePfgovProfilesPerOwnerV2(1);
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.registerPfgovProfileV2({ id: "p2", owner: "b" });
      M.activatePfgovProfileV2("p1");
      expect(() => M.activatePfgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("route lifecycle", () => {
    beforeEach(() => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
    });
    it("create→routing→complete", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      M.routingPfgovRouteV2("r1");
      const r = M.completeRoutePfgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      M.routingPfgovRouteV2("r1");
      expect(M.failPfgovRouteV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPfgovRouteV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRoutePfgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPfgovRouteV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPfgovRoutesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPfgovRouteV2({ id, profileId: "p1" }),
      );
      expect(() => M.createPfgovRouteV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("routing counts as pending", () => {
      M.setMaxPendingPfgovRoutesPerProfileV2(1);
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      M.routingPfgovRouteV2("r1");
      expect(() =>
        M.createPfgovRouteV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPfgovRoutesPerProfileV2(1);
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      M.routingPfgovRouteV2("r1");
      M.completeRoutePfgovV2("r1");
      expect(() =>
        M.createPfgovRouteV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPfgovRouteV2("nope")).toBeNull());
    it("list", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      M.createPfgovRouteV2({ id: "r2", profileId: "p1" });
      expect(M.listPfgovRoutesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPfgovRouteV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPfgovRouteV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPfgovRouteV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setPfgovProfileIdleMsV2(1000);
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
      const r = M.autoDegradeIdlePfgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPfgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      M.routingPfgovRouteV2("r1");
      M.setPfgovRouteStuckMsV2(100);
      const r = M.autoFailStuckPfgovRoutesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPfgovProfileIdleMsV2(1000);
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdlePfgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getProtocolFusionGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.routesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPfgovProfileV2({ id: "p1", owner: "a" });
      M.activatePfgovProfileV2("p1");
      M.createPfgovRouteV2({ id: "r1", profileId: "p1" });
      const s2 = M.getProtocolFusionGovStatsV2();
      expect(s2.totalPfgovProfilesV2).toBe(1);
      expect(s2.totalPfgovRoutesV2).toBe(1);
    });
  });
});
