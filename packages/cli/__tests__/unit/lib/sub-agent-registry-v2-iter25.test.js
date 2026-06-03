import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sub-agent-registry.js";

describe("SubAgentRegistryGov V2 Surface", () => {
  beforeEach(() => M._resetStateSubAgentRegistryGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SAREGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SAREGOV_SPAWN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SAREGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SAREGOV_SPAWN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSaregovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSaregovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSaregovSpawnsPerProfileV2(33);
      expect(M.getMaxPendingSaregovSpawnsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSaregovProfileIdleMsV2(60000);
      expect(M.getSaregovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSaregovSpawnStuckMsV2(45000);
      expect(M.getSaregovSpawnStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSaregovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSaregovSpawnStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSaregovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSaregovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSaregovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default kind", () =>
      expect(M.registerSaregovProfileV2({ id: "p1", owner: "a" }).kind).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSaregovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
      expect(M.suspendSaregovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSaregovProfileV2("p1");
      M.suspendSaregovProfileV2("p1");
      expect(M.activateSaregovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
      expect(M.archiveSaregovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
      M.archiveSaregovProfileV2("p1");
      expect(() => M.touchSaregovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendSaregovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSaregovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSaregovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSaregovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.registerSaregovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSaregovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSaregovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSaregovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSaregovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSaregovProfileV2({ id, owner: "a" }),
      );
      M.activateSaregovProfileV2("p1");
      M.activateSaregovProfileV2("p2");
      expect(() => M.activateSaregovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSaregovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSaregovProfileV2({ id, owner: "a" }),
      );
      M.activateSaregovProfileV2("p1");
      M.activateSaregovProfileV2("p2");
      M.suspendSaregovProfileV2("p1");
      M.activateSaregovProfileV2("p3");
      expect(() => M.activateSaregovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSaregovProfilesPerOwnerV2(1);
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.registerSaregovProfileV2({ id: "p2", owner: "b" });
      M.activateSaregovProfileV2("p1");
      expect(() => M.activateSaregovProfileV2("p2")).not.toThrow();
    });
  });

  describe("spawn lifecycle", () => {
    beforeEach(() => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
    });
    it("create→spawning→complete", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      M.spawningSaregovSpawnV2("r1");
      const r = M.completeSpawnSaregovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      M.spawningSaregovSpawnV2("r1");
      expect(M.failSaregovSpawnV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSaregovSpawnV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSpawnSaregovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSaregovSpawnV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSaregovSpawnsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSaregovSpawnV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSaregovSpawnV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("spawning counts as pending", () => {
      M.setMaxPendingSaregovSpawnsPerProfileV2(1);
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      M.spawningSaregovSpawnV2("r1");
      expect(() =>
        M.createSaregovSpawnV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSaregovSpawnsPerProfileV2(1);
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      M.spawningSaregovSpawnV2("r1");
      M.completeSpawnSaregovV2("r1");
      expect(() =>
        M.createSaregovSpawnV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSaregovSpawnV2("nope")).toBeNull());
    it("list", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      M.createSaregovSpawnV2({ id: "r2", profileId: "p1" });
      expect(M.listSaregovSpawnsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSaregovSpawnV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSaregovSpawnV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSaregovSpawnV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setSaregovProfileIdleMsV2(1000);
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
      const r = M.autoSuspendIdleSaregovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSaregovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      M.spawningSaregovSpawnV2("r1");
      M.setSaregovSpawnStuckMsV2(100);
      const r = M.autoFailStuckSaregovSpawnsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSaregovProfileIdleMsV2(1000);
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleSaregovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSubAgentRegistryGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.spawnsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSaregovProfileV2({ id: "p1", owner: "a" });
      M.activateSaregovProfileV2("p1");
      M.createSaregovSpawnV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSubAgentRegistryGovStatsV2();
      expect(s2.totalSaregovProfilesV2).toBe(1);
      expect(s2.totalSaregovSpawnsV2).toBe(1);
    });
  });
});
