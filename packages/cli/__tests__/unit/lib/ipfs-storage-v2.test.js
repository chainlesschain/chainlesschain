import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/ipfs-storage.js";

describe("IpfsStorage V2 Surface", () => {
  beforeEach(() => M._resetStateIpfsStorageGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.IPFSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.IPFSGOV_PIN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.IPFSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.IPFSGOV_PIN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveIpfsgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveIpfsgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingIpfsgovPinsPerProfileV2(33);
      expect(M.getMaxPendingIpfsgovPinsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setIpfsgovProfileIdleMsV2(60000);
      expect(M.getIpfsgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setIpfsgovPinStuckMsV2(45000);
      expect(M.getIpfsgovPinStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveIpfsgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setIpfsgovPinStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveIpfsgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveIpfsgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerIpfsgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default mode", () =>
      expect(M.registerIpfsgovProfileV2({ id: "p1", owner: "a" }).mode).toBe(
        "local",
      ));
    it("activate", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateIpfsgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
      expect(M.staleIpfsgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateIpfsgovProfileV2("p1");
      M.staleIpfsgovProfileV2("p1");
      expect(M.activateIpfsgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
      expect(M.archiveIpfsgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
      M.archiveIpfsgovProfileV2("p1");
      expect(() => M.touchIpfsgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleIpfsgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerIpfsgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerIpfsgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getIpfsgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.registerIpfsgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listIpfsgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getIpfsgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getIpfsgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveIpfsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerIpfsgovProfileV2({ id, owner: "a" }),
      );
      M.activateIpfsgovProfileV2("p1");
      M.activateIpfsgovProfileV2("p2");
      expect(() => M.activateIpfsgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveIpfsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerIpfsgovProfileV2({ id, owner: "a" }),
      );
      M.activateIpfsgovProfileV2("p1");
      M.activateIpfsgovProfileV2("p2");
      M.staleIpfsgovProfileV2("p1");
      M.activateIpfsgovProfileV2("p3");
      expect(() => M.activateIpfsgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveIpfsgovProfilesPerOwnerV2(1);
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.registerIpfsgovProfileV2({ id: "p2", owner: "b" });
      M.activateIpfsgovProfileV2("p1");
      expect(() => M.activateIpfsgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("pin lifecycle", () => {
    beforeEach(() => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
    });
    it("create→pinning→complete", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningIpfsgovPinV2("r1");
      const r = M.completePinIpfsgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningIpfsgovPinV2("r1");
      expect(M.failIpfsgovPinV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      expect(M.cancelIpfsgovPinV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePinIpfsgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createIpfsgovPinV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingIpfsgovPinsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createIpfsgovPinV2({ id, profileId: "p1" }),
      );
      expect(() => M.createIpfsgovPinV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("pinning counts as pending", () => {
      M.setMaxPendingIpfsgovPinsPerProfileV2(1);
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningIpfsgovPinV2("r1");
      expect(() =>
        M.createIpfsgovPinV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingIpfsgovPinsPerProfileV2(1);
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningIpfsgovPinV2("r1");
      M.completePinIpfsgovV2("r1");
      expect(() =>
        M.createIpfsgovPinV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getIpfsgovPinV2("nope")).toBeNull());
    it("list", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      M.createIpfsgovPinV2({ id: "r2", profileId: "p1" });
      expect(M.listIpfsgovPinsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createIpfsgovPinV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createIpfsgovPinV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      expect(M.cancelIpfsgovPinV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setIpfsgovProfileIdleMsV2(1000);
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
      const r = M.autoStaleIdleIpfsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getIpfsgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningIpfsgovPinV2("r1");
      M.setIpfsgovPinStuckMsV2(100);
      const r = M.autoFailStuckIpfsgovPinsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setIpfsgovProfileIdleMsV2(1000);
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleIpfsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getIpfsStorageGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.pinsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerIpfsgovProfileV2({ id: "p1", owner: "a" });
      M.activateIpfsgovProfileV2("p1");
      M.createIpfsgovPinV2({ id: "r1", profileId: "p1" });
      const s2 = M.getIpfsStorageGovStatsV2();
      expect(s2.totalIpfsgovProfilesV2).toBe(1);
      expect(s2.totalIpfsgovPinsV2).toBe(1);
    });
  });
});
