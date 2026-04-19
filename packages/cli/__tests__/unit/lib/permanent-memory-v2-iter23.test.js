import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/permanent-memory.js";

describe("PermanentMemoryGov V2 Surface", () => {
  beforeEach(() => M._resetStatePermanentMemoryGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PMGOV_PIN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PMGOV_PIN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePmgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePmgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPmgovPinsPerProfileV2(33);
      expect(M.getMaxPendingPmgovPinsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPmgovProfileIdleMsV2(60000);
      expect(M.getPmgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPmgovPinStuckMsV2(45000);
      expect(M.getPmgovPinStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePmgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPmgovPinStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePmgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePmgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPmgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default bucket", () =>
      expect(M.registerPmgovProfileV2({ id: "p1", owner: "a" }).bucket).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePmgovProfileV2("p1").status).toBe("active");
    });
    it("dormant", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
      expect(M.dormantPmgovProfileV2("p1").status).toBe("dormant");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePmgovProfileV2("p1");
      M.dormantPmgovProfileV2("p1");
      expect(M.activatePmgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
      expect(M.archivePmgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
      M.archivePmgovProfileV2("p1");
      expect(() => M.touchPmgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.dormantPmgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPmgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPmgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPmgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.registerPmgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPmgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPmgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPmgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPmgovProfileV2({ id, owner: "a" }),
      );
      M.activatePmgovProfileV2("p1");
      M.activatePmgovProfileV2("p2");
      expect(() => M.activatePmgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPmgovProfileV2({ id, owner: "a" }),
      );
      M.activatePmgovProfileV2("p1");
      M.activatePmgovProfileV2("p2");
      M.dormantPmgovProfileV2("p1");
      M.activatePmgovProfileV2("p3");
      expect(() => M.activatePmgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePmgovProfilesPerOwnerV2(1);
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.registerPmgovProfileV2({ id: "p2", owner: "b" });
      M.activatePmgovProfileV2("p1");
      expect(() => M.activatePmgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("pin lifecycle", () => {
    beforeEach(() => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
    });
    it("create→pinning→complete", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningPmgovPinV2("r1");
      const r = M.completePinPmgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningPmgovPinV2("r1");
      expect(M.failPmgovPinV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPmgovPinV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      expect(() => M.completePinPmgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPmgovPinV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPmgovPinsPerProfileV2(2);
      ["r1", "r2"].forEach((id) => M.createPmgovPinV2({ id, profileId: "p1" }));
      expect(() => M.createPmgovPinV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("pinning counts as pending", () => {
      M.setMaxPendingPmgovPinsPerProfileV2(1);
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningPmgovPinV2("r1");
      expect(() => M.createPmgovPinV2({ id: "r2", profileId: "p1" })).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPmgovPinsPerProfileV2(1);
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningPmgovPinV2("r1");
      M.completePinPmgovV2("r1");
      expect(() =>
        M.createPmgovPinV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPmgovPinV2("nope")).toBeNull());
    it("list", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      M.createPmgovPinV2({ id: "r2", profileId: "p1" });
      expect(M.listPmgovPinsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPmgovPinV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      expect(() => M.createPmgovPinV2({ id: "r1", profileId: "p1" })).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPmgovPinV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDormantIdle", () => {
      M.setPmgovProfileIdleMsV2(1000);
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
      const r = M.autoDormantIdlePmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPmgovProfileV2("p1").status).toBe("dormant");
    });
    it("autoFailStuck", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      M.pinningPmgovPinV2("r1");
      M.setPmgovPinStuckMsV2(100);
      const r = M.autoFailStuckPmgovPinsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPmgovProfileIdleMsV2(1000);
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDormantIdlePmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPermanentMemoryGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.pinsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPmgovProfileV2({ id: "p1", owner: "a" });
      M.activatePmgovProfileV2("p1");
      M.createPmgovPinV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPermanentMemoryGovStatsV2();
      expect(s2.totalPmgovProfilesV2).toBe(1);
      expect(s2.totalPmgovPinsV2).toBe(1);
    });
  });
});
