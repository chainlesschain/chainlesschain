import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/nostr-bridge.js";

describe("NostrBridge V2 Surface", () => {
  beforeEach(() => M._resetStateNostrBridgeGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.NOSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.NOSGOV_PUBLISH_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.NOSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.NOSGOV_PUBLISH_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveNosgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveNosgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingNosgovPublishsPerProfileV2(33);
      expect(M.getMaxPendingNosgovPublishsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setNosgovProfileIdleMsV2(60000);
      expect(M.getNosgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setNosgovPublishStuckMsV2(45000);
      expect(M.getNosgovPublishStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveNosgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setNosgovPublishStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveNosgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveNosgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerNosgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default relay", () =>
      expect(M.registerNosgovProfileV2({ id: "p1", owner: "a" }).relay).toBe(
        "wss://relay.local",
      ));
    it("activate", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateNosgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
      expect(M.suspendNosgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateNosgovProfileV2("p1");
      M.suspendNosgovProfileV2("p1");
      expect(M.activateNosgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
      expect(M.archiveNosgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
      M.archiveNosgovProfileV2("p1");
      expect(() => M.touchNosgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendNosgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerNosgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerNosgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getNosgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.registerNosgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listNosgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getNosgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getNosgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveNosgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerNosgovProfileV2({ id, owner: "a" }),
      );
      M.activateNosgovProfileV2("p1");
      M.activateNosgovProfileV2("p2");
      expect(() => M.activateNosgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveNosgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerNosgovProfileV2({ id, owner: "a" }),
      );
      M.activateNosgovProfileV2("p1");
      M.activateNosgovProfileV2("p2");
      M.suspendNosgovProfileV2("p1");
      M.activateNosgovProfileV2("p3");
      expect(() => M.activateNosgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveNosgovProfilesPerOwnerV2(1);
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.registerNosgovProfileV2({ id: "p2", owner: "b" });
      M.activateNosgovProfileV2("p1");
      expect(() => M.activateNosgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("publish lifecycle", () => {
    beforeEach(() => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
    });
    it("create→publishing→complete", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      M.publishingNosgovPublishV2("r1");
      const r = M.completePublishNosgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      M.publishingNosgovPublishV2("r1");
      expect(M.failNosgovPublishV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      expect(M.cancelNosgovPublishV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePublishNosgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createNosgovPublishV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingNosgovPublishsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createNosgovPublishV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createNosgovPublishV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("publishing counts as pending", () => {
      M.setMaxPendingNosgovPublishsPerProfileV2(1);
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      M.publishingNosgovPublishV2("r1");
      expect(() =>
        M.createNosgovPublishV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingNosgovPublishsPerProfileV2(1);
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      M.publishingNosgovPublishV2("r1");
      M.completePublishNosgovV2("r1");
      expect(() =>
        M.createNosgovPublishV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getNosgovPublishV2("nope")).toBeNull());
    it("list", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      M.createNosgovPublishV2({ id: "r2", profileId: "p1" });
      expect(M.listNosgovPublishsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createNosgovPublishV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createNosgovPublishV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      expect(M.cancelNosgovPublishV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setNosgovProfileIdleMsV2(1000);
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
      const r = M.autoSuspendIdleNosgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getNosgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      M.publishingNosgovPublishV2("r1");
      M.setNosgovPublishStuckMsV2(100);
      const r = M.autoFailStuckNosgovPublishsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setNosgovProfileIdleMsV2(1000);
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleNosgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getNostrBridgeGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.publishsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerNosgovProfileV2({ id: "p1", owner: "a" });
      M.activateNosgovProfileV2("p1");
      M.createNosgovPublishV2({ id: "r1", profileId: "p1" });
      const s2 = M.getNostrBridgeGovStatsV2();
      expect(s2.totalNosgovProfilesV2).toBe(1);
      expect(s2.totalNosgovPublishsV2).toBe(1);
    });
  });
});
