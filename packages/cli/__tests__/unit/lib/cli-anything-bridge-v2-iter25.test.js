import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cli-anything-bridge.js";

describe("CliAnythingBridgeGov V2 Surface", () => {
  beforeEach(() => M._resetStateCliAnythingBridgeGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CLIBGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CLIBGOV_BRIDGE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CLIBGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CLIBGOV_BRIDGE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveClibgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveClibgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingClibgovBridgesPerProfileV2(33);
      expect(M.getMaxPendingClibgovBridgesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setClibgovProfileIdleMsV2(60000);
      expect(M.getClibgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setClibgovBridgeStuckMsV2(45000);
      expect(M.getClibgovBridgeStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveClibgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setClibgovBridgeStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveClibgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveClibgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerClibgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default tool", () =>
      expect(M.registerClibgovProfileV2({ id: "p1", owner: "a" }).tool).toBe(
        "generic",
      ));
    it("activate", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateClibgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
      expect(M.degradeClibgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateClibgovProfileV2("p1");
      M.degradeClibgovProfileV2("p1");
      expect(M.activateClibgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
      expect(M.archiveClibgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
      M.archiveClibgovProfileV2("p1");
      expect(() => M.touchClibgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeClibgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerClibgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerClibgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getClibgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.registerClibgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listClibgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getClibgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getClibgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveClibgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerClibgovProfileV2({ id, owner: "a" }),
      );
      M.activateClibgovProfileV2("p1");
      M.activateClibgovProfileV2("p2");
      expect(() => M.activateClibgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveClibgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerClibgovProfileV2({ id, owner: "a" }),
      );
      M.activateClibgovProfileV2("p1");
      M.activateClibgovProfileV2("p2");
      M.degradeClibgovProfileV2("p1");
      M.activateClibgovProfileV2("p3");
      expect(() => M.activateClibgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveClibgovProfilesPerOwnerV2(1);
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.registerClibgovProfileV2({ id: "p2", owner: "b" });
      M.activateClibgovProfileV2("p1");
      expect(() => M.activateClibgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("bridge lifecycle", () => {
    beforeEach(() => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
    });
    it("create→bridging→complete", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      M.bridgingClibgovBridgeV2("r1");
      const r = M.completeBridgeClibgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      M.bridgingClibgovBridgeV2("r1");
      expect(M.failClibgovBridgeV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      expect(M.cancelClibgovBridgeV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeBridgeClibgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createClibgovBridgeV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingClibgovBridgesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createClibgovBridgeV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createClibgovBridgeV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("bridging counts as pending", () => {
      M.setMaxPendingClibgovBridgesPerProfileV2(1);
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      M.bridgingClibgovBridgeV2("r1");
      expect(() =>
        M.createClibgovBridgeV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingClibgovBridgesPerProfileV2(1);
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      M.bridgingClibgovBridgeV2("r1");
      M.completeBridgeClibgovV2("r1");
      expect(() =>
        M.createClibgovBridgeV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getClibgovBridgeV2("nope")).toBeNull());
    it("list", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      M.createClibgovBridgeV2({ id: "r2", profileId: "p1" });
      expect(M.listClibgovBridgesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createClibgovBridgeV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createClibgovBridgeV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      expect(M.cancelClibgovBridgeV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setClibgovProfileIdleMsV2(1000);
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
      const r = M.autoDegradeIdleClibgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getClibgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      M.bridgingClibgovBridgeV2("r1");
      M.setClibgovBridgeStuckMsV2(100);
      const r = M.autoFailStuckClibgovBridgesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setClibgovProfileIdleMsV2(1000);
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleClibgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCliAnythingBridgeGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.bridgesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerClibgovProfileV2({ id: "p1", owner: "a" });
      M.activateClibgovProfileV2("p1");
      M.createClibgovBridgeV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCliAnythingBridgeGovStatsV2();
      expect(s2.totalClibgovProfilesV2).toBe(1);
      expect(s2.totalClibgovBridgesV2).toBe(1);
    });
  });
});
