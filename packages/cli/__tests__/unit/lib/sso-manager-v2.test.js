import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sso-manager.js";

describe("SsoManager V2 Surface", () => {
  beforeEach(() => M._resetStateSsoManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SSOGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SSOGOV_LOGIN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SSOGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SSOGOV_LOGIN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSsogovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSsogovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSsogovLoginsPerProfileV2(33);
      expect(M.getMaxPendingSsogovLoginsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSsogovProfileIdleMsV2(60000);
      expect(M.getSsogovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSsogovLoginStuckMsV2(45000);
      expect(M.getSsogovLoginStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSsogovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSsogovLoginStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSsogovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSsogovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSsogovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default protocol", () =>
      expect(M.registerSsogovProfileV2({ id: "p1", owner: "a" }).protocol).toBe(
        "oidc",
      ));
    it("activate", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSsogovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
      expect(M.suspendSsogovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSsogovProfileV2("p1");
      M.suspendSsogovProfileV2("p1");
      expect(M.activateSsogovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
      expect(M.archiveSsogovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
      M.archiveSsogovProfileV2("p1");
      expect(() => M.touchSsogovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendSsogovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSsogovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSsogovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSsogovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.registerSsogovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSsogovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSsogovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSsogovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSsogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSsogovProfileV2({ id, owner: "a" }),
      );
      M.activateSsogovProfileV2("p1");
      M.activateSsogovProfileV2("p2");
      expect(() => M.activateSsogovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSsogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSsogovProfileV2({ id, owner: "a" }),
      );
      M.activateSsogovProfileV2("p1");
      M.activateSsogovProfileV2("p2");
      M.suspendSsogovProfileV2("p1");
      M.activateSsogovProfileV2("p3");
      expect(() => M.activateSsogovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSsogovProfilesPerOwnerV2(1);
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.registerSsogovProfileV2({ id: "p2", owner: "b" });
      M.activateSsogovProfileV2("p1");
      expect(() => M.activateSsogovProfileV2("p2")).not.toThrow();
    });
  });

  describe("login lifecycle", () => {
    beforeEach(() => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
    });
    it("create→authenticating→complete", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      M.authenticatingSsogovLoginV2("r1");
      const r = M.completeLoginSsogovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      M.authenticatingSsogovLoginV2("r1");
      expect(M.failSsogovLoginV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSsogovLoginV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeLoginSsogovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSsogovLoginV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSsogovLoginsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSsogovLoginV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSsogovLoginV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("authenticating counts as pending", () => {
      M.setMaxPendingSsogovLoginsPerProfileV2(1);
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      M.authenticatingSsogovLoginV2("r1");
      expect(() =>
        M.createSsogovLoginV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSsogovLoginsPerProfileV2(1);
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      M.authenticatingSsogovLoginV2("r1");
      M.completeLoginSsogovV2("r1");
      expect(() =>
        M.createSsogovLoginV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSsogovLoginV2("nope")).toBeNull());
    it("list", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      M.createSsogovLoginV2({ id: "r2", profileId: "p1" });
      expect(M.listSsogovLoginsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSsogovLoginV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSsogovLoginV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSsogovLoginV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setSsogovProfileIdleMsV2(1000);
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
      const r = M.autoSuspendIdleSsogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSsogovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      M.authenticatingSsogovLoginV2("r1");
      M.setSsogovLoginStuckMsV2(100);
      const r = M.autoFailStuckSsogovLoginsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSsogovProfileIdleMsV2(1000);
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleSsogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSsoManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.loginsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSsogovProfileV2({ id: "p1", owner: "a" });
      M.activateSsogovProfileV2("p1");
      M.createSsogovLoginV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSsoManagerGovStatsV2();
      expect(s2.totalSsogovProfilesV2).toBe(1);
      expect(s2.totalSsogovLoginsV2).toBe(1);
    });
  });
});
