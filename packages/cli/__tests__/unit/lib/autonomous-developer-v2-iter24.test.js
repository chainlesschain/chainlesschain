import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/autonomous-developer.js";

describe("AutonomousDeveloperGov V2 Surface", () => {
  beforeEach(() => M._resetStateAutonomousDeveloperGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DEVGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DEVGOV_RUN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DEVGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DEVGOV_RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDevgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDevgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDevgovRunsPerProfileV2(33);
      expect(M.getMaxPendingDevgovRunsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDevgovProfileIdleMsV2(60000);
      expect(M.getDevgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDevgovRunStuckMsV2(45000);
      expect(M.getDevgovRunStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDevgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDevgovRunStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDevgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDevgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDevgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default level", () =>
      expect(M.registerDevgovProfileV2({ id: "p1", owner: "a" }).level).toBe(
        "assist",
      ));
    it("activate", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDevgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
      expect(M.pauseDevgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDevgovProfileV2("p1");
      M.pauseDevgovProfileV2("p1");
      expect(M.activateDevgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
      expect(M.archiveDevgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
      M.archiveDevgovProfileV2("p1");
      expect(() => M.touchDevgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseDevgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDevgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDevgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDevgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.registerDevgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listDevgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDevgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDevgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDevgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDevgovProfileV2({ id, owner: "a" }),
      );
      M.activateDevgovProfileV2("p1");
      M.activateDevgovProfileV2("p2");
      expect(() => M.activateDevgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDevgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDevgovProfileV2({ id, owner: "a" }),
      );
      M.activateDevgovProfileV2("p1");
      M.activateDevgovProfileV2("p2");
      M.pauseDevgovProfileV2("p1");
      M.activateDevgovProfileV2("p3");
      expect(() => M.activateDevgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDevgovProfilesPerOwnerV2(1);
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.registerDevgovProfileV2({ id: "p2", owner: "b" });
      M.activateDevgovProfileV2("p1");
      expect(() => M.activateDevgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
    });
    it("create→developing→complete", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      M.developingDevgovRunV2("r1");
      const r = M.completeRunDevgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      M.developingDevgovRunV2("r1");
      expect(M.failDevgovRunV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDevgovRunV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeRunDevgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDevgovRunV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDevgovRunsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDevgovRunV2({ id, profileId: "p1" }),
      );
      expect(() => M.createDevgovRunV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("developing counts as pending", () => {
      M.setMaxPendingDevgovRunsPerProfileV2(1);
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      M.developingDevgovRunV2("r1");
      expect(() =>
        M.createDevgovRunV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDevgovRunsPerProfileV2(1);
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      M.developingDevgovRunV2("r1");
      M.completeRunDevgovV2("r1");
      expect(() =>
        M.createDevgovRunV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDevgovRunV2("nope")).toBeNull());
    it("list", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      M.createDevgovRunV2({ id: "r2", profileId: "p1" });
      expect(M.listDevgovRunsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDevgovRunV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDevgovRunV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDevgovRunV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setDevgovProfileIdleMsV2(1000);
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
      const r = M.autoPauseIdleDevgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDevgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      M.developingDevgovRunV2("r1");
      M.setDevgovRunStuckMsV2(100);
      const r = M.autoFailStuckDevgovRunsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDevgovProfileIdleMsV2(1000);
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleDevgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAutonomousDeveloperGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.runsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDevgovProfileV2({ id: "p1", owner: "a" });
      M.activateDevgovProfileV2("p1");
      M.createDevgovRunV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAutonomousDeveloperGovStatsV2();
      expect(s2.totalDevgovProfilesV2).toBe(1);
      expect(s2.totalDevgovRunsV2).toBe(1);
    });
  });
});
