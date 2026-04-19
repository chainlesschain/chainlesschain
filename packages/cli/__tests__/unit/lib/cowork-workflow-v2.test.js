import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-workflow.js";

describe("CoworkWorkflow V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkWorkflowV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CWWF_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CWWF_STEP_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CWWF_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CWWF_STEP_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCwwfProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCwwfProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCwwfStepsPerProfileV2(33);
      expect(M.getMaxPendingCwwfStepsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCwwfProfileIdleMsV2(60000);
      expect(M.getCwwfProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCwwfStepStuckMsV2(45000);
      expect(M.getCwwfStepStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCwwfProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCwwfStepStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCwwfProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCwwfProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCwwfProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default mode", () =>
      expect(M.registerCwwfProfileV2({ id: "p1", owner: "a" }).mode).toBe(
        "sequential",
      ));
    it("activate", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCwwfProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
      expect(M.pauseCwwfProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCwwfProfileV2("p1");
      M.pauseCwwfProfileV2("p1");
      expect(M.activateCwwfProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
      expect(M.archiveCwwfProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
      M.archiveCwwfProfileV2("p1");
      expect(() => M.touchCwwfProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseCwwfProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerCwwfProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCwwfProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCwwfProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.registerCwwfProfileV2({ id: "p2", owner: "b" });
      expect(M.listCwwfProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCwwfProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCwwfProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCwwfProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCwwfProfileV2({ id, owner: "a" }),
      );
      M.activateCwwfProfileV2("p1");
      M.activateCwwfProfileV2("p2");
      expect(() => M.activateCwwfProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCwwfProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCwwfProfileV2({ id, owner: "a" }),
      );
      M.activateCwwfProfileV2("p1");
      M.activateCwwfProfileV2("p2");
      M.pauseCwwfProfileV2("p1");
      M.activateCwwfProfileV2("p3");
      expect(() => M.activateCwwfProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCwwfProfilesPerOwnerV2(1);
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.registerCwwfProfileV2({ id: "p2", owner: "b" });
      M.activateCwwfProfileV2("p1");
      expect(() => M.activateCwwfProfileV2("p2")).not.toThrow();
    });
  });

  describe("step lifecycle", () => {
    beforeEach(() => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      M.runningCwwfStepV2("r1");
      const r = M.completeStepCwwfV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      M.runningCwwfStepV2("r1");
      expect(M.failCwwfStepV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCwwfStepV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeStepCwwfV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCwwfStepV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCwwfStepsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createCwwfStepV2({ id, profileId: "p1" }));
      expect(() => M.createCwwfStepV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingCwwfStepsPerProfileV2(1);
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      M.runningCwwfStepV2("r1");
      expect(() => M.createCwwfStepV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCwwfStepsPerProfileV2(1);
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      M.runningCwwfStepV2("r1");
      M.completeStepCwwfV2("r1");
      expect(() =>
        M.createCwwfStepV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCwwfStepV2("nope")).toBeNull());
    it("list", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      M.createCwwfStepV2({ id: "r2", profileId: "p1" });
      expect(M.listCwwfStepsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCwwfStepV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      expect(() => M.createCwwfStepV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCwwfStepV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setCwwfProfileIdleMsV2(1000);
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
      const r = M.autoPauseIdleCwwfProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCwwfProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      M.runningCwwfStepV2("r1");
      M.setCwwfStepStuckMsV2(100);
      const r = M.autoFailStuckCwwfStepsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCwwfProfileIdleMsV2(1000);
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleCwwfProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkWorkflowGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.stepsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCwwfProfileV2({ id: "p1", owner: "a" });
      M.activateCwwfProfileV2("p1");
      M.createCwwfStepV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkWorkflowGovStatsV2();
      expect(s2.totalCwwfProfilesV2).toBe(1);
      expect(s2.totalCwwfStepsV2).toBe(1);
    });
  });
});
