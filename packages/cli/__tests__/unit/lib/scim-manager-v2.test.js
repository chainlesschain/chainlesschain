import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/scim-manager.js";

describe("ScimManager V2 Surface", () => {
  beforeEach(() => M._resetStateScimManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SCIMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SCIMGOV_SYNC_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SCIMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SCIMGOV_SYNC_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveScimgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveScimgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingScimgovSyncsPerProfileV2(33);
      expect(M.getMaxPendingScimgovSyncsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setScimgovProfileIdleMsV2(60000);
      expect(M.getScimgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setScimgovSyncStuckMsV2(45000);
      expect(M.getScimgovSyncStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveScimgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setScimgovSyncStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveScimgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveScimgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerScimgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default resource", () =>
      expect(
        M.registerScimgovProfileV2({ id: "p1", owner: "a" }).resource,
      ).toBe("users"));
    it("activate", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateScimgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
      expect(M.staleScimgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateScimgovProfileV2("p1");
      M.staleScimgovProfileV2("p1");
      expect(M.activateScimgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
      expect(M.archiveScimgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
      M.archiveScimgovProfileV2("p1");
      expect(() => M.touchScimgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleScimgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerScimgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerScimgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getScimgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.registerScimgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listScimgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getScimgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getScimgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveScimgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerScimgovProfileV2({ id, owner: "a" }),
      );
      M.activateScimgovProfileV2("p1");
      M.activateScimgovProfileV2("p2");
      expect(() => M.activateScimgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveScimgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerScimgovProfileV2({ id, owner: "a" }),
      );
      M.activateScimgovProfileV2("p1");
      M.activateScimgovProfileV2("p2");
      M.staleScimgovProfileV2("p1");
      M.activateScimgovProfileV2("p3");
      expect(() => M.activateScimgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveScimgovProfilesPerOwnerV2(1);
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.registerScimgovProfileV2({ id: "p2", owner: "b" });
      M.activateScimgovProfileV2("p1");
      expect(() => M.activateScimgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("sync lifecycle", () => {
    beforeEach(() => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
    });
    it("create→syncing→complete", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingScimgovSyncV2("r1");
      const r = M.completeSyncScimgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingScimgovSyncV2("r1");
      expect(M.failScimgovSyncV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      expect(M.cancelScimgovSyncV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSyncScimgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createScimgovSyncV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingScimgovSyncsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createScimgovSyncV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createScimgovSyncV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("syncing counts as pending", () => {
      M.setMaxPendingScimgovSyncsPerProfileV2(1);
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingScimgovSyncV2("r1");
      expect(() =>
        M.createScimgovSyncV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingScimgovSyncsPerProfileV2(1);
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingScimgovSyncV2("r1");
      M.completeSyncScimgovV2("r1");
      expect(() =>
        M.createScimgovSyncV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getScimgovSyncV2("nope")).toBeNull());
    it("list", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      M.createScimgovSyncV2({ id: "r2", profileId: "p1" });
      expect(M.listScimgovSyncsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createScimgovSyncV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createScimgovSyncV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      expect(M.cancelScimgovSyncV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setScimgovProfileIdleMsV2(1000);
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
      const r = M.autoStaleIdleScimgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getScimgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      M.syncingScimgovSyncV2("r1");
      M.setScimgovSyncStuckMsV2(100);
      const r = M.autoFailStuckScimgovSyncsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setScimgovProfileIdleMsV2(1000);
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleScimgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getScimManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.syncsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerScimgovProfileV2({ id: "p1", owner: "a" });
      M.activateScimgovProfileV2("p1");
      M.createScimgovSyncV2({ id: "r1", profileId: "p1" });
      const s2 = M.getScimManagerGovStatsV2();
      expect(s2.totalScimgovProfilesV2).toBe(1);
      expect(s2.totalScimgovSyncsV2).toBe(1);
    });
  });
});
