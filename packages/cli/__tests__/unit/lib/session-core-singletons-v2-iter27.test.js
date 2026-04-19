import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/session-core-singletons.js";

describe("SessionCoreSingletonsGov V2 Surface", () => {
  beforeEach(() => M._resetStateSessionCoreSingletonsGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SCSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SCSGOV_ACCESS_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SCSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SCSGOV_ACCESS_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveScsgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveScsgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingScsgovAccesssPerProfileV2(33);
      expect(M.getMaxPendingScsgovAccesssPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setScsgovProfileIdleMsV2(60000);
      expect(M.getScsgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setScsgovAccessStuckMsV2(45000);
      expect(M.getScsgovAccessStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveScsgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setScsgovAccessStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveScsgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveScsgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerScsgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default component", () =>
      expect(
        M.registerScsgovProfileV2({ id: "p1", owner: "a" }).component,
      ).toBe("default"));
    it("activate", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateScsgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
      expect(M.staleScsgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateScsgovProfileV2("p1");
      M.staleScsgovProfileV2("p1");
      expect(M.activateScsgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
      expect(M.archiveScsgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
      M.archiveScsgovProfileV2("p1");
      expect(() => M.touchScsgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleScsgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerScsgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerScsgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getScsgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.registerScsgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listScsgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getScsgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getScsgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveScsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerScsgovProfileV2({ id, owner: "a" }),
      );
      M.activateScsgovProfileV2("p1");
      M.activateScsgovProfileV2("p2");
      expect(() => M.activateScsgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveScsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerScsgovProfileV2({ id, owner: "a" }),
      );
      M.activateScsgovProfileV2("p1");
      M.activateScsgovProfileV2("p2");
      M.staleScsgovProfileV2("p1");
      M.activateScsgovProfileV2("p3");
      expect(() => M.activateScsgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveScsgovProfilesPerOwnerV2(1);
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.registerScsgovProfileV2({ id: "p2", owner: "b" });
      M.activateScsgovProfileV2("p1");
      expect(() => M.activateScsgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("access lifecycle", () => {
    beforeEach(() => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
    });
    it("create→resolving→complete", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      M.resolvingScsgovAccessV2("r1");
      const r = M.completeAccessScsgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      M.resolvingScsgovAccessV2("r1");
      expect(M.failScsgovAccessV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      expect(M.cancelScsgovAccessV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeAccessScsgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createScsgovAccessV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingScsgovAccesssPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createScsgovAccessV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createScsgovAccessV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("resolving counts as pending", () => {
      M.setMaxPendingScsgovAccesssPerProfileV2(1);
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      M.resolvingScsgovAccessV2("r1");
      expect(() =>
        M.createScsgovAccessV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingScsgovAccesssPerProfileV2(1);
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      M.resolvingScsgovAccessV2("r1");
      M.completeAccessScsgovV2("r1");
      expect(() =>
        M.createScsgovAccessV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getScsgovAccessV2("nope")).toBeNull());
    it("list", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      M.createScsgovAccessV2({ id: "r2", profileId: "p1" });
      expect(M.listScsgovAccesssV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createScsgovAccessV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createScsgovAccessV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      expect(M.cancelScsgovAccessV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setScsgovProfileIdleMsV2(1000);
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
      const r = M.autoStaleIdleScsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getScsgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      M.resolvingScsgovAccessV2("r1");
      M.setScsgovAccessStuckMsV2(100);
      const r = M.autoFailStuckScsgovAccesssV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setScsgovProfileIdleMsV2(1000);
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleScsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSessionCoreSingletonsGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.accesssByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerScsgovProfileV2({ id: "p1", owner: "a" });
      M.activateScsgovProfileV2("p1");
      M.createScsgovAccessV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSessionCoreSingletonsGovStatsV2();
      expect(s2.totalScsgovProfilesV2).toBe(1);
      expect(s2.totalScsgovAccesssV2).toBe(1);
    });
  });
});
