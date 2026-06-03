import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/stress-tester.js";

describe("StressTester V2 Surface", () => {
  beforeEach(() => M._resetStateStressTesterV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.STRGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.STRGOV_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.STRGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.STRGOV_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveStrgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveStrgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingStrgovRunsPerProfileV2(33);
      expect(M.getMaxPendingStrgovRunsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setStrgovProfileIdleMsV2(60000);
      expect(M.getStrgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setStrgovRunStuckMsV2(45000);
      expect(M.getStrgovRunStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveStrgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setStrgovRunStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveStrgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveStrgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerStrgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default scenario", () =>
      expect(M.registerStrgovProfileV2({ id: "p1", owner: "a" }).scenario).toBe(
        "ramp",
      ));
    it("activate", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateStrgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
      expect(M.staleStrgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateStrgovProfileV2("p1");
      M.staleStrgovProfileV2("p1");
      expect(M.activateStrgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
      expect(M.archiveStrgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
      M.archiveStrgovProfileV2("p1");
      expect(() => M.touchStrgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleStrgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerStrgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerStrgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getStrgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.registerStrgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listStrgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getStrgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getStrgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveStrgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerStrgovProfileV2({ id, owner: "a" }),
      );
      M.activateStrgovProfileV2("p1");
      M.activateStrgovProfileV2("p2");
      expect(() => M.activateStrgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveStrgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerStrgovProfileV2({ id, owner: "a" }),
      );
      M.activateStrgovProfileV2("p1");
      M.activateStrgovProfileV2("p2");
      M.staleStrgovProfileV2("p1");
      M.activateStrgovProfileV2("p3");
      expect(() => M.activateStrgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveStrgovProfilesPerOwnerV2(1);
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.registerStrgovProfileV2({ id: "p2", owner: "b" });
      M.activateStrgovProfileV2("p1");
      expect(() => M.activateStrgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      M.runningStrgovRunV2("r1");
      const r = M.completeRunStrgovV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("running");
    });
    it("fail", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      M.runningStrgovRunV2("r1");
      expect(M.failStrgovRunV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelStrgovRunV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRunStrgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createStrgovRunV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingStrgovRunsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createStrgovRunV2({ id, profileId: "p1" }),
      );
      expect(() => M.createStrgovRunV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingStrgovRunsPerProfileV2(1);
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      M.runningStrgovRunV2("r1");
      expect(() =>
        M.createStrgovRunV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingStrgovRunsPerProfileV2(1);
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      M.runningStrgovRunV2("r1");
      M.completeRunStrgovV2("r1");
      expect(() =>
        M.createStrgovRunV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getStrgovRunV2("nope")).toBeNull());
    it("list", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      M.createStrgovRunV2({ id: "r2", profileId: "p1" });
      expect(M.listStrgovRunsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createStrgovRunV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createStrgovRunV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelStrgovRunV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setStrgovProfileIdleMsV2(1000);
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
      const r = M.autoStaleIdleStrgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getStrgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      M.runningStrgovRunV2("r1");
      M.setStrgovRunStuckMsV2(100);
      const r = M.autoFailStuckStrgovRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setStrgovProfileIdleMsV2(1000);
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleStrgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getStressTesterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerStrgovProfileV2({ id: "p1", owner: "a" });
      M.activateStrgovProfileV2("p1");
      M.createStrgovRunV2({ id: "r1", profileId: "p1" });
      const s2 = M.getStressTesterGovStatsV2();
      expect(s2.totalStrgovProfilesV2).toBe(1);
      expect(s2.totalStrgovRunsV2).toBe(1);
    });
  });
});
