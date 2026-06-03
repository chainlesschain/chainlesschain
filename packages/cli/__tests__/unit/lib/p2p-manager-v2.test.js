import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/p2p-manager.js";

describe("P2pManager V2 Surface", () => {
  beforeEach(() => M._resetStateP2pManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.P2PGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.P2PGOV_GOSSIP_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.P2PGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.P2PGOV_GOSSIP_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveP2pgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveP2pgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingP2pgovGossipsPerProfileV2(33);
      expect(M.getMaxPendingP2pgovGossipsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setP2pgovProfileIdleMsV2(60000);
      expect(M.getP2pgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setP2pgovGossipStuckMsV2(45000);
      expect(M.getP2pgovGossipStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveP2pgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setP2pgovGossipStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveP2pgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveP2pgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerP2pgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default transport", () =>
      expect(
        M.registerP2pgovProfileV2({ id: "p1", owner: "a" }).transport,
      ).toBe("tcp"));
    it("activate", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateP2pgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
      expect(M.suspendP2pgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateP2pgovProfileV2("p1");
      M.suspendP2pgovProfileV2("p1");
      expect(M.activateP2pgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
      expect(M.archiveP2pgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
      M.archiveP2pgovProfileV2("p1");
      expect(() => M.touchP2pgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendP2pgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerP2pgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerP2pgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getP2pgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.registerP2pgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listP2pgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getP2pgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getP2pgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveP2pgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerP2pgovProfileV2({ id, owner: "a" }),
      );
      M.activateP2pgovProfileV2("p1");
      M.activateP2pgovProfileV2("p2");
      expect(() => M.activateP2pgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveP2pgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerP2pgovProfileV2({ id, owner: "a" }),
      );
      M.activateP2pgovProfileV2("p1");
      M.activateP2pgovProfileV2("p2");
      M.suspendP2pgovProfileV2("p1");
      M.activateP2pgovProfileV2("p3");
      expect(() => M.activateP2pgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveP2pgovProfilesPerOwnerV2(1);
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.registerP2pgovProfileV2({ id: "p2", owner: "b" });
      M.activateP2pgovProfileV2("p1");
      expect(() => M.activateP2pgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("gossip lifecycle", () => {
    beforeEach(() => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
    });
    it("create→broadcasting→complete", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      M.broadcastingP2pgovGossipV2("r1");
      const r = M.completeGossipP2pgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      M.broadcastingP2pgovGossipV2("r1");
      expect(M.failP2pgovGossipV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      expect(M.cancelP2pgovGossipV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeGossipP2pgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createP2pgovGossipV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingP2pgovGossipsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createP2pgovGossipV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createP2pgovGossipV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("broadcasting counts as pending", () => {
      M.setMaxPendingP2pgovGossipsPerProfileV2(1);
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      M.broadcastingP2pgovGossipV2("r1");
      expect(() =>
        M.createP2pgovGossipV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingP2pgovGossipsPerProfileV2(1);
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      M.broadcastingP2pgovGossipV2("r1");
      M.completeGossipP2pgovV2("r1");
      expect(() =>
        M.createP2pgovGossipV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getP2pgovGossipV2("nope")).toBeNull());
    it("list", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      M.createP2pgovGossipV2({ id: "r2", profileId: "p1" });
      expect(M.listP2pgovGossipsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createP2pgovGossipV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createP2pgovGossipV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      expect(M.cancelP2pgovGossipV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setP2pgovProfileIdleMsV2(1000);
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
      const r = M.autoSuspendIdleP2pgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getP2pgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      M.broadcastingP2pgovGossipV2("r1");
      M.setP2pgovGossipStuckMsV2(100);
      const r = M.autoFailStuckP2pgovGossipsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setP2pgovProfileIdleMsV2(1000);
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleP2pgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getP2pManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.gossipsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerP2pgovProfileV2({ id: "p1", owner: "a" });
      M.activateP2pgovProfileV2("p1");
      M.createP2pgovGossipV2({ id: "r1", profileId: "p1" });
      const s2 = M.getP2pManagerGovStatsV2();
      expect(s2.totalP2pgovProfilesV2).toBe(1);
      expect(s2.totalP2pgovGossipsV2).toBe(1);
    });
  });
});
