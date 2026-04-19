import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/interaction-adapter.js";

describe("InteractionAdapterGov V2 Surface", () => {
  beforeEach(() => M._resetStateInteractionAdapterGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.IAGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.IAGOV_TURN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.IAGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.IAGOV_TURN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveIagovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveIagovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingIagovTurnsPerProfileV2(33);
      expect(M.getMaxPendingIagovTurnsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setIagovProfileIdleMsV2(60000);
      expect(M.getIagovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setIagovTurnStuckMsV2(45000);
      expect(M.getIagovTurnStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveIagovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setIagovTurnStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveIagovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveIagovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerIagovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default adapter", () =>
      expect(M.registerIagovProfileV2({ id: "p1", owner: "a" }).adapter).toBe(
        "cli",
      ));
    it("activate", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateIagovProfileV2("p1").status).toBe("active");
    });
    it("idle", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
      expect(M.idleIagovProfileV2("p1").status).toBe("idle");
    });
    it("recovery preserves activatedAt", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateIagovProfileV2("p1");
      M.idleIagovProfileV2("p1");
      expect(M.activateIagovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
      expect(M.archiveIagovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
      M.archiveIagovProfileV2("p1");
      expect(() => M.touchIagovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.idleIagovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerIagovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerIagovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getIagovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.registerIagovProfileV2({ id: "p2", owner: "b" });
      expect(M.listIagovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getIagovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getIagovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveIagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerIagovProfileV2({ id, owner: "a" }),
      );
      M.activateIagovProfileV2("p1");
      M.activateIagovProfileV2("p2");
      expect(() => M.activateIagovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveIagovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerIagovProfileV2({ id, owner: "a" }),
      );
      M.activateIagovProfileV2("p1");
      M.activateIagovProfileV2("p2");
      M.idleIagovProfileV2("p1");
      M.activateIagovProfileV2("p3");
      expect(() => M.activateIagovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveIagovProfilesPerOwnerV2(1);
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.registerIagovProfileV2({ id: "p2", owner: "b" });
      M.activateIagovProfileV2("p1");
      expect(() => M.activateIagovProfileV2("p2")).not.toThrow();
    });
  });

  describe("turn lifecycle", () => {
    beforeEach(() => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
    });
    it("create→responding→complete", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      M.respondingIagovTurnV2("r1");
      const r = M.completeTurnIagovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      M.respondingIagovTurnV2("r1");
      expect(M.failIagovTurnV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      expect(M.cancelIagovTurnV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTurnIagovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createIagovTurnV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingIagovTurnsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createIagovTurnV2({ id, profileId: "p1" }),
      );
      expect(() => M.createIagovTurnV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("responding counts as pending", () => {
      M.setMaxPendingIagovTurnsPerProfileV2(1);
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      M.respondingIagovTurnV2("r1");
      expect(() =>
        M.createIagovTurnV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingIagovTurnsPerProfileV2(1);
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      M.respondingIagovTurnV2("r1");
      M.completeTurnIagovV2("r1");
      expect(() =>
        M.createIagovTurnV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getIagovTurnV2("nope")).toBeNull());
    it("list", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      M.createIagovTurnV2({ id: "r2", profileId: "p1" });
      expect(M.listIagovTurnsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createIagovTurnV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createIagovTurnV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      expect(M.cancelIagovTurnV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoIdleIdle", () => {
      M.setIagovProfileIdleMsV2(1000);
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
      const r = M.autoIdleIdleIagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getIagovProfileV2("p1").status).toBe("idle");
    });
    it("autoFailStuck", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      M.respondingIagovTurnV2("r1");
      M.setIagovTurnStuckMsV2(100);
      const r = M.autoFailStuckIagovTurnsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setIagovProfileIdleMsV2(1000);
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoIdleIdleIagovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getInteractionAdapterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.turnsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerIagovProfileV2({ id: "p1", owner: "a" });
      M.activateIagovProfileV2("p1");
      M.createIagovTurnV2({ id: "r1", profileId: "p1" });
      const s2 = M.getInteractionAdapterGovStatsV2();
      expect(s2.totalIagovProfilesV2).toBe(1);
      expect(s2.totalIagovTurnsV2).toBe(1);
    });
  });
});
