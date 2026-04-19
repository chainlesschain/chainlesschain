import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cross-chain.js";

describe("Crchgov V2 Surface", () => {
  beforeEach(() => M._resetStateCrchgovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CRCHGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CRCHGOV_TRANSFER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CRCHGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CRCHGOV_TRANSFER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCrchProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCrchProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCrchTransfersPerProfileV2(33);
      expect(M.getMaxPendingCrchTransfersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCrchProfileIdleMsV2(60000);
      expect(M.getCrchProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCrchTransferStuckMsV2(45000);
      expect(M.getCrchTransferStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCrchProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCrchTransferStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCrchProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCrchProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCrchProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default bridge", () =>
      expect(M.registerCrchProfileV2({ id: "p1", owner: "a" }).bridge).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCrchProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
      expect(M.staleCrchProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCrchProfileV2("p1");
      M.staleCrchProfileV2("p1");
      expect(M.activateCrchProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
      expect(M.archiveCrchProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
      M.archiveCrchProfileV2("p1");
      expect(() => M.touchCrchProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCrchProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerCrchProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCrchProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCrchProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.registerCrchProfileV2({ id: "p2", owner: "b" });
      expect(M.listCrchProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCrchProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCrchProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCrchProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCrchProfileV2({ id, owner: "a" }),
      );
      M.activateCrchProfileV2("p1");
      M.activateCrchProfileV2("p2");
      expect(() => M.activateCrchProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCrchProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCrchProfileV2({ id, owner: "a" }),
      );
      M.activateCrchProfileV2("p1");
      M.activateCrchProfileV2("p2");
      M.staleCrchProfileV2("p1");
      M.activateCrchProfileV2("p3");
      expect(() => M.activateCrchProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCrchProfilesPerOwnerV2(1);
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.registerCrchProfileV2({ id: "p2", owner: "b" });
      M.activateCrchProfileV2("p1");
      expect(() => M.activateCrchProfileV2("p2")).not.toThrow();
    });
  });

  describe("transfer lifecycle", () => {
    beforeEach(() => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
    });
    it("create→transferring→complete", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      M.transferringCrchTransferV2("r1");
      const r = M.completeTransferCrchV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      M.transferringCrchTransferV2("r1");
      expect(M.failCrchTransferV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCrchTransferV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTransferCrchV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCrchTransferV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCrchTransfersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCrchTransferV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCrchTransferV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("transferring counts as pending", () => {
      M.setMaxPendingCrchTransfersPerProfileV2(1);
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      M.transferringCrchTransferV2("r1");
      expect(() =>
        M.createCrchTransferV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCrchTransfersPerProfileV2(1);
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      M.transferringCrchTransferV2("r1");
      M.completeTransferCrchV2("r1");
      expect(() =>
        M.createCrchTransferV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCrchTransferV2("nope")).toBeNull());
    it("list", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      M.createCrchTransferV2({ id: "r2", profileId: "p1" });
      expect(M.listCrchTransfersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCrchTransferV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCrchTransferV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCrchTransferV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCrchProfileIdleMsV2(1000);
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
      const r = M.autoStaleIdleCrchProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCrchProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      M.transferringCrchTransferV2("r1");
      M.setCrchTransferStuckMsV2(100);
      const r = M.autoFailStuckCrchTransfersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCrchProfileIdleMsV2(1000);
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCrchProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCrchgovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.transfersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCrchProfileV2({ id: "p1", owner: "a" });
      M.activateCrchProfileV2("p1");
      M.createCrchTransferV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCrchgovStatsV2();
      expect(s2.totalCrchProfilesV2).toBe(1);
      expect(s2.totalCrchTransfersV2).toBe(1);
    });
  });
});
