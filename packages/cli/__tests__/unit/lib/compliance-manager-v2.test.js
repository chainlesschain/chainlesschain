import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/compliance-manager.js";

describe("ComplianceManager V2 Surface", () => {
  beforeEach(() => M._resetStateComplianceManagerV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CMGR_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CMGR_AUDIT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CMGR_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CMGR_AUDIT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCmgrProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCmgrProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCmgrAuditsPerProfileV2(33);
      expect(M.getMaxPendingCmgrAuditsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCmgrProfileIdleMsV2(60000);
      expect(M.getCmgrProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCmgrAuditStuckMsV2(45000);
      expect(M.getCmgrAuditStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCmgrProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCmgrAuditStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCmgrProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCmgrProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCmgrProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default framework", () =>
      expect(M.registerCmgrProfileV2({ id: "p1", owner: "a" }).framework).toBe(
        "soc2",
      ));
    it("activate", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCmgrProfileV2("p1").status).toBe("active");
    });
    it("deprecate", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
      expect(M.deprecateCmgrProfileV2("p1").status).toBe("deprecated");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCmgrProfileV2("p1");
      M.deprecateCmgrProfileV2("p1");
      expect(M.activateCmgrProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
      expect(M.archiveCmgrProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
      M.archiveCmgrProfileV2("p1");
      expect(() => M.touchCmgrProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      expect(() => M.deprecateCmgrProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerCmgrProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCmgrProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCmgrProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.registerCmgrProfileV2({ id: "p2", owner: "b" });
      expect(M.listCmgrProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCmgrProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCmgrProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCmgrProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCmgrProfileV2({ id, owner: "a" }),
      );
      M.activateCmgrProfileV2("p1");
      M.activateCmgrProfileV2("p2");
      expect(() => M.activateCmgrProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCmgrProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCmgrProfileV2({ id, owner: "a" }),
      );
      M.activateCmgrProfileV2("p1");
      M.activateCmgrProfileV2("p2");
      M.deprecateCmgrProfileV2("p1");
      M.activateCmgrProfileV2("p3");
      expect(() => M.activateCmgrProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCmgrProfilesPerOwnerV2(1);
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.registerCmgrProfileV2({ id: "p2", owner: "b" });
      M.activateCmgrProfileV2("p1");
      expect(() => M.activateCmgrProfileV2("p2")).not.toThrow();
    });
  });

  describe("audit lifecycle", () => {
    beforeEach(() => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
    });
    it("create→auditing→complete", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      M.auditingCmgrAuditV2("r1");
      const r = M.completeAuditCmgrV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      M.auditingCmgrAuditV2("r1");
      expect(M.failCmgrAuditV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCmgrAuditV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeAuditCmgrV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCmgrAuditV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCmgrAuditsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCmgrAuditV2({ id, profileId: "p1" }),
      );
      expect(() => M.createCmgrAuditV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("auditing counts as pending", () => {
      M.setMaxPendingCmgrAuditsPerProfileV2(1);
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      M.auditingCmgrAuditV2("r1");
      expect(() =>
        M.createCmgrAuditV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCmgrAuditsPerProfileV2(1);
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      M.auditingCmgrAuditV2("r1");
      M.completeAuditCmgrV2("r1");
      expect(() =>
        M.createCmgrAuditV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCmgrAuditV2("nope")).toBeNull());
    it("list", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      M.createCmgrAuditV2({ id: "r2", profileId: "p1" });
      expect(M.listCmgrAuditsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCmgrAuditV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCmgrAuditV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCmgrAuditV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDeprecateIdle", () => {
      M.setCmgrProfileIdleMsV2(1000);
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
      const r = M.autoDeprecateIdleCmgrProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCmgrProfileV2("p1").status).toBe("deprecated");
    });
    it("autoFailStuck", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      M.auditingCmgrAuditV2("r1");
      M.setCmgrAuditStuckMsV2(100);
      const r = M.autoFailStuckCmgrAuditsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCmgrProfileIdleMsV2(1000);
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDeprecateIdleCmgrProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getComplianceManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.auditsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCmgrProfileV2({ id: "p1", owner: "a" });
      M.activateCmgrProfileV2("p1");
      M.createCmgrAuditV2({ id: "r1", profileId: "p1" });
      const s2 = M.getComplianceManagerGovStatsV2();
      expect(s2.totalCmgrProfilesV2).toBe(1);
      expect(s2.totalCmgrAuditsV2).toBe(1);
    });
  });
});
