import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/universal-runtime.js";

describe("UniversalRuntimeGov V2 Surface", () => {
  beforeEach(() => M._resetStateUniversalRuntimeGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.RTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.RTGOV_TASK_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.RTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.RTGOV_TASK_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveRtgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveRtgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingRtgovTasksPerProfileV2(33);
      expect(M.getMaxPendingRtgovTasksPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setRtgovProfileIdleMsV2(60000);
      expect(M.getRtgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setRtgovTaskStuckMsV2(45000);
      expect(M.getRtgovTaskStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveRtgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setRtgovTaskStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveRtgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveRtgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerRtgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default runtime", () =>
      expect(M.registerRtgovProfileV2({ id: "p1", owner: "a" }).runtime).toBe(
        "node",
      ));
    it("activate", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateRtgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
      expect(M.degradeRtgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateRtgovProfileV2("p1");
      M.degradeRtgovProfileV2("p1");
      expect(M.activateRtgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
      expect(M.archiveRtgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
      M.archiveRtgovProfileV2("p1");
      expect(() => M.touchRtgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeRtgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerRtgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerRtgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getRtgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.registerRtgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listRtgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getRtgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getRtgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveRtgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRtgovProfileV2({ id, owner: "a" }),
      );
      M.activateRtgovProfileV2("p1");
      M.activateRtgovProfileV2("p2");
      expect(() => M.activateRtgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveRtgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerRtgovProfileV2({ id, owner: "a" }),
      );
      M.activateRtgovProfileV2("p1");
      M.activateRtgovProfileV2("p2");
      M.degradeRtgovProfileV2("p1");
      M.activateRtgovProfileV2("p3");
      expect(() => M.activateRtgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveRtgovProfilesPerOwnerV2(1);
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.registerRtgovProfileV2({ id: "p2", owner: "b" });
      M.activateRtgovProfileV2("p1");
      expect(() => M.activateRtgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("task lifecycle", () => {
    beforeEach(() => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
    });
    it("create→executing→complete", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      M.executingRtgovTaskV2("r1");
      const r = M.completeTaskRtgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      M.executingRtgovTaskV2("r1");
      expect(M.failRtgovTaskV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRtgovTaskV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTaskRtgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createRtgovTaskV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingRtgovTasksPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createRtgovTaskV2({ id, profileId: "p1" }),
      );
      expect(() => M.createRtgovTaskV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("executing counts as pending", () => {
      M.setMaxPendingRtgovTasksPerProfileV2(1);
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      M.executingRtgovTaskV2("r1");
      expect(() =>
        M.createRtgovTaskV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingRtgovTasksPerProfileV2(1);
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      M.executingRtgovTaskV2("r1");
      M.completeTaskRtgovV2("r1");
      expect(() =>
        M.createRtgovTaskV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getRtgovTaskV2("nope")).toBeNull());
    it("list", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      M.createRtgovTaskV2({ id: "r2", profileId: "p1" });
      expect(M.listRtgovTasksV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createRtgovTaskV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createRtgovTaskV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      expect(M.cancelRtgovTaskV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setRtgovProfileIdleMsV2(1000);
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
      const r = M.autoDegradeIdleRtgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getRtgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      M.executingRtgovTaskV2("r1");
      M.setRtgovTaskStuckMsV2(100);
      const r = M.autoFailStuckRtgovTasksV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setRtgovProfileIdleMsV2(1000);
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleRtgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getUniversalRuntimeGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.tasksByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerRtgovProfileV2({ id: "p1", owner: "a" });
      M.activateRtgovProfileV2("p1");
      M.createRtgovTaskV2({ id: "r1", profileId: "p1" });
      const s2 = M.getUniversalRuntimeGovStatsV2();
      expect(s2.totalRtgovProfilesV2).toBe(1);
      expect(s2.totalRtgovTasksV2).toBe(1);
    });
  });
});
