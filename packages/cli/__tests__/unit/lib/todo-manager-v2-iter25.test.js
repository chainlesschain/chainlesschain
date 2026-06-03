import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/todo-manager.js";

describe("TodoManagerGov V2 Surface", () => {
  beforeEach(() => M._resetStateTodoManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TODOGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TODOGOV_STEP_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TODOGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TODOGOV_STEP_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveTodogovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveTodogovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingTodogovStepsPerProfileV2(33);
      expect(M.getMaxPendingTodogovStepsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setTodogovProfileIdleMsV2(60000);
      expect(M.getTodogovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setTodogovStepStuckMsV2(45000);
      expect(M.getTodogovStepStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveTodogovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setTodogovStepStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveTodogovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveTodogovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerTodogovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default list", () =>
      expect(M.registerTodogovProfileV2({ id: "p1", owner: "a" }).list).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateTodogovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
      expect(M.pauseTodogovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateTodogovProfileV2("p1");
      M.pauseTodogovProfileV2("p1");
      expect(M.activateTodogovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
      expect(M.archiveTodogovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
      M.archiveTodogovProfileV2("p1");
      expect(() => M.touchTodogovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseTodogovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerTodogovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerTodogovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getTodogovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.registerTodogovProfileV2({ id: "p2", owner: "b" });
      expect(M.listTodogovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getTodogovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getTodogovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveTodogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTodogovProfileV2({ id, owner: "a" }),
      );
      M.activateTodogovProfileV2("p1");
      M.activateTodogovProfileV2("p2");
      expect(() => M.activateTodogovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveTodogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTodogovProfileV2({ id, owner: "a" }),
      );
      M.activateTodogovProfileV2("p1");
      M.activateTodogovProfileV2("p2");
      M.pauseTodogovProfileV2("p1");
      M.activateTodogovProfileV2("p3");
      expect(() => M.activateTodogovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveTodogovProfilesPerOwnerV2(1);
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.registerTodogovProfileV2({ id: "p2", owner: "b" });
      M.activateTodogovProfileV2("p1");
      expect(() => M.activateTodogovProfileV2("p2")).not.toThrow();
    });
  });

  describe("step lifecycle", () => {
    beforeEach(() => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
    });
    it("create→doing→complete", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      M.doingTodogovStepV2("r1");
      const r = M.completeStepTodogovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      M.doingTodogovStepV2("r1");
      expect(M.failTodogovStepV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTodogovStepV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeStepTodogovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createTodogovStepV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingTodogovStepsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createTodogovStepV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createTodogovStepV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("doing counts as pending", () => {
      M.setMaxPendingTodogovStepsPerProfileV2(1);
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      M.doingTodogovStepV2("r1");
      expect(() =>
        M.createTodogovStepV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingTodogovStepsPerProfileV2(1);
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      M.doingTodogovStepV2("r1");
      M.completeStepTodogovV2("r1");
      expect(() =>
        M.createTodogovStepV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getTodogovStepV2("nope")).toBeNull());
    it("list", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      M.createTodogovStepV2({ id: "r2", profileId: "p1" });
      expect(M.listTodogovStepsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createTodogovStepV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createTodogovStepV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTodogovStepV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setTodogovProfileIdleMsV2(1000);
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
      const r = M.autoPauseIdleTodogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getTodogovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      M.doingTodogovStepV2("r1");
      M.setTodogovStepStuckMsV2(100);
      const r = M.autoFailStuckTodogovStepsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setTodogovProfileIdleMsV2(1000);
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleTodogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTodoManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.stepsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerTodogovProfileV2({ id: "p1", owner: "a" });
      M.activateTodogovProfileV2("p1");
      M.createTodogovStepV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTodoManagerGovStatsV2();
      expect(s2.totalTodogovProfilesV2).toBe(1);
      expect(s2.totalTodogovStepsV2).toBe(1);
    });
  });
});
