import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evomap-governance.js";

describe("EvomapGovernance V2 Surface", () => {
  beforeEach(() => M._resetStateEvomapGovernanceGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.EVGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.EVGOV_PROPOSAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.EVGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.EVGOV_PROPOSAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveEvgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveEvgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingEvgovProposalsPerProfileV2(33);
      expect(M.getMaxPendingEvgovProposalsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setEvgovProfileIdleMsV2(60000);
      expect(M.getEvgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setEvgovProposalStuckMsV2(45000);
      expect(M.getEvgovProposalStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveEvgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setEvgovProposalStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveEvgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveEvgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerEvgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default lane", () =>
      expect(M.registerEvgovProfileV2({ id: "p1", owner: "a" }).lane).toBe(
        "core",
      ));
    it("activate", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateEvgovProfileV2("p1").status).toBe("active");
    });
    it("pause", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
      expect(M.pauseEvgovProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateEvgovProfileV2("p1");
      M.pauseEvgovProfileV2("p1");
      expect(M.activateEvgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
      expect(M.archiveEvgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
      M.archiveEvgovProfileV2("p1");
      expect(() => M.touchEvgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pauseEvgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerEvgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerEvgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getEvgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.registerEvgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listEvgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getEvgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getEvgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveEvgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEvgovProfileV2({ id, owner: "a" }),
      );
      M.activateEvgovProfileV2("p1");
      M.activateEvgovProfileV2("p2");
      expect(() => M.activateEvgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEvgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerEvgovProfileV2({ id, owner: "a" }),
      );
      M.activateEvgovProfileV2("p1");
      M.activateEvgovProfileV2("p2");
      M.pauseEvgovProfileV2("p1");
      M.activateEvgovProfileV2("p3");
      expect(() => M.activateEvgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveEvgovProfilesPerOwnerV2(1);
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.registerEvgovProfileV2({ id: "p2", owner: "b" });
      M.activateEvgovProfileV2("p1");
      expect(() => M.activateEvgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("proposal lifecycle", () => {
    beforeEach(() => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
    });
    it("create→reviewing→complete", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      M.reviewingEvgovProposalV2("r1");
      const r = M.completeProposalEvgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      M.reviewingEvgovProposalV2("r1");
      expect(M.failEvgovProposalV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEvgovProposalV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeProposalEvgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createEvgovProposalV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingEvgovProposalsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createEvgovProposalV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createEvgovProposalV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("reviewing counts as pending", () => {
      M.setMaxPendingEvgovProposalsPerProfileV2(1);
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      M.reviewingEvgovProposalV2("r1");
      expect(() =>
        M.createEvgovProposalV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingEvgovProposalsPerProfileV2(1);
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      M.reviewingEvgovProposalV2("r1");
      M.completeProposalEvgovV2("r1");
      expect(() =>
        M.createEvgovProposalV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getEvgovProposalV2("nope")).toBeNull());
    it("list", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      M.createEvgovProposalV2({ id: "r2", profileId: "p1" });
      expect(M.listEvgovProposalsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createEvgovProposalV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createEvgovProposalV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelEvgovProposalV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setEvgovProfileIdleMsV2(1000);
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
      const r = M.autoPauseIdleEvgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEvgovProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      M.reviewingEvgovProposalV2("r1");
      M.setEvgovProposalStuckMsV2(100);
      const r = M.autoFailStuckEvgovProposalsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setEvgovProfileIdleMsV2(1000);
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPauseIdleEvgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getEvomapGovernanceGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.proposalsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEvgovProfileV2({ id: "p1", owner: "a" });
      M.activateEvgovProfileV2("p1");
      M.createEvgovProposalV2({ id: "r1", profileId: "p1" });
      const s2 = M.getEvomapGovernanceGovStatsV2();
      expect(s2.totalEvgovProfilesV2).toBe(1);
      expect(s2.totalEvgovProposalsV2).toBe(1);
    });
  });
});
