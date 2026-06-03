import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/automation-engine.js";

describe("AutomationEngine V2 Surface", () => {
  beforeEach(() => M._resetStateAutomationEngineGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.AUGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.AUGOV_FLOW_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.AUGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.AUGOV_FLOW_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAugovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAugovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAugovFlowsPerProfileV2(33);
      expect(M.getMaxPendingAugovFlowsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAugovProfileIdleMsV2(60000);
      expect(M.getAugovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAugovFlowStuckMsV2(45000);
      expect(M.getAugovFlowStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAugovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAugovFlowStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAugovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAugovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAugovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default connector", () =>
      expect(M.registerAugovProfileV2({ id: "p1", owner: "a" }).connector).toBe(
        "webhook",
      ));
    it("activate", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAugovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
      expect(M.pauseAugovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAugovProfileV2("p1");
      M.pauseAugovProfileV2("p1");
      expect(M.activateAugovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
      expect(M.archiveAugovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
      M.archiveAugovProfileV2("p1");
      expect(() => M.touchAugovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseAugovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerAugovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAugovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAugovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.registerAugovProfileV2({ id: "p2", owner: "b" });
      expect(M.listAugovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAugovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAugovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAugovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAugovProfileV2({ id, owner: "a" }),
      );
      M.activateAugovProfileV2("p1");
      M.activateAugovProfileV2("p2");
      expect(() => M.activateAugovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAugovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAugovProfileV2({ id, owner: "a" }),
      );
      M.activateAugovProfileV2("p1");
      M.activateAugovProfileV2("p2");
      M.pauseAugovProfileV2("p1");
      M.activateAugovProfileV2("p3");
      expect(() => M.activateAugovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAugovProfilesPerOwnerV2(1);
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.registerAugovProfileV2({ id: "p2", owner: "b" });
      M.activateAugovProfileV2("p1");
      expect(() => M.activateAugovProfileV2("p2")).not.toThrow();
    });
  });

  describe("flow lifecycle", () => {
    beforeEach(() => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      M.runningAugovFlowV2("r1");
      const r = M.completeFlowAugovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      M.runningAugovFlowV2("r1");
      expect(M.failAugovFlowV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAugovFlowV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeFlowAugovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAugovFlowV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAugovFlowsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createAugovFlowV2({ id, profileId: "p1" }),
      );
      expect(() => M.createAugovFlowV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("running counts as pending", () => {
      M.setMaxPendingAugovFlowsPerProfileV2(1);
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      M.runningAugovFlowV2("r1");
      expect(() =>
        M.createAugovFlowV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAugovFlowsPerProfileV2(1);
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      M.runningAugovFlowV2("r1");
      M.completeFlowAugovV2("r1");
      expect(() =>
        M.createAugovFlowV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAugovFlowV2("nope")).toBeNull());
    it("list", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      M.createAugovFlowV2({ id: "r2", profileId: "p1" });
      expect(M.listAugovFlowsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAugovFlowV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createAugovFlowV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAugovFlowV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setAugovProfileIdleMsV2(1000);
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
      const r = M.autoPauseIdleAugovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAugovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      M.runningAugovFlowV2("r1");
      M.setAugovFlowStuckMsV2(100);
      const r = M.autoFailStuckAugovFlowsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAugovProfileIdleMsV2(1000);
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleAugovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAutomationEngineGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.flowsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAugovProfileV2({ id: "p1", owner: "a" });
      M.activateAugovProfileV2("p1");
      M.createAugovFlowV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAutomationEngineGovStatsV2();
      expect(s2.totalAugovProfilesV2).toBe(1);
      expect(s2.totalAugovFlowsV2).toBe(1);
    });
  });
});
