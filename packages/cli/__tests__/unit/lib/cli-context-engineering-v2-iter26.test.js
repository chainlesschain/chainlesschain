import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cli-context-engineering.js";

describe("CliContextEngineeringGov V2 Surface", () => {
  beforeEach(() => M._resetStateCliContextEngineeringGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CTXENGGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CTXENGGOV_BUILD_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CTXENGGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CTXENGGOV_BUILD_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCtxenggovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCtxenggovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCtxenggovBuildsPerProfileV2(33);
      expect(M.getMaxPendingCtxenggovBuildsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCtxenggovProfileIdleMsV2(60000);
      expect(M.getCtxenggovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCtxenggovBuildStuckMsV2(45000);
      expect(M.getCtxenggovBuildStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCtxenggovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCtxenggovBuildStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCtxenggovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCtxenggovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(
        M.registerCtxenggovProfileV2({ id: "p1", owner: "a" }).status,
      ).toBe("pending"));
    it("default scope", () =>
      expect(M.registerCtxenggovProfileV2({ id: "p1", owner: "a" }).scope).toBe(
        "session",
      ));
    it("activate", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCtxenggovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
      expect(M.staleCtxenggovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCtxenggovProfileV2("p1");
      M.staleCtxenggovProfileV2("p1");
      expect(M.activateCtxenggovProfileV2("p1").activatedAt).toBe(
        a.activatedAt,
      );
    });
    it("archive terminal", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
      expect(M.archiveCtxenggovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
      M.archiveCtxenggovProfileV2("p1");
      expect(() => M.touchCtxenggovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCtxenggovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCtxenggovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCtxenggovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCtxenggovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.registerCtxenggovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCtxenggovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCtxenggovProfileV2({
        id: "p1",
        owner: "a",
        metadata: { x: 1 },
      });
      const p = M.getCtxenggovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCtxenggovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCtxenggovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCtxenggovProfileV2({ id, owner: "a" }),
      );
      M.activateCtxenggovProfileV2("p1");
      M.activateCtxenggovProfileV2("p2");
      expect(() => M.activateCtxenggovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCtxenggovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCtxenggovProfileV2({ id, owner: "a" }),
      );
      M.activateCtxenggovProfileV2("p1");
      M.activateCtxenggovProfileV2("p2");
      M.staleCtxenggovProfileV2("p1");
      M.activateCtxenggovProfileV2("p3");
      expect(() => M.activateCtxenggovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCtxenggovProfilesPerOwnerV2(1);
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.registerCtxenggovProfileV2({ id: "p2", owner: "b" });
      M.activateCtxenggovProfileV2("p1");
      expect(() => M.activateCtxenggovProfileV2("p2")).not.toThrow();
    });
  });

  describe("build lifecycle", () => {
    beforeEach(() => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
    });
    it("create→building→complete", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      M.buildingCtxenggovBuildV2("r1");
      const r = M.completeBuildCtxenggovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      M.buildingCtxenggovBuildV2("r1");
      expect(M.failCtxenggovBuildV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCtxenggovBuildV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeBuildCtxenggovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCtxenggovBuildV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCtxenggovBuildsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCtxenggovBuildV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCtxenggovBuildV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("building counts as pending", () => {
      M.setMaxPendingCtxenggovBuildsPerProfileV2(1);
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      M.buildingCtxenggovBuildV2("r1");
      expect(() =>
        M.createCtxenggovBuildV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCtxenggovBuildsPerProfileV2(1);
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      M.buildingCtxenggovBuildV2("r1");
      M.completeBuildCtxenggovV2("r1");
      expect(() =>
        M.createCtxenggovBuildV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCtxenggovBuildV2("nope")).toBeNull());
    it("list", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      M.createCtxenggovBuildV2({ id: "r2", profileId: "p1" });
      expect(M.listCtxenggovBuildsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCtxenggovBuildV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCtxenggovBuildV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCtxenggovProfileIdleMsV2(1000);
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
      const r = M.autoStaleIdleCtxenggovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCtxenggovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      M.buildingCtxenggovBuildV2("r1");
      M.setCtxenggovBuildStuckMsV2(100);
      const r = M.autoFailStuckCtxenggovBuildsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCtxenggovProfileIdleMsV2(1000);
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCtxenggovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCliContextEngineeringGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.buildsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCtxenggovProfileV2({ id: "p1", owner: "a" });
      M.activateCtxenggovProfileV2("p1");
      M.createCtxenggovBuildV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCliContextEngineeringGovStatsV2();
      expect(s2.totalCtxenggovProfilesV2).toBe(1);
      expect(s2.totalCtxenggovBuildsV2).toBe(1);
    });
  });
});
