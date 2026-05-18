import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evomap-federation.js";

describe("EvomapFederationGov V2 Surface", () => {
  beforeEach(() => M._resetStateEvomapFederationGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.EVFEDGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.EVFEDGOV_SYNC_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.EVFEDGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.EVFEDGOV_SYNC_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEvfedgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEvfedgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEvfedgovSyncsPerProfileV2(33);
      expect(M.getMaxPendingEvfedgovSyncsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEvfedgovProfileIdleMsV2(60000);
      expect(M.getEvfedgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEvfedgovSyncStuckMsV2(45000);
      expect(M.getEvfedgovSyncStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEvfedgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setEvfedgovSyncStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEvfedgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEvfedgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEvfedgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default hub", () =>
      expect(M.registerEvfedgovProfileV2({ id: "p1", owner: "a" }).hub).toBe(
        "primary",
      ));
    it("activate", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEvfedgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
      expect(M.staleEvfedgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEvfedgovProfileV2("p1");
      M.staleEvfedgovProfileV2("p1");
      expect(M.activateEvfedgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
      expect(M.archiveEvfedgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
      M.archiveEvfedgovProfileV2("p1");
      expect(() => M.touchEvfedgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleEvfedgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerEvfedgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEvfedgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEvfedgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.registerEvfedgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listEvfedgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEvfedgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEvfedgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEvfedgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEvfedgovProfileV2({ id, owner: "a" }),
      );
      M.activateEvfedgovProfileV2("p1");
      M.activateEvfedgovProfileV2("p2");
      expect(() => M.activateEvfedgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEvfedgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEvfedgovProfileV2({ id, owner: "a" }),
      );
      M.activateEvfedgovProfileV2("p1");
      M.activateEvfedgovProfileV2("p2");
      M.staleEvfedgovProfileV2("p1");
      M.activateEvfedgovProfileV2("p3");
      expect(() => M.activateEvfedgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEvfedgovProfilesPerOwnerV2(1);
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.registerEvfedgovProfileV2({ id: "p2", owner: "b" });
      M.activateEvfedgovProfileV2("p1");
      expect(() => M.activateEvfedgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("sync lifecycle", () => {
    beforeEach(() => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
    });
    it("create→syncing→complete", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingEvfedgovSyncV2("r1");
      const r = M.completeSyncEvfedgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingEvfedgovSyncV2("r1");
      expect(M.failEvfedgovSyncV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEvfedgovSyncV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSyncEvfedgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEvfedgovSyncV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEvfedgovSyncsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createEvfedgovSyncV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createEvfedgovSyncV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("syncing counts as pending", () => {
      M.setMaxPendingEvfedgovSyncsPerProfileV2(1);
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingEvfedgovSyncV2("r1");
      expect(() =>
        M.createEvfedgovSyncV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEvfedgovSyncsPerProfileV2(1);
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingEvfedgovSyncV2("r1");
      M.completeSyncEvfedgovV2("r1");
      expect(() =>
        M.createEvfedgovSyncV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEvfedgovSyncV2("nope")).toBeNull());
    it("list", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      M.createEvfedgovSyncV2({ id: "r2", profileId: "p1" });
      expect(M.listEvfedgovSyncsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEvfedgovSyncV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEvfedgovSyncV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setEvfedgovProfileIdleMsV2(1000);
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
      const r = M.autoStaleIdleEvfedgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEvfedgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingEvfedgovSyncV2("r1");
      M.setEvfedgovSyncStuckMsV2(100);
      const r = M.autoFailStuckEvfedgovSyncsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEvfedgovProfileIdleMsV2(1000);
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleEvfedgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getEvomapFederationGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.syncsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEvfedgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvfedgovProfileV2("p1");
      M.createEvfedgovSyncV2({ id: "r1", profileId: "p1" });
      const s2 = M.getEvomapFederationGovStatsV2();
      expect(s2.totalEvfedgovProfilesV2).toBe(1);
      expect(s2.totalEvfedgovSyncsV2).toBe(1);
    });
  });
});
