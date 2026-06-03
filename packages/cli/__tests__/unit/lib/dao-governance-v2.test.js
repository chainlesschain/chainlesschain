import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/dao-governance.js";

describe("DAO Governance V2 Surface", () => {
  beforeEach(() => M._resetStateDaoGovernanceV2());

  describe("enums", () => {
    it("org maturity has 4 states", () =>
      expect(Object.keys(M.DAO_ORG_MATURITY_V2)).toHaveLength(4));
    it("proposal lifecycle has 5 states", () =>
      expect(Object.keys(M.DAO_PROPOSAL_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.DAO_ORG_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DAO_PROPOSAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveDaoOrgsPerOwnerV2", () => {
      M.setMaxActiveDaoOrgsPerOwnerV2(25);
      expect(M.getMaxActiveDaoOrgsPerOwnerV2()).toBe(25);
    });
    it("setMaxPendingDaoProposalsPerOrgV2", () => {
      M.setMaxPendingDaoProposalsPerOrgV2(40);
      expect(M.getMaxPendingDaoProposalsPerOrgV2()).toBe(40);
    });
    it("setDaoOrgIdleMsV2", () => {
      M.setDaoOrgIdleMsV2(3600000);
      expect(M.getDaoOrgIdleMsV2()).toBe(3600000);
    });
    it("setDaoProposalStuckMsV2", () => {
      M.setDaoProposalStuckMsV2(60000);
      expect(M.getDaoProposalStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveDaoOrgsPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setDaoProposalStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingDaoProposalsPerOrgV2(8.7);
      expect(M.getMaxPendingDaoProposalsPerOrgV2()).toBe(8);
    });
  });

  describe("org lifecycle", () => {
    it("register", () => {
      const o = M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      expect(o.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      const o = M.activateDaoOrgV2("o1");
      expect(o.status).toBe("active");
      expect(o.activatedAt).toBeTruthy();
    });
    it("pause active→paused", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      M.activateDaoOrgV2("o1");
      expect(M.pauseDaoOrgV2("o1").status).toBe("paused");
    });
    it("recovery paused→active preserves activatedAt", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      const o = M.activateDaoOrgV2("o1");
      M.pauseDaoOrgV2("o1");
      const re = M.activateDaoOrgV2("o1");
      expect(re.activatedAt).toBe(o.activatedAt);
    });
    it("dissolve terminal stamps dissolvedAt", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      M.activateDaoOrgV2("o1");
      const o = M.dissolveDaoOrgV2("o1");
      expect(o.status).toBe("dissolved");
      expect(o.dissolvedAt).toBeTruthy();
    });
    it("cannot touch dissolved", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      M.activateDaoOrgV2("o1");
      M.dissolveDaoOrgV2("o1");
      expect(() => M.touchDaoOrgV2("o1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      expect(() => M.pauseDaoOrgV2("o1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "alice" });
      expect(() => M.registerDaoOrgV2({ id: "o1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerDaoOrgV2({ id: "o1" })).toThrow());
    it("list all", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "a" });
      M.registerDaoOrgV2({ id: "o2", owner: "b" });
      expect(M.listDaoOrgsV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getDaoOrgV2("none")).toBeNull());
    it("defensive copy metadata", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "a", metadata: { k: 5 } });
      const o = M.getDaoOrgV2("o1");
      o.metadata.k = 99;
      expect(M.getDaoOrgV2("o1").metadata.k).toBe(5);
    });
    it("default name = id", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "a" });
      expect(M.getDaoOrgV2("o1").name).toBe("o1");
    });
    it("name preserved", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "a", name: "Foo DAO" });
      expect(M.getDaoOrgV2("o1").name).toBe("Foo DAO");
    });
  });

  describe("active-org cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveDaoOrgsPerOwnerV2(2);
      ["o1", "o2", "o3"].forEach((id) =>
        M.registerDaoOrgV2({ id, owner: "o" }),
      );
      M.activateDaoOrgV2("o1");
      M.activateDaoOrgV2("o2");
      expect(() => M.activateDaoOrgV2("o3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDaoOrgsPerOwnerV2(2);
      ["o1", "o2", "o3"].forEach((id) =>
        M.registerDaoOrgV2({ id, owner: "o" }),
      );
      M.activateDaoOrgV2("o1");
      M.activateDaoOrgV2("o2");
      M.pauseDaoOrgV2("o1");
      M.activateDaoOrgV2("o3");
      expect(() => M.activateDaoOrgV2("o1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveDaoOrgsPerOwnerV2(1);
      M.registerDaoOrgV2({ id: "o1", owner: "a" });
      M.registerDaoOrgV2({ id: "o2", owner: "b" });
      M.activateDaoOrgV2("o1");
      expect(() => M.activateDaoOrgV2("o2")).not.toThrow();
    });
  });

  describe("proposal lifecycle", () => {
    beforeEach(() => {
      M.registerDaoOrgV2({ id: "o1", owner: "o" });
      M.activateDaoOrgV2("o1");
    });
    it("create→start→pass", () => {
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      M.startDaoProposalV2("p1");
      const p = M.passDaoProposalV2("p1");
      expect(p.status).toBe("passed");
    });
    it("fail stores reason", () => {
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      M.startDaoProposalV2("p1");
      const p = M.failDaoProposalV2("p1", "err");
      expect(p.metadata.failReason).toBe("err");
    });
    it("cancel queued", () => {
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      expect(M.cancelDaoProposalV2("p1").status).toBe("cancelled");
    });
    it("cannot pass from queued", () => {
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      expect(() => M.passDaoProposalV2("p1")).toThrow();
    });
    it("unknown org rejected", () =>
      expect(() =>
        M.createDaoProposalV2({ id: "p1", orgId: "none" }),
      ).toThrow());
    it("per-org pending cap", () => {
      M.setMaxPendingDaoProposalsPerOrgV2(2);
      ["p1", "p2"].forEach((id) => M.createDaoProposalV2({ id, orgId: "o1" }));
      expect(() => M.createDaoProposalV2({ id: "p3", orgId: "o1" })).toThrow(
        /max pending/,
      );
    });
    it("voting counts as pending", () => {
      M.setMaxPendingDaoProposalsPerOrgV2(1);
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      M.startDaoProposalV2("p1");
      expect(() => M.createDaoProposalV2({ id: "p2", orgId: "o1" })).toThrow();
    });
    it("passed frees slot", () => {
      M.setMaxPendingDaoProposalsPerOrgV2(1);
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      M.startDaoProposalV2("p1");
      M.passDaoProposalV2("p1");
      expect(() =>
        M.createDaoProposalV2({ id: "p2", orgId: "o1" }),
      ).not.toThrow();
    });
    it("default title = id", () => {
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      expect(M.getDaoProposalV2("p1").title).toBe("p1");
    });
    it("title preserved", () => {
      M.createDaoProposalV2({ id: "p1", orgId: "o1", title: "Budget" });
      expect(M.getDaoProposalV2("p1").title).toBe("Budget");
    });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => {
      M.setDaoOrgIdleMsV2(1000);
      M.registerDaoOrgV2({ id: "o1", owner: "o" });
      M.activateDaoOrgV2("o1");
      const r = M.autoPauseIdleDaoOrgsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDaoOrgV2("o1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "o" });
      M.activateDaoOrgV2("o1");
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      M.startDaoProposalV2("p1");
      M.setDaoProposalStuckMsV2(100);
      const r = M.autoFailStuckDaoProposalsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDaoProposalV2("p1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getDaoGovernanceGovStatsV2();
      expect(s.orgsByStatus.pending).toBe(0);
      expect(s.proposalsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDaoOrgV2({ id: "o1", owner: "o" });
      M.activateDaoOrgV2("o1");
      M.createDaoProposalV2({ id: "p1", orgId: "o1" });
      const s = M.getDaoGovernanceGovStatsV2();
      expect(s.totalOrgsV2).toBe(1);
      expect(s.totalProposalsV2).toBe(1);
    });
  });
});
