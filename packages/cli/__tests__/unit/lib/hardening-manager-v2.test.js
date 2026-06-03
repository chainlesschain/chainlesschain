import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/hardening-manager.js";

describe("HardeningManager V2 Surface", () => {
  beforeEach(() => M._resetStateHardeningManagerV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.HARDGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.HARDGOV_SCAN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.HARDGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.HARDGOV_SCAN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveHardgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveHardgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingHardgovScansPerProfileV2(33);
      expect(M.getMaxPendingHardgovScansPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setHardgovProfileIdleMsV2(60000);
      expect(M.getHardgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setHardgovScanStuckMsV2(45000);
      expect(M.getHardgovScanStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveHardgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setHardgovScanStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveHardgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveHardgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerHardgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default category", () =>
      expect(
        M.registerHardgovProfileV2({ id: "p1", owner: "a" }).category,
      ).toBe("system"));
    it("activate", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateHardgovProfileV2("p1").status).toBe("active");
    });
    it("disable", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
      expect(M.disableHardgovProfileV2("p1").status).toBe("disabled");
    });
    it("recovery preserves activatedAt", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateHardgovProfileV2("p1");
      M.disableHardgovProfileV2("p1");
      expect(M.activateHardgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
      expect(M.archiveHardgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
      M.archiveHardgovProfileV2("p1");
      expect(() => M.touchHardgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.disableHardgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerHardgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerHardgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getHardgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.registerHardgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listHardgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getHardgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getHardgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveHardgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHardgovProfileV2({ id, owner: "a" }),
      );
      M.activateHardgovProfileV2("p1");
      M.activateHardgovProfileV2("p2");
      expect(() => M.activateHardgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveHardgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHardgovProfileV2({ id, owner: "a" }),
      );
      M.activateHardgovProfileV2("p1");
      M.activateHardgovProfileV2("p2");
      M.disableHardgovProfileV2("p1");
      M.activateHardgovProfileV2("p3");
      expect(() => M.activateHardgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveHardgovProfilesPerOwnerV2(1);
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.registerHardgovProfileV2({ id: "p2", owner: "b" });
      M.activateHardgovProfileV2("p1");
      expect(() => M.activateHardgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("scan lifecycle", () => {
    beforeEach(() => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
    });
    it("create→scanning→complete", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningHardgovScanV2("r1");
      const r = M.completeScanHardgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningHardgovScanV2("r1");
      expect(M.failHardgovScanV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHardgovScanV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeScanHardgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createHardgovScanV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingHardgovScansPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createHardgovScanV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createHardgovScanV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("scanning counts as pending", () => {
      M.setMaxPendingHardgovScansPerProfileV2(1);
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningHardgovScanV2("r1");
      expect(() =>
        M.createHardgovScanV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingHardgovScansPerProfileV2(1);
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningHardgovScanV2("r1");
      M.completeScanHardgovV2("r1");
      expect(() =>
        M.createHardgovScanV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getHardgovScanV2("nope")).toBeNull());
    it("list", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      M.createHardgovScanV2({ id: "r2", profileId: "p1" });
      expect(M.listHardgovScansV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createHardgovScanV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createHardgovScanV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHardgovScanV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDisableIdle", () => {
      M.setHardgovProfileIdleMsV2(1000);
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
      const r = M.autoDisableIdleHardgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getHardgovProfileV2("p1").status).toBe("disabled");
    });
    it("autoFailStuck", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      M.scanningHardgovScanV2("r1");
      M.setHardgovScanStuckMsV2(100);
      const r = M.autoFailStuckHardgovScansV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setHardgovProfileIdleMsV2(1000);
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDisableIdleHardgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getHardeningManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.scansByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerHardgovProfileV2({ id: "p1", owner: "a" });
      M.activateHardgovProfileV2("p1");
      M.createHardgovScanV2({ id: "r1", profileId: "p1" });
      const s2 = M.getHardeningManagerGovStatsV2();
      expect(s2.totalHardgovProfilesV2).toBe(1);
      expect(s2.totalHardgovScansV2).toBe(1);
    });
  });
});
