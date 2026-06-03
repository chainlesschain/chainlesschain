import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/session-manager.js";

describe("SessionManager V2 Surface", () => {
  beforeEach(() => M._resetStateSessionManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SESGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SESGOV_TURN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SESGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SESGOV_TURN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSesgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSesgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSesgovTurnsPerProfileV2(33);
      expect(M.getMaxPendingSesgovTurnsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSesgovProfileIdleMsV2(60000);
      expect(M.getSesgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSesgovTurnStuckMsV2(45000);
      expect(M.getSesgovTurnStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSesgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSesgovTurnStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSesgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSesgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSesgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default channel", () =>
      expect(M.registerSesgovProfileV2({ id: "p1", owner: "a" }).channel).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSesgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
      expect(M.pauseSesgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSesgovProfileV2("p1");
      M.pauseSesgovProfileV2("p1");
      expect(M.activateSesgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
      expect(M.archiveSesgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
      M.archiveSesgovProfileV2("p1");
      expect(() => M.touchSesgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseSesgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSesgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSesgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSesgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.registerSesgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSesgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSesgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSesgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSesgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSesgovProfileV2({ id, owner: "a" }),
      );
      M.activateSesgovProfileV2("p1");
      M.activateSesgovProfileV2("p2");
      expect(() => M.activateSesgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSesgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSesgovProfileV2({ id, owner: "a" }),
      );
      M.activateSesgovProfileV2("p1");
      M.activateSesgovProfileV2("p2");
      M.pauseSesgovProfileV2("p1");
      M.activateSesgovProfileV2("p3");
      expect(() => M.activateSesgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSesgovProfilesPerOwnerV2(1);
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.registerSesgovProfileV2({ id: "p2", owner: "b" });
      M.activateSesgovProfileV2("p1");
      expect(() => M.activateSesgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("turn lifecycle", () => {
    beforeEach(() => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
    });
    it("create→advancing→complete", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      M.advancingSesgovTurnV2("r1");
      const r = M.completeTurnSesgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      M.advancingSesgovTurnV2("r1");
      expect(M.failSesgovTurnV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSesgovTurnV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTurnSesgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSesgovTurnV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSesgovTurnsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSesgovTurnV2({ id, profileId: "p1" }),
      );
      expect(() => M.createSesgovTurnV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("advancing counts as pending", () => {
      M.setMaxPendingSesgovTurnsPerProfileV2(1);
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      M.advancingSesgovTurnV2("r1");
      expect(() =>
        M.createSesgovTurnV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSesgovTurnsPerProfileV2(1);
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      M.advancingSesgovTurnV2("r1");
      M.completeTurnSesgovV2("r1");
      expect(() =>
        M.createSesgovTurnV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSesgovTurnV2("nope")).toBeNull());
    it("list", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      M.createSesgovTurnV2({ id: "r2", profileId: "p1" });
      expect(M.listSesgovTurnsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSesgovTurnV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSesgovTurnV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSesgovTurnV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setSesgovProfileIdleMsV2(1000);
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
      const r = M.autoPauseIdleSesgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSesgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      M.advancingSesgovTurnV2("r1");
      M.setSesgovTurnStuckMsV2(100);
      const r = M.autoFailStuckSesgovTurnsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSesgovProfileIdleMsV2(1000);
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleSesgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSessionManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.turnsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSesgovProfileV2({ id: "p1", owner: "a" });
      M.activateSesgovProfileV2("p1");
      M.createSesgovTurnV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSessionManagerGovStatsV2();
      expect(s2.totalSesgovProfilesV2).toBe(1);
      expect(s2.totalSesgovTurnsV2).toBe(1);
    });
  });
});
