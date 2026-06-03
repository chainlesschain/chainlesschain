import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/activitypub-bridge.js";

describe("ActivityPubBridge V2 Surface", () => {
  beforeEach(() => M._resetStateActivityPubBridgeGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.APGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.APGOV_DELIVERY_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.APGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.APGOV_DELIVERY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveApgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveApgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingApgovDeliverysPerProfileV2(33);
      expect(M.getMaxPendingApgovDeliverysPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setApgovProfileIdleMsV2(60000);
      expect(M.getApgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setApgovDeliveryStuckMsV2(45000);
      expect(M.getApgovDeliveryStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveApgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setApgovDeliveryStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveApgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveApgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerApgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default actor", () =>
      expect(M.registerApgovProfileV2({ id: "p1", owner: "a" }).actor).toBe(
        "person",
      ));
    it("activate", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateApgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
      expect(M.suspendApgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateApgovProfileV2("p1");
      M.suspendApgovProfileV2("p1");
      expect(M.activateApgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
      expect(M.archiveApgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
      M.archiveApgovProfileV2("p1");
      expect(() => M.touchApgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendApgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerApgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerApgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getApgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.registerApgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listApgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getApgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getApgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveApgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerApgovProfileV2({ id, owner: "a" }),
      );
      M.activateApgovProfileV2("p1");
      M.activateApgovProfileV2("p2");
      expect(() => M.activateApgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveApgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerApgovProfileV2({ id, owner: "a" }),
      );
      M.activateApgovProfileV2("p1");
      M.activateApgovProfileV2("p2");
      M.suspendApgovProfileV2("p1");
      M.activateApgovProfileV2("p3");
      expect(() => M.activateApgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveApgovProfilesPerOwnerV2(1);
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.registerApgovProfileV2({ id: "p2", owner: "b" });
      M.activateApgovProfileV2("p1");
      expect(() => M.activateApgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("delivery lifecycle", () => {
    beforeEach(() => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
    });
    it("create→delivering→complete", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      M.deliveringApgovDeliveryV2("r1");
      const r = M.completeDeliveryApgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      M.deliveringApgovDeliveryV2("r1");
      expect(M.failApgovDeliveryV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      expect(M.cancelApgovDeliveryV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeDeliveryApgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createApgovDeliveryV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingApgovDeliverysPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createApgovDeliveryV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createApgovDeliveryV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("delivering counts as pending", () => {
      M.setMaxPendingApgovDeliverysPerProfileV2(1);
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      M.deliveringApgovDeliveryV2("r1");
      expect(() =>
        M.createApgovDeliveryV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingApgovDeliverysPerProfileV2(1);
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      M.deliveringApgovDeliveryV2("r1");
      M.completeDeliveryApgovV2("r1");
      expect(() =>
        M.createApgovDeliveryV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getApgovDeliveryV2("nope")).toBeNull());
    it("list", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      M.createApgovDeliveryV2({ id: "r2", profileId: "p1" });
      expect(M.listApgovDeliverysV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createApgovDeliveryV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createApgovDeliveryV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      expect(M.cancelApgovDeliveryV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setApgovProfileIdleMsV2(1000);
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
      const r = M.autoSuspendIdleApgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getApgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      M.deliveringApgovDeliveryV2("r1");
      M.setApgovDeliveryStuckMsV2(100);
      const r = M.autoFailStuckApgovDeliverysV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setApgovProfileIdleMsV2(1000);
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleApgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getActivityPubBridgeGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.deliverysByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerApgovProfileV2({ id: "p1", owner: "a" });
      M.activateApgovProfileV2("p1");
      M.createApgovDeliveryV2({ id: "r1", profileId: "p1" });
      const s2 = M.getActivityPubBridgeGovStatsV2();
      expect(s2.totalApgovProfilesV2).toBe(1);
      expect(s2.totalApgovDeliverysV2).toBe(1);
    });
  });
});
