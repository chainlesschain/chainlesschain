import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/compliance-manager.js";

describe("Cmpmgov V2 Surface", () => {
  beforeEach(() => M._resetStateCmpmgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CMPMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CMPMGOV_REPORT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CMPMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CMPMGOV_REPORT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCmpmProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCmpmProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCmpmReportsPerProfileV2(33);
      expect(M.getMaxPendingCmpmReportsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCmpmProfileIdleMsV2(60000);
      expect(M.getCmpmProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCmpmReportStuckMsV2(45000);
      expect(M.getCmpmReportStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCmpmProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCmpmReportStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCmpmProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCmpmProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCmpmProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default framework", () =>
      expect(M.registerCmpmProfileV2({ id: "p1", owner: "a" }).framework).toBe(
        "soc2",
      ));
    it("activate", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCmpmProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
      expect(M.staleCmpmProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCmpmProfileV2("p1");
      M.staleCmpmProfileV2("p1");
      expect(M.activateCmpmProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
      expect(M.archiveCmpmProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
      M.archiveCmpmProfileV2("p1");
      expect(() => M.touchCmpmProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCmpmProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerCmpmProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCmpmProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCmpmProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.registerCmpmProfileV2({ id: "p2", owner: "b" });
      expect(M.listCmpmProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCmpmProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCmpmProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCmpmProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCmpmProfileV2({ id, owner: "a" }),
      );
      M.activateCmpmProfileV2("p1");
      M.activateCmpmProfileV2("p2");
      expect(() => M.activateCmpmProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCmpmProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCmpmProfileV2({ id, owner: "a" }),
      );
      M.activateCmpmProfileV2("p1");
      M.activateCmpmProfileV2("p2");
      M.staleCmpmProfileV2("p1");
      M.activateCmpmProfileV2("p3");
      expect(() => M.activateCmpmProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCmpmProfilesPerOwnerV2(1);
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.registerCmpmProfileV2({ id: "p2", owner: "b" });
      M.activateCmpmProfileV2("p1");
      expect(() => M.activateCmpmProfileV2("p2")).not.toThrow();
    });
  });

  describe("report lifecycle", () => {
    beforeEach(() => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
    });
    it("create→reporting→complete", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      M.reportingCmpmReportV2("r1");
      const r = M.completeReportCmpmV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      M.reportingCmpmReportV2("r1");
      expect(M.failCmpmReportV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCmpmReportV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeReportCmpmV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCmpmReportV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCmpmReportsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCmpmReportV2({ id, profileId: "p1" }),
      );
      expect(() => M.createCmpmReportV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("reporting counts as pending", () => {
      M.setMaxPendingCmpmReportsPerProfileV2(1);
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      M.reportingCmpmReportV2("r1");
      expect(() =>
        M.createCmpmReportV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCmpmReportsPerProfileV2(1);
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      M.reportingCmpmReportV2("r1");
      M.completeReportCmpmV2("r1");
      expect(() =>
        M.createCmpmReportV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCmpmReportV2("nope")).toBeNull());
    it("list", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      M.createCmpmReportV2({ id: "r2", profileId: "p1" });
      expect(M.listCmpmReportsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCmpmReportV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCmpmReportV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCmpmReportV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCmpmProfileIdleMsV2(1000);
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
      const r = M.autoStaleIdleCmpmProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCmpmProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      M.reportingCmpmReportV2("r1");
      M.setCmpmReportStuckMsV2(100);
      const r = M.autoFailStuckCmpmReportsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCmpmProfileIdleMsV2(1000);
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCmpmProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCmpmgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.reportsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCmpmProfileV2({ id: "p1", owner: "a" });
      M.activateCmpmProfileV2("p1");
      M.createCmpmReportV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCmpmgovStatsV2();
      expect(s2.totalCmpmProfilesV2).toBe(1);
      expect(s2.totalCmpmReportsV2).toBe(1);
    });
  });
});
