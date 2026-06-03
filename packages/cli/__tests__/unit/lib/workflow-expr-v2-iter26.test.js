import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/workflow-expr.js";

describe("WorkflowExprGov V2 Surface", () => {
  beforeEach(() => M._resetStateWorkflowExprGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.WFEXGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.WFEXGOV_EVAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.WFEXGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.WFEXGOV_EVAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveWfexgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveWfexgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingWfexgovEvalsPerProfileV2(33);
      expect(M.getMaxPendingWfexgovEvalsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setWfexgovProfileIdleMsV2(60000);
      expect(M.getWfexgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setWfexgovEvalStuckMsV2(45000);
      expect(M.getWfexgovEvalStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveWfexgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setWfexgovEvalStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveWfexgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveWfexgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerWfexgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default language", () =>
      expect(
        M.registerWfexgovProfileV2({ id: "p1", owner: "a" }).language,
      ).toBe("cel"));
    it("activate", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateWfexgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
      expect(M.pauseWfexgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateWfexgovProfileV2("p1");
      M.pauseWfexgovProfileV2("p1");
      expect(M.activateWfexgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
      expect(M.archiveWfexgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
      M.archiveWfexgovProfileV2("p1");
      expect(() => M.touchWfexgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseWfexgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerWfexgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerWfexgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getWfexgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.registerWfexgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listWfexgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getWfexgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getWfexgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveWfexgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWfexgovProfileV2({ id, owner: "a" }),
      );
      M.activateWfexgovProfileV2("p1");
      M.activateWfexgovProfileV2("p2");
      expect(() => M.activateWfexgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveWfexgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWfexgovProfileV2({ id, owner: "a" }),
      );
      M.activateWfexgovProfileV2("p1");
      M.activateWfexgovProfileV2("p2");
      M.pauseWfexgovProfileV2("p1");
      M.activateWfexgovProfileV2("p3");
      expect(() => M.activateWfexgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveWfexgovProfilesPerOwnerV2(1);
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.registerWfexgovProfileV2({ id: "p2", owner: "b" });
      M.activateWfexgovProfileV2("p1");
      expect(() => M.activateWfexgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("eval lifecycle", () => {
    beforeEach(() => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
    });
    it("create→evaluating→complete", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      M.evaluatingWfexgovEvalV2("r1");
      const r = M.completeEvalWfexgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      M.evaluatingWfexgovEvalV2("r1");
      expect(M.failWfexgovEvalV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWfexgovEvalV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeEvalWfexgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createWfexgovEvalV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingWfexgovEvalsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createWfexgovEvalV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createWfexgovEvalV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("evaluating counts as pending", () => {
      M.setMaxPendingWfexgovEvalsPerProfileV2(1);
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      M.evaluatingWfexgovEvalV2("r1");
      expect(() =>
        M.createWfexgovEvalV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingWfexgovEvalsPerProfileV2(1);
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      M.evaluatingWfexgovEvalV2("r1");
      M.completeEvalWfexgovV2("r1");
      expect(() =>
        M.createWfexgovEvalV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getWfexgovEvalV2("nope")).toBeNull());
    it("list", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      M.createWfexgovEvalV2({ id: "r2", profileId: "p1" });
      expect(M.listWfexgovEvalsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createWfexgovEvalV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createWfexgovEvalV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWfexgovEvalV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setWfexgovProfileIdleMsV2(1000);
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
      const r = M.autoPauseIdleWfexgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getWfexgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      M.evaluatingWfexgovEvalV2("r1");
      M.setWfexgovEvalStuckMsV2(100);
      const r = M.autoFailStuckWfexgovEvalsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setWfexgovProfileIdleMsV2(1000);
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleWfexgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getWorkflowExprGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.evalsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerWfexgovProfileV2({ id: "p1", owner: "a" });
      M.activateWfexgovProfileV2("p1");
      M.createWfexgovEvalV2({ id: "r1", profileId: "p1" });
      const s2 = M.getWorkflowExprGovStatsV2();
      expect(s2.totalWfexgovProfilesV2).toBe(1);
      expect(s2.totalWfexgovEvalsV2).toBe(1);
    });
  });
});
