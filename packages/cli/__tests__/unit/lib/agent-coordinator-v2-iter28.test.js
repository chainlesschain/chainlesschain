import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/agent-coordinator.js";

describe("Acrdgov V2 Surface", () => {
  beforeEach(() => M._resetStateAcrdgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.ACRDGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.ACRDGOV_COORD_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.ACRDGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ACRDGOV_COORD_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAcrdProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAcrdProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAcrdCoordsPerProfileV2(33);
      expect(M.getMaxPendingAcrdCoordsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAcrdProfileIdleMsV2(60000);
      expect(M.getAcrdProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAcrdCoordStuckMsV2(45000);
      expect(M.getAcrdCoordStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAcrdProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAcrdCoordStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAcrdProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAcrdProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAcrdProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default role", () =>
      expect(M.registerAcrdProfileV2({ id: "p1", owner: "a" }).role).toBe(
        "leader",
      ));
    it("activate", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAcrdProfileV2("p1").status).toBe("active");
    });
    it("idle", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
      expect(M.idleAcrdProfileV2("p1").status).toBe("idle");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAcrdProfileV2("p1");
      M.idleAcrdProfileV2("p1");
      expect(M.activateAcrdProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
      expect(M.archiveAcrdProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
      M.archiveAcrdProfileV2("p1");
      expect(() => M.touchAcrdProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      expect(() => M.idleAcrdProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerAcrdProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAcrdProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAcrdProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.registerAcrdProfileV2({ id: "p2", owner: "b" });
      expect(M.listAcrdProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAcrdProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAcrdProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAcrdProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAcrdProfileV2({ id, owner: "a" }),
      );
      M.activateAcrdProfileV2("p1");
      M.activateAcrdProfileV2("p2");
      expect(() => M.activateAcrdProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAcrdProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAcrdProfileV2({ id, owner: "a" }),
      );
      M.activateAcrdProfileV2("p1");
      M.activateAcrdProfileV2("p2");
      M.idleAcrdProfileV2("p1");
      M.activateAcrdProfileV2("p3");
      expect(() => M.activateAcrdProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAcrdProfilesPerOwnerV2(1);
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.registerAcrdProfileV2({ id: "p2", owner: "b" });
      M.activateAcrdProfileV2("p1");
      expect(() => M.activateAcrdProfileV2("p2")).not.toThrow();
    });
  });

  describe("coord lifecycle", () => {
    beforeEach(() => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
    });
    it("create→coordinating→complete", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      M.coordinatingAcrdCoordV2("r1");
      const r = M.completeCoordAcrdV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      M.coordinatingAcrdCoordV2("r1");
      expect(M.failAcrdCoordV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAcrdCoordV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCoordAcrdV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAcrdCoordV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAcrdCoordsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createAcrdCoordV2({ id, profileId: "p1" }),
      );
      expect(() => M.createAcrdCoordV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("coordinating counts as pending", () => {
      M.setMaxPendingAcrdCoordsPerProfileV2(1);
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      M.coordinatingAcrdCoordV2("r1");
      expect(() =>
        M.createAcrdCoordV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAcrdCoordsPerProfileV2(1);
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      M.coordinatingAcrdCoordV2("r1");
      M.completeCoordAcrdV2("r1");
      expect(() =>
        M.createAcrdCoordV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAcrdCoordV2("nope")).toBeNull());
    it("list", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      M.createAcrdCoordV2({ id: "r2", profileId: "p1" });
      expect(M.listAcrdCoordsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAcrdCoordV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createAcrdCoordV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAcrdCoordV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoIdleIdle", () => {
      M.setAcrdProfileIdleMsV2(1000);
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
      const r = M.autoIdleIdleAcrdProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAcrdProfileV2("p1").status).toBe("idle");
    });
    it("autoFailStuck", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      M.coordinatingAcrdCoordV2("r1");
      M.setAcrdCoordStuckMsV2(100);
      const r = M.autoFailStuckAcrdCoordsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAcrdProfileIdleMsV2(1000);
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      const r = M.autoIdleIdleAcrdProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAcrdgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.coordsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAcrdProfileV2({ id: "p1", owner: "a" });
      M.activateAcrdProfileV2("p1");
      M.createAcrdCoordV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAcrdgovStatsV2();
      expect(s2.totalAcrdProfilesV2).toBe(1);
      expect(s2.totalAcrdCoordsV2).toBe(1);
    });
  });
});
