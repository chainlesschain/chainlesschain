import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/collaboration-governance.js";

describe("CollaborationGovernance V2 Surface", () => {
  beforeEach(() => M._resetStateCollaborationGovernanceGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.COGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.COGOV_DECISION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.COGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.COGOV_DECISION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCogovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCogovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCogovDecisionsPerProfileV2(33);
      expect(M.getMaxPendingCogovDecisionsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCogovProfileIdleMsV2(60000);
      expect(M.getCogovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCogovDecisionStuckMsV2(45000);
      expect(M.getCogovDecisionStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCogovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCogovDecisionStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCogovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCogovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCogovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default scope", () =>
      expect(M.registerCogovProfileV2({ id: "p1", owner: "a" }).scope).toBe(
        "team",
      ));
    it("activate", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCogovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
      expect(M.suspendCogovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCogovProfileV2("p1");
      M.suspendCogovProfileV2("p1");
      expect(M.activateCogovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
      expect(M.archiveCogovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
      M.archiveCogovProfileV2("p1");
      expect(() => M.touchCogovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendCogovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCogovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCogovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCogovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.registerCogovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCogovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCogovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCogovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCogovProfileV2({ id, owner: "a" }),
      );
      M.activateCogovProfileV2("p1");
      M.activateCogovProfileV2("p2");
      expect(() => M.activateCogovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCogovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCogovProfileV2({ id, owner: "a" }),
      );
      M.activateCogovProfileV2("p1");
      M.activateCogovProfileV2("p2");
      M.suspendCogovProfileV2("p1");
      M.activateCogovProfileV2("p3");
      expect(() => M.activateCogovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCogovProfilesPerOwnerV2(1);
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.registerCogovProfileV2({ id: "p2", owner: "b" });
      M.activateCogovProfileV2("p1");
      expect(() => M.activateCogovProfileV2("p2")).not.toThrow();
    });
  });

  describe("decision lifecycle", () => {
    beforeEach(() => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
    });
    it("create→deliberating→complete", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      M.deliberatingCogovDecisionV2("r1");
      const r = M.completeDecisionCogovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      M.deliberatingCogovDecisionV2("r1");
      expect(M.failCogovDecisionV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCogovDecisionV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeDecisionCogovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCogovDecisionV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCogovDecisionsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCogovDecisionV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCogovDecisionV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("deliberating counts as pending", () => {
      M.setMaxPendingCogovDecisionsPerProfileV2(1);
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      M.deliberatingCogovDecisionV2("r1");
      expect(() =>
        M.createCogovDecisionV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCogovDecisionsPerProfileV2(1);
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      M.deliberatingCogovDecisionV2("r1");
      M.completeDecisionCogovV2("r1");
      expect(() =>
        M.createCogovDecisionV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCogovDecisionV2("nope")).toBeNull());
    it("list", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      M.createCogovDecisionV2({ id: "r2", profileId: "p1" });
      expect(M.listCogovDecisionsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCogovDecisionV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCogovDecisionV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCogovDecisionV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setCogovProfileIdleMsV2(1000);
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
      const r = M.autoSuspendIdleCogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCogovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      M.deliberatingCogovDecisionV2("r1");
      M.setCogovDecisionStuckMsV2(100);
      const r = M.autoFailStuckCogovDecisionsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCogovProfileIdleMsV2(1000);
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleCogovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCollaborationGovernanceGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.decisionsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCogovProfileV2({ id: "p1", owner: "a" });
      M.activateCogovProfileV2("p1");
      M.createCogovDecisionV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCollaborationGovernanceGovStatsV2();
      expect(s2.totalCogovProfilesV2).toBe(1);
      expect(s2.totalCogovDecisionsV2).toBe(1);
    });
  });
});
