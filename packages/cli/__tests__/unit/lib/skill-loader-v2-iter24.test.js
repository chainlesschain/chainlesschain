import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/skill-loader.js";

describe("SkillLoaderGov V2 Surface", () => {
  beforeEach(() => M._resetStateSkillLoaderGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SKLGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SKLGOV_LOAD_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SKLGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SKLGOV_LOAD_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSklgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSklgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSklgovLoadsPerProfileV2(33);
      expect(M.getMaxPendingSklgovLoadsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSklgovProfileIdleMsV2(60000);
      expect(M.getSklgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSklgovLoadStuckMsV2(45000);
      expect(M.getSklgovLoadStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSklgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSklgovLoadStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSklgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSklgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSklgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default source", () =>
      expect(M.registerSklgovProfileV2({ id: "p1", owner: "a" }).source).toBe(
        "local",
      ));
    it("activate", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSklgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
      expect(M.staleSklgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSklgovProfileV2("p1");
      M.staleSklgovProfileV2("p1");
      expect(M.activateSklgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
      expect(M.archiveSklgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
      M.archiveSklgovProfileV2("p1");
      expect(() => M.touchSklgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleSklgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSklgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSklgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSklgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.registerSklgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSklgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSklgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSklgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSklgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSklgovProfileV2({ id, owner: "a" }),
      );
      M.activateSklgovProfileV2("p1");
      M.activateSklgovProfileV2("p2");
      expect(() => M.activateSklgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSklgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSklgovProfileV2({ id, owner: "a" }),
      );
      M.activateSklgovProfileV2("p1");
      M.activateSklgovProfileV2("p2");
      M.staleSklgovProfileV2("p1");
      M.activateSklgovProfileV2("p3");
      expect(() => M.activateSklgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSklgovProfilesPerOwnerV2(1);
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.registerSklgovProfileV2({ id: "p2", owner: "b" });
      M.activateSklgovProfileV2("p1");
      expect(() => M.activateSklgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("load lifecycle", () => {
    beforeEach(() => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
    });
    it("create→loading→complete", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      M.loadingSklgovLoadV2("r1");
      const r = M.completeLoadSklgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      M.loadingSklgovLoadV2("r1");
      expect(M.failSklgovLoadV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSklgovLoadV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeLoadSklgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSklgovLoadV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSklgovLoadsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSklgovLoadV2({ id, profileId: "p1" }),
      );
      expect(() => M.createSklgovLoadV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("loading counts as pending", () => {
      M.setMaxPendingSklgovLoadsPerProfileV2(1);
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      M.loadingSklgovLoadV2("r1");
      expect(() =>
        M.createSklgovLoadV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSklgovLoadsPerProfileV2(1);
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      M.loadingSklgovLoadV2("r1");
      M.completeLoadSklgovV2("r1");
      expect(() =>
        M.createSklgovLoadV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSklgovLoadV2("nope")).toBeNull());
    it("list", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      M.createSklgovLoadV2({ id: "r2", profileId: "p1" });
      expect(M.listSklgovLoadsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSklgovLoadV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSklgovLoadV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSklgovLoadV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setSklgovProfileIdleMsV2(1000);
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
      const r = M.autoStaleIdleSklgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSklgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      M.loadingSklgovLoadV2("r1");
      M.setSklgovLoadStuckMsV2(100);
      const r = M.autoFailStuckSklgovLoadsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSklgovProfileIdleMsV2(1000);
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleSklgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSkillLoaderGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.loadsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSklgovProfileV2({ id: "p1", owner: "a" });
      M.activateSklgovProfileV2("p1");
      M.createSklgovLoadV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSkillLoaderGovStatsV2();
      expect(s2.totalSklgovProfilesV2).toBe(1);
      expect(s2.totalSklgovLoadsV2).toBe(1);
    });
  });
});
