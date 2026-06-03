import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/plugin-autodiscovery.js";

describe("PluginAutodiscoveryGov V2 Surface", () => {
  beforeEach(() => M._resetStatePluginAutodiscoveryGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PADGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PADGOV_SCAN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PADGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PADGOV_SCAN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePadgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePadgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPadgovScansPerProfileV2(33);
      expect(M.getMaxPendingPadgovScansPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPadgovProfileIdleMsV2(60000);
      expect(M.getPadgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPadgovScanStuckMsV2(45000);
      expect(M.getPadgovScanStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePadgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPadgovScanStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePadgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePadgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPadgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default root", () =>
      expect(M.registerPadgovProfileV2({ id: "p1", owner: "a" }).root).toBe(
        ".chainlesschain",
      ));
    it("activate", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePadgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
      expect(M.stalePadgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePadgovProfileV2("p1");
      M.stalePadgovProfileV2("p1");
      expect(M.activatePadgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
      expect(M.archivePadgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
      M.archivePadgovProfileV2("p1");
      expect(() => M.touchPadgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.stalePadgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPadgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPadgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPadgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.registerPadgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPadgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPadgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPadgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePadgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPadgovProfileV2({ id, owner: "a" }),
      );
      M.activatePadgovProfileV2("p1");
      M.activatePadgovProfileV2("p2");
      expect(() => M.activatePadgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePadgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPadgovProfileV2({ id, owner: "a" }),
      );
      M.activatePadgovProfileV2("p1");
      M.activatePadgovProfileV2("p2");
      M.stalePadgovProfileV2("p1");
      M.activatePadgovProfileV2("p3");
      expect(() => M.activatePadgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePadgovProfilesPerOwnerV2(1);
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.registerPadgovProfileV2({ id: "p2", owner: "b" });
      M.activatePadgovProfileV2("p1");
      expect(() => M.activatePadgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("scan lifecycle", () => {
    beforeEach(() => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
    });
    it("create→scanning→complete", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningPadgovScanV2("r1");
      const r = M.completeScanPadgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningPadgovScanV2("r1");
      expect(M.failPadgovScanV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPadgovScanV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeScanPadgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPadgovScanV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPadgovScansPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPadgovScanV2({ id, profileId: "p1" }),
      );
      expect(() => M.createPadgovScanV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("scanning counts as pending", () => {
      M.setMaxPendingPadgovScansPerProfileV2(1);
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningPadgovScanV2("r1");
      expect(() =>
        M.createPadgovScanV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPadgovScansPerProfileV2(1);
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningPadgovScanV2("r1");
      M.completeScanPadgovV2("r1");
      expect(() =>
        M.createPadgovScanV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPadgovScanV2("nope")).toBeNull());
    it("list", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      M.createPadgovScanV2({ id: "r2", profileId: "p1" });
      expect(M.listPadgovScansV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPadgovScanV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPadgovScanV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPadgovScanV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setPadgovProfileIdleMsV2(1000);
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
      const r = M.autoStaleIdlePadgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPadgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningPadgovScanV2("r1");
      M.setPadgovScanStuckMsV2(100);
      const r = M.autoFailStuckPadgovScansV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPadgovProfileIdleMsV2(1000);
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdlePadgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPluginAutodiscoveryGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.scansByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPadgovProfileV2({ id: "p1", owner: "a" });
      M.activatePadgovProfileV2("p1");
      M.createPadgovScanV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPluginAutodiscoveryGovStatsV2();
      expect(s2.totalPadgovProfilesV2).toBe(1);
      expect(s2.totalPadgovScansV2).toBe(1);
    });
  });
});
