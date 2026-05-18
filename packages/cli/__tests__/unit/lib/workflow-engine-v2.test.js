import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/workflow-engine.js";

describe("WorkflowEngine V2 Surface", () => {
  beforeEach(() => M._resetStateWorkflowEngineGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.WFGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.WFGOV_STEP_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.WFGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.WFGOV_STEP_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveWfgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveWfgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingWfgovStepsPerProfileV2(33);
      expect(M.getMaxPendingWfgovStepsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setWfgovProfileIdleMsV2(60000);
      expect(M.getWfgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setWfgovStepStuckMsV2(45000);
      expect(M.getWfgovStepStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveWfgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setWfgovStepStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveWfgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveWfgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerWfgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default kind", () =>
      expect(M.registerWfgovProfileV2({ id: "p1", owner: "a" }).kind).toBe(
        "sequential",
      ));
    it("activate", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateWfgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
      expect(M.pauseWfgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateWfgovProfileV2("p1");
      M.pauseWfgovProfileV2("p1");
      expect(M.activateWfgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
      expect(M.archiveWfgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
      M.archiveWfgovProfileV2("p1");
      expect(() => M.touchWfgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseWfgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerWfgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerWfgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getWfgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.registerWfgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listWfgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getWfgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getWfgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveWfgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWfgovProfileV2({ id, owner: "a" }),
      );
      M.activateWfgovProfileV2("p1");
      M.activateWfgovProfileV2("p2");
      expect(() => M.activateWfgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveWfgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWfgovProfileV2({ id, owner: "a" }),
      );
      M.activateWfgovProfileV2("p1");
      M.activateWfgovProfileV2("p2");
      M.pauseWfgovProfileV2("p1");
      M.activateWfgovProfileV2("p3");
      expect(() => M.activateWfgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveWfgovProfilesPerOwnerV2(1);
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.registerWfgovProfileV2({ id: "p2", owner: "b" });
      M.activateWfgovProfileV2("p1");
      expect(() => M.activateWfgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("step lifecycle", () => {
    beforeEach(() => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
    });
    it("create→executing→complete", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      M.executingWfgovStepV2("r1");
      const r = M.completeStepWfgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      M.executingWfgovStepV2("r1");
      expect(M.failWfgovStepV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWfgovStepV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeStepWfgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createWfgovStepV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingWfgovStepsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createWfgovStepV2({ id, profileId: "p1" }),
      );
      expect(() => M.createWfgovStepV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("executing counts as pending", () => {
      M.setMaxPendingWfgovStepsPerProfileV2(1);
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      M.executingWfgovStepV2("r1");
      expect(() =>
        M.createWfgovStepV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingWfgovStepsPerProfileV2(1);
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      M.executingWfgovStepV2("r1");
      M.completeStepWfgovV2("r1");
      expect(() =>
        M.createWfgovStepV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getWfgovStepV2("nope")).toBeNull());
    it("list", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      M.createWfgovStepV2({ id: "r2", profileId: "p1" });
      expect(M.listWfgovStepsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createWfgovStepV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createWfgovStepV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWfgovStepV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setWfgovProfileIdleMsV2(1000);
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
      const r = M.autoPauseIdleWfgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getWfgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      M.executingWfgovStepV2("r1");
      M.setWfgovStepStuckMsV2(100);
      const r = M.autoFailStuckWfgovStepsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setWfgovProfileIdleMsV2(1000);
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleWfgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getWorkflowEngineGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.stepsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerWfgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfgovProfileV2("p1");
      M.createWfgovStepV2({ id: "r1", profileId: "p1" });
      const s2 = M.getWorkflowEngineGovStatsV2();
      expect(s2.totalWfgovProfilesV2).toBe(1);
      expect(s2.totalWfgovStepsV2).toBe(1);
    });
  });
});
