import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/dao-governance.js";

describe("Daomgov V2 Surface", () => {
  beforeEach(() => M._resetStateDaomgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DAOMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DAOMGOV_PROPOSAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DAOMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DAOMGOV_PROPOSAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDaomProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDaomProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDaomProposalsPerProfileV2(33);
      expect(M.getMaxPendingDaomProposalsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDaomProfileIdleMsV2(60000);
      expect(M.getDaomProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDaomProposalStuckMsV2(45000);
      expect(M.getDaomProposalStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDaomProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDaomProposalStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDaomProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDaomProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDaomProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default realm", () =>
      expect(M.registerDaomProfileV2({ id: "p1", owner: "a" }).realm).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDaomProfileV2("p1").status).toBe("active");
    });
    it("paused", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
      expect(M.pausedDaomProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDaomProfileV2("p1");
      M.pausedDaomProfileV2("p1");
      expect(M.activateDaomProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
      expect(M.archiveDaomProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
      M.archiveDaomProfileV2("p1");
      expect(() => M.touchDaomProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausedDaomProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerDaomProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDaomProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDaomProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.registerDaomProfileV2({ id: "p2", owner: "b" });
      expect(M.listDaomProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDaomProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDaomProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDaomProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDaomProfileV2({ id, owner: "a" }),
      );
      M.activateDaomProfileV2("p1");
      M.activateDaomProfileV2("p2");
      expect(() => M.activateDaomProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDaomProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDaomProfileV2({ id, owner: "a" }),
      );
      M.activateDaomProfileV2("p1");
      M.activateDaomProfileV2("p2");
      M.pausedDaomProfileV2("p1");
      M.activateDaomProfileV2("p3");
      expect(() => M.activateDaomProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDaomProfilesPerOwnerV2(1);
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.registerDaomProfileV2({ id: "p2", owner: "b" });
      M.activateDaomProfileV2("p1");
      expect(() => M.activateDaomProfileV2("p2")).not.toThrow();
    });
  });

  describe("proposal lifecycle", () => {
    beforeEach(() => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
    });
    it("create→voting→complete", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      M.votingDaomProposalV2("r1");
      const r = M.completeProposalDaomV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      M.votingDaomProposalV2("r1");
      expect(M.failDaomProposalV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDaomProposalV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeProposalDaomV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDaomProposalV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDaomProposalsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDaomProposalV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createDaomProposalV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("voting counts as pending", () => {
      M.setMaxPendingDaomProposalsPerProfileV2(1);
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      M.votingDaomProposalV2("r1");
      expect(() =>
        M.createDaomProposalV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDaomProposalsPerProfileV2(1);
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      M.votingDaomProposalV2("r1");
      M.completeProposalDaomV2("r1");
      expect(() =>
        M.createDaomProposalV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDaomProposalV2("nope")).toBeNull());
    it("list", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      M.createDaomProposalV2({ id: "r2", profileId: "p1" });
      expect(M.listDaomProposalsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDaomProposalV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDaomProposalV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDaomProposalV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPausedIdle", () => {
      M.setDaomProfileIdleMsV2(1000);
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
      const r = M.autoPausedIdleDaomProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDaomProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      M.votingDaomProposalV2("r1");
      M.setDaomProposalStuckMsV2(100);
      const r = M.autoFailStuckDaomProposalsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDaomProfileIdleMsV2(1000);
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPausedIdleDaomProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDaomgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.proposalsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDaomProfileV2({ id: "p1", owner: "a" });
      M.activateDaomProfileV2("p1");
      M.createDaomProposalV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDaomgovStatsV2();
      expect(s2.totalDaomProfilesV2).toBe(1);
      expect(s2.totalDaomProposalsV2).toBe(1);
    });
  });
});
