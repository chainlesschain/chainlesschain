import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-share.js";

describe("CoworkShare V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkShareGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SHGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SHGOV_SHARE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SHGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SHGOV_SHARE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveShgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveShgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingShgovSharesPerProfileV2(33);
      expect(M.getMaxPendingShgovSharesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setShgovProfileIdleMsV2(60000);
      expect(M.getShgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setShgovShareStuckMsV2(45000);
      expect(M.getShgovShareStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveShgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setShgovShareStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveShgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveShgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerShgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default visibility", () =>
      expect(
        M.registerShgovProfileV2({ id: "p1", owner: "a" }).visibility,
      ).toBe("private"));
    it("activate", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateShgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
      expect(M.pauseShgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateShgovProfileV2("p1");
      M.pauseShgovProfileV2("p1");
      expect(M.activateShgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
      expect(M.archiveShgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
      M.archiveShgovProfileV2("p1");
      expect(() => M.touchShgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseShgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerShgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerShgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getShgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.registerShgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listShgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getShgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getShgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveShgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerShgovProfileV2({ id, owner: "a" }),
      );
      M.activateShgovProfileV2("p1");
      M.activateShgovProfileV2("p2");
      expect(() => M.activateShgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveShgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerShgovProfileV2({ id, owner: "a" }),
      );
      M.activateShgovProfileV2("p1");
      M.activateShgovProfileV2("p2");
      M.pauseShgovProfileV2("p1");
      M.activateShgovProfileV2("p3");
      expect(() => M.activateShgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveShgovProfilesPerOwnerV2(1);
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.registerShgovProfileV2({ id: "p2", owner: "b" });
      M.activateShgovProfileV2("p1");
      expect(() => M.activateShgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("share lifecycle", () => {
    beforeEach(() => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
    });
    it("create→sharing→complete", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      M.sharingShgovShareV2("r1");
      const r = M.completeShareShgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      M.sharingShgovShareV2("r1");
      expect(M.failShgovShareV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      expect(M.cancelShgovShareV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeShareShgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createShgovShareV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingShgovSharesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createShgovShareV2({ id, profileId: "p1" }),
      );
      expect(() => M.createShgovShareV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("sharing counts as pending", () => {
      M.setMaxPendingShgovSharesPerProfileV2(1);
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      M.sharingShgovShareV2("r1");
      expect(() =>
        M.createShgovShareV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingShgovSharesPerProfileV2(1);
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      M.sharingShgovShareV2("r1");
      M.completeShareShgovV2("r1");
      expect(() =>
        M.createShgovShareV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getShgovShareV2("nope")).toBeNull());
    it("list", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      M.createShgovShareV2({ id: "r2", profileId: "p1" });
      expect(M.listShgovSharesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createShgovShareV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createShgovShareV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      expect(M.cancelShgovShareV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setShgovProfileIdleMsV2(1000);
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
      const r = M.autoPauseIdleShgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getShgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      M.sharingShgovShareV2("r1");
      M.setShgovShareStuckMsV2(100);
      const r = M.autoFailStuckShgovSharesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setShgovProfileIdleMsV2(1000);
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleShgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkShareGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.sharesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerShgovProfileV2({ id: "p1", owner: "a" });
      M.activateShgovProfileV2("p1");
      M.createShgovShareV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkShareGovStatsV2();
      expect(s2.totalShgovProfilesV2).toBe(1);
      expect(s2.totalShgovSharesV2).toBe(1);
    });
  });
});
