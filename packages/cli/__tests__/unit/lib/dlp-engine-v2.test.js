import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/dlp-engine.js";

describe("DlpEngine V2 Surface", () => {
  beforeEach(() => M._resetStateDlpEngineGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DLPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DLPGOV_SCAN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DLPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DLPGOV_SCAN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDlpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDlpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDlpgovScansPerProfileV2(33);
      expect(M.getMaxPendingDlpgovScansPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDlpgovProfileIdleMsV2(60000);
      expect(M.getDlpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDlpgovScanStuckMsV2(45000);
      expect(M.getDlpgovScanStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDlpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDlpgovScanStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDlpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDlpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDlpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default classification", () =>
      expect(
        M.registerDlpgovProfileV2({ id: "p1", owner: "a" }).classification,
      ).toBe("internal"));
    it("activate", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDlpgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
      expect(M.suspendDlpgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDlpgovProfileV2("p1");
      M.suspendDlpgovProfileV2("p1");
      expect(M.activateDlpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
      expect(M.archiveDlpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
      M.archiveDlpgovProfileV2("p1");
      expect(() => M.touchDlpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendDlpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDlpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDlpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDlpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.registerDlpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listDlpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDlpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDlpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDlpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDlpgovProfileV2({ id, owner: "a" }),
      );
      M.activateDlpgovProfileV2("p1");
      M.activateDlpgovProfileV2("p2");
      expect(() => M.activateDlpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDlpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDlpgovProfileV2({ id, owner: "a" }),
      );
      M.activateDlpgovProfileV2("p1");
      M.activateDlpgovProfileV2("p2");
      M.suspendDlpgovProfileV2("p1");
      M.activateDlpgovProfileV2("p3");
      expect(() => M.activateDlpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDlpgovProfilesPerOwnerV2(1);
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.registerDlpgovProfileV2({ id: "p2", owner: "b" });
      M.activateDlpgovProfileV2("p1");
      expect(() => M.activateDlpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("scan lifecycle", () => {
    beforeEach(() => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
    });
    it("create→scanning→complete", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningDlpgovScanV2("r1");
      const r = M.completeScanDlpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningDlpgovScanV2("r1");
      expect(M.failDlpgovScanV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDlpgovScanV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeScanDlpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDlpgovScanV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDlpgovScansPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDlpgovScanV2({ id, profileId: "p1" }),
      );
      expect(() => M.createDlpgovScanV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("scanning counts as pending", () => {
      M.setMaxPendingDlpgovScansPerProfileV2(1);
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningDlpgovScanV2("r1");
      expect(() =>
        M.createDlpgovScanV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDlpgovScansPerProfileV2(1);
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningDlpgovScanV2("r1");
      M.completeScanDlpgovV2("r1");
      expect(() =>
        M.createDlpgovScanV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDlpgovScanV2("nope")).toBeNull());
    it("list", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      M.createDlpgovScanV2({ id: "r2", profileId: "p1" });
      expect(M.listDlpgovScansV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDlpgovScanV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDlpgovScanV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDlpgovScanV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setDlpgovProfileIdleMsV2(1000);
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
      const r = M.autoSuspendIdleDlpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDlpgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningDlpgovScanV2("r1");
      M.setDlpgovScanStuckMsV2(100);
      const r = M.autoFailStuckDlpgovScansV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDlpgovProfileIdleMsV2(1000);
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleDlpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDlpEngineGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.scansByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDlpgovProfileV2({ id: "p1", owner: "a" });
      M.activateDlpgovProfileV2("p1");
      M.createDlpgovScanV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDlpEngineGovStatsV2();
      expect(s2.totalDlpgovProfilesV2).toBe(1);
      expect(s2.totalDlpgovScansV2).toBe(1);
    });
  });
});
