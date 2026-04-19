import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/social-graph-analytics.js";

describe("Social Graph Analytics V2 Surface", () => {
  beforeEach(() => M._resetStateSocialGraphAnalyticsV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SGAN_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SGAN_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SGAN_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SGAN_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSganProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSganProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSganRunsPerProfileV2(33);
      expect(M.getMaxPendingSganRunsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSganProfileIdleMsV2(60000);
      expect(M.getSganProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSganRunStuckMsV2(45000);
      expect(M.getSganRunStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSganProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setSganRunStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSganProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSganProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSganProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default algorithm", () =>
      expect(M.registerSganProfileV2({ id: "p1", owner: "a" }).algorithm).toBe(
        "centrality",
      ));
    it("activate", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSganProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
      expect(M.staleSganProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSganProfileV2("p1");
      M.staleSganProfileV2("p1");
      expect(M.activateSganProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
      expect(M.archiveSganProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
      M.archiveSganProfileV2("p1");
      expect(() => M.touchSganProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleSganProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerSganProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSganProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSganProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.registerSganProfileV2({ id: "p2", owner: "b" });
      expect(M.listSganProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSganProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSganProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSganProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSganProfileV2({ id, owner: "a" }),
      );
      M.activateSganProfileV2("p1");
      M.activateSganProfileV2("p2");
      expect(() => M.activateSganProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSganProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSganProfileV2({ id, owner: "a" }),
      );
      M.activateSganProfileV2("p1");
      M.activateSganProfileV2("p2");
      M.staleSganProfileV2("p1");
      M.activateSganProfileV2("p3");
      expect(() => M.activateSganProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSganProfilesPerOwnerV2(1);
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.registerSganProfileV2({ id: "p2", owner: "b" });
      M.activateSganProfileV2("p1");
      expect(() => M.activateSganProfileV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      M.runningSganRunV2("r1");
      const r = M.completeSganRunV2("r1");
      expect(r.status).toBe("completed");
    });
    it("fail", () => {
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      M.runningSganRunV2("r1");
      expect(M.failSganRunV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSganRunV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeSganRunV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSganRunV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSganRunsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createSganRunV2({ id, profileId: "p1" }));
      expect(() => M.createSganRunV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingSganRunsPerProfileV2(1);
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      M.runningSganRunV2("r1");
      expect(() => M.createSganRunV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSganRunsPerProfileV2(1);
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      M.runningSganRunV2("r1");
      M.completeSganRunV2("r1");
      expect(() =>
        M.createSganRunV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setSganProfileIdleMsV2(1000);
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
      const r = M.autoStaleIdleSganProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSganProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      M.runningSganRunV2("r1");
      M.setSganRunStuckMsV2(100);
      const r = M.autoFailStuckSganRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s = M.getSocialGraphAnalyticsGovStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSganProfileV2({ id: "p1", owner: "a" });
      M.activateSganProfileV2("p1");
      M.createSganRunV2({ id: "r1", profileId: "p1" });
      const s = M.getSocialGraphAnalyticsGovStatsV2();
      expect(s.totalSganProfilesV2).toBe(1);
      expect(s.totalSganRunsV2).toBe(1);
    });
  });
});
