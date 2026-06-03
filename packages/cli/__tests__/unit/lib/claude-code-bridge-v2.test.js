import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/claude-code-bridge.js";

describe("ClaudeCodeBridge V2 Surface", () => {
  beforeEach(() => M._resetStateClaudeCodeBridgeV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CCBGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CCBGOV_INVOCATION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CCBGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CCBGOV_INVOCATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCcbgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCcbgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCcbgovInvocationsPerProfileV2(33);
      expect(M.getMaxPendingCcbgovInvocationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCcbgovProfileIdleMsV2(60000);
      expect(M.getCcbgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCcbgovInvocationStuckMsV2(45000);
      expect(M.getCcbgovInvocationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCcbgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCcbgovInvocationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCcbgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCcbgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCcbgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default channel", () =>
      expect(M.registerCcbgovProfileV2({ id: "p1", owner: "a" }).channel).toBe(
        "stdio",
      ));
    it("activate", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCcbgovProfileV2("p1").status).toBe("active");
    });
    it("degrade", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
      expect(M.degradeCcbgovProfileV2("p1").status).toBe("degraded");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCcbgovProfileV2("p1");
      M.degradeCcbgovProfileV2("p1");
      expect(M.activateCcbgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
      expect(M.archiveCcbgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
      M.archiveCcbgovProfileV2("p1");
      expect(() => M.touchCcbgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.degradeCcbgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCcbgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCcbgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCcbgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.registerCcbgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCcbgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCcbgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCcbgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCcbgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCcbgovProfileV2({ id, owner: "a" }),
      );
      M.activateCcbgovProfileV2("p1");
      M.activateCcbgovProfileV2("p2");
      expect(() => M.activateCcbgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCcbgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCcbgovProfileV2({ id, owner: "a" }),
      );
      M.activateCcbgovProfileV2("p1");
      M.activateCcbgovProfileV2("p2");
      M.degradeCcbgovProfileV2("p1");
      M.activateCcbgovProfileV2("p3");
      expect(() => M.activateCcbgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCcbgovProfilesPerOwnerV2(1);
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.registerCcbgovProfileV2({ id: "p2", owner: "b" });
      M.activateCcbgovProfileV2("p1");
      expect(() => M.activateCcbgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("invocation lifecycle", () => {
    beforeEach(() => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
    });
    it("create→running→complete", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      M.runningCcbgovInvocationV2("r1");
      const r = M.completeInvocationCcbgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      M.runningCcbgovInvocationV2("r1");
      expect(M.failCcbgovInvocationV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCcbgovInvocationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeInvocationCcbgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCcbgovInvocationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCcbgovInvocationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCcbgovInvocationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCcbgovInvocationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("running counts as pending", () => {
      M.setMaxPendingCcbgovInvocationsPerProfileV2(1);
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      M.runningCcbgovInvocationV2("r1");
      expect(() =>
        M.createCcbgovInvocationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCcbgovInvocationsPerProfileV2(1);
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      M.runningCcbgovInvocationV2("r1");
      M.completeInvocationCcbgovV2("r1");
      expect(() =>
        M.createCcbgovInvocationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCcbgovInvocationV2("nope")).toBeNull());
    it("list", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      M.createCcbgovInvocationV2({ id: "r2", profileId: "p1" });
      expect(M.listCcbgovInvocationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCcbgovInvocationV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCcbgovInvocationV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => {
      M.setCcbgovProfileIdleMsV2(1000);
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
      const r = M.autoDegradeIdleCcbgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCcbgovProfileV2("p1").status).toBe("degraded");
    });
    it("autoFailStuck", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      M.runningCcbgovInvocationV2("r1");
      M.setCcbgovInvocationStuckMsV2(100);
      const r = M.autoFailStuckCcbgovInvocationsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCcbgovProfileIdleMsV2(1000);
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDegradeIdleCcbgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getClaudeCodeBridgeGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.invocationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCcbgovProfileV2({ id: "p1", owner: "a" });
      M.activateCcbgovProfileV2("p1");
      M.createCcbgovInvocationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getClaudeCodeBridgeGovStatsV2();
      expect(s2.totalCcbgovProfilesV2).toBe(1);
      expect(s2.totalCcbgovInvocationsV2).toBe(1);
    });
  });
});
