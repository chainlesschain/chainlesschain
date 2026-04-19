import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/org-manager.js";

describe("OrgManager V2 Surface", () => {
  beforeEach(() => M._resetStateOrgManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.ORGGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.ORGGOV_INVITE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.ORGGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ORGGOV_INVITE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveOrggovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveOrggovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingOrggovInvitesPerProfileV2(33);
      expect(M.getMaxPendingOrggovInvitesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setOrggovProfileIdleMsV2(60000);
      expect(M.getOrggovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setOrggovInviteStuckMsV2(45000);
      expect(M.getOrggovInviteStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveOrggovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setOrggovInviteStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveOrggovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveOrggovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerOrggovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default tier", () =>
      expect(M.registerOrggovProfileV2({ id: "p1", owner: "a" }).tier).toBe(
        "standard",
      ));
    it("activate", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateOrggovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
      expect(M.pauseOrggovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateOrggovProfileV2("p1");
      M.pauseOrggovProfileV2("p1");
      expect(M.activateOrggovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
      expect(M.archiveOrggovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
      M.archiveOrggovProfileV2("p1");
      expect(() => M.touchOrggovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseOrggovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerOrggovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerOrggovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getOrggovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.registerOrggovProfileV2({ id: "p2", owner: "b" });
      expect(M.listOrggovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getOrggovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getOrggovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveOrggovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerOrggovProfileV2({ id, owner: "a" }),
      );
      M.activateOrggovProfileV2("p1");
      M.activateOrggovProfileV2("p2");
      expect(() => M.activateOrggovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveOrggovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerOrggovProfileV2({ id, owner: "a" }),
      );
      M.activateOrggovProfileV2("p1");
      M.activateOrggovProfileV2("p2");
      M.pauseOrggovProfileV2("p1");
      M.activateOrggovProfileV2("p3");
      expect(() => M.activateOrggovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveOrggovProfilesPerOwnerV2(1);
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.registerOrggovProfileV2({ id: "p2", owner: "b" });
      M.activateOrggovProfileV2("p1");
      expect(() => M.activateOrggovProfileV2("p2")).not.toThrow();
    });
  });

  describe("invite lifecycle", () => {
    beforeEach(() => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
    });
    it("create→inviting→complete", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      M.invitingOrggovInviteV2("r1");
      const r = M.completeInviteOrggovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      M.invitingOrggovInviteV2("r1");
      expect(M.failOrggovInviteV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      expect(M.cancelOrggovInviteV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeInviteOrggovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createOrggovInviteV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingOrggovInvitesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createOrggovInviteV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createOrggovInviteV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("inviting counts as pending", () => {
      M.setMaxPendingOrggovInvitesPerProfileV2(1);
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      M.invitingOrggovInviteV2("r1");
      expect(() =>
        M.createOrggovInviteV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingOrggovInvitesPerProfileV2(1);
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      M.invitingOrggovInviteV2("r1");
      M.completeInviteOrggovV2("r1");
      expect(() =>
        M.createOrggovInviteV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getOrggovInviteV2("nope")).toBeNull());
    it("list", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      M.createOrggovInviteV2({ id: "r2", profileId: "p1" });
      expect(M.listOrggovInvitesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createOrggovInviteV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createOrggovInviteV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      expect(M.cancelOrggovInviteV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setOrggovProfileIdleMsV2(1000);
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
      const r = M.autoPauseIdleOrggovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getOrggovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      M.invitingOrggovInviteV2("r1");
      M.setOrggovInviteStuckMsV2(100);
      const r = M.autoFailStuckOrggovInvitesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setOrggovProfileIdleMsV2(1000);
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleOrggovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getOrgManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.invitesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerOrggovProfileV2({ id: "p1", owner: "a" });
      M.activateOrggovProfileV2("p1");
      M.createOrggovInviteV2({ id: "r1", profileId: "p1" });
      const s2 = M.getOrgManagerGovStatsV2();
      expect(s2.totalOrggovProfilesV2).toBe(1);
      expect(s2.totalOrggovInvitesV2).toBe(1);
    });
  });
});
