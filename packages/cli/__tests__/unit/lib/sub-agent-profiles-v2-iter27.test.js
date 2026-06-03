import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/sub-agent-profiles.js";

describe("SubAgentProfilesGov V2 Surface", () => {
  beforeEach(() => M._resetStateSubAgentProfilesGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.SAPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.SAPGOV_APPLY_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.SAPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.SAPGOV_APPLY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveSapgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveSapgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingSapgovApplysPerProfileV2(33);
      expect(M.getMaxPendingSapgovApplysPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setSapgovProfileIdleMsV2(60000);
      expect(M.getSapgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setSapgovApplyStuckMsV2(45000);
      expect(M.getSapgovApplyStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveSapgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setSapgovApplyStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveSapgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveSapgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerSapgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default role", () =>
      expect(M.registerSapgovProfileV2({ id: "p1", owner: "a" }).role).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateSapgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
      expect(M.suspendSapgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateSapgovProfileV2("p1");
      M.suspendSapgovProfileV2("p1");
      expect(M.activateSapgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
      expect(M.archiveSapgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
      M.archiveSapgovProfileV2("p1");
      expect(() => M.touchSapgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendSapgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerSapgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerSapgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getSapgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.registerSapgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listSapgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getSapgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getSapgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveSapgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSapgovProfileV2({ id, owner: "a" }),
      );
      M.activateSapgovProfileV2("p1");
      M.activateSapgovProfileV2("p2");
      expect(() => M.activateSapgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveSapgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerSapgovProfileV2({ id, owner: "a" }),
      );
      M.activateSapgovProfileV2("p1");
      M.activateSapgovProfileV2("p2");
      M.suspendSapgovProfileV2("p1");
      M.activateSapgovProfileV2("p3");
      expect(() => M.activateSapgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveSapgovProfilesPerOwnerV2(1);
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.registerSapgovProfileV2({ id: "p2", owner: "b" });
      M.activateSapgovProfileV2("p1");
      expect(() => M.activateSapgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("apply lifecycle", () => {
    beforeEach(() => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
    });
    it("create→applying→complete", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingSapgovApplyV2("r1");
      const r = M.completeApplySapgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingSapgovApplyV2("r1");
      expect(M.failSapgovApplyV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSapgovApplyV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeApplySapgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createSapgovApplyV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingSapgovApplysPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createSapgovApplyV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createSapgovApplyV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("applying counts as pending", () => {
      M.setMaxPendingSapgovApplysPerProfileV2(1);
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingSapgovApplyV2("r1");
      expect(() =>
        M.createSapgovApplyV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingSapgovApplysPerProfileV2(1);
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingSapgovApplyV2("r1");
      M.completeApplySapgovV2("r1");
      expect(() =>
        M.createSapgovApplyV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getSapgovApplyV2("nope")).toBeNull());
    it("list", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      M.createSapgovApplyV2({ id: "r2", profileId: "p1" });
      expect(M.listSapgovApplysV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createSapgovApplyV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createSapgovApplyV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      expect(M.cancelSapgovApplyV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setSapgovProfileIdleMsV2(1000);
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
      const r = M.autoSuspendIdleSapgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getSapgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      M.applyingSapgovApplyV2("r1");
      M.setSapgovApplyStuckMsV2(100);
      const r = M.autoFailStuckSapgovApplysV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setSapgovProfileIdleMsV2(1000);
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleSapgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSubAgentProfilesGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.applysByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerSapgovProfileV2({ id: "p1", owner: "a" });
      M.activateSapgovProfileV2("p1");
      M.createSapgovApplyV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSubAgentProfilesGovStatsV2();
      expect(s2.totalSapgovProfilesV2).toBe(1);
      expect(s2.totalSapgovApplysV2).toBe(1);
    });
  });
});
