import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/agent-network.js";

describe("AgentNetwork V2 Surface", () => {
  beforeEach(() => M._resetStateAgentNetworkGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.ANETGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.ANETGOV_DISPATCH_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.ANETGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ANETGOV_DISPATCH_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAnetgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAnetgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAnetgovDispatchsPerProfileV2(33);
      expect(M.getMaxPendingAnetgovDispatchsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAnetgovProfileIdleMsV2(60000);
      expect(M.getAnetgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAnetgovDispatchStuckMsV2(45000);
      expect(M.getAnetgovDispatchStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAnetgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAnetgovDispatchStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAnetgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAnetgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAnetgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default role", () =>
      expect(M.registerAnetgovProfileV2({ id: "p1", owner: "a" }).role).toBe(
        "worker",
      ));
    it("activate", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAnetgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
      expect(M.suspendAnetgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAnetgovProfileV2("p1");
      M.suspendAnetgovProfileV2("p1");
      expect(M.activateAnetgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
      expect(M.archiveAnetgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
      M.archiveAnetgovProfileV2("p1");
      expect(() => M.touchAnetgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendAnetgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerAnetgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAnetgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAnetgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.registerAnetgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listAnetgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAnetgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAnetgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAnetgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAnetgovProfileV2({ id, owner: "a" }),
      );
      M.activateAnetgovProfileV2("p1");
      M.activateAnetgovProfileV2("p2");
      expect(() => M.activateAnetgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAnetgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAnetgovProfileV2({ id, owner: "a" }),
      );
      M.activateAnetgovProfileV2("p1");
      M.activateAnetgovProfileV2("p2");
      M.suspendAnetgovProfileV2("p1");
      M.activateAnetgovProfileV2("p3");
      expect(() => M.activateAnetgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAnetgovProfilesPerOwnerV2(1);
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.registerAnetgovProfileV2({ id: "p2", owner: "b" });
      M.activateAnetgovProfileV2("p1");
      expect(() => M.activateAnetgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("dispatch lifecycle", () => {
    beforeEach(() => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
    });
    it("create→dispatching→complete", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      M.dispatchingAnetgovDispatchV2("r1");
      const r = M.completeDispatchAnetgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      M.dispatchingAnetgovDispatchV2("r1");
      expect(M.failAnetgovDispatchV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAnetgovDispatchV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeDispatchAnetgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAnetgovDispatchV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAnetgovDispatchsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createAnetgovDispatchV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createAnetgovDispatchV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("dispatching counts as pending", () => {
      M.setMaxPendingAnetgovDispatchsPerProfileV2(1);
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      M.dispatchingAnetgovDispatchV2("r1");
      expect(() =>
        M.createAnetgovDispatchV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAnetgovDispatchsPerProfileV2(1);
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      M.dispatchingAnetgovDispatchV2("r1");
      M.completeDispatchAnetgovV2("r1");
      expect(() =>
        M.createAnetgovDispatchV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAnetgovDispatchV2("nope")).toBeNull());
    it("list", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      M.createAnetgovDispatchV2({ id: "r2", profileId: "p1" });
      expect(M.listAnetgovDispatchsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAnetgovDispatchV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAnetgovDispatchV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setAnetgovProfileIdleMsV2(1000);
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
      const r = M.autoSuspendIdleAnetgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAnetgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      M.dispatchingAnetgovDispatchV2("r1");
      M.setAnetgovDispatchStuckMsV2(100);
      const r = M.autoFailStuckAnetgovDispatchsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAnetgovProfileIdleMsV2(1000);
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleAnetgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAgentNetworkGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.dispatchsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAnetgovProfileV2({ id: "p1", owner: "a" });
      M.activateAnetgovProfileV2("p1");
      M.createAnetgovDispatchV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAgentNetworkGovStatsV2();
      expect(s2.totalAnetgovProfilesV2).toBe(1);
      expect(s2.totalAnetgovDispatchsV2).toBe(1);
    });
  });
});
