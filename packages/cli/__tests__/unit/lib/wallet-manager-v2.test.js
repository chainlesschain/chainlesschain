import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/wallet-manager.js";

describe("WalletManager V2 Surface", () => {
  beforeEach(() => M._resetStateWalletManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.WALGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.WALGOV_TRANSFER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.WALGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.WALGOV_TRANSFER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveWalgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveWalgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingWalgovTransfersPerProfileV2(33);
      expect(M.getMaxPendingWalgovTransfersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setWalgovProfileIdleMsV2(60000);
      expect(M.getWalgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setWalgovTransferStuckMsV2(45000);
      expect(M.getWalgovTransferStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveWalgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setWalgovTransferStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveWalgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveWalgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerWalgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default chain", () =>
      expect(M.registerWalgovProfileV2({ id: "p1", owner: "a" }).chain).toBe(
        "mainnet",
      ));
    it("activate", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateWalgovProfileV2("p1").status).toBe("active");
    });
    it("freeze", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
      expect(M.freezeWalgovProfileV2("p1").status).toBe("frozen");
    });
    it("recovery preserves activatedAt", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateWalgovProfileV2("p1");
      M.freezeWalgovProfileV2("p1");
      expect(M.activateWalgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
      expect(M.archiveWalgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
      M.archiveWalgovProfileV2("p1");
      expect(() => M.touchWalgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.freezeWalgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerWalgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerWalgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getWalgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.registerWalgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listWalgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getWalgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getWalgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveWalgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWalgovProfileV2({ id, owner: "a" }),
      );
      M.activateWalgovProfileV2("p1");
      M.activateWalgovProfileV2("p2");
      expect(() => M.activateWalgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveWalgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWalgovProfileV2({ id, owner: "a" }),
      );
      M.activateWalgovProfileV2("p1");
      M.activateWalgovProfileV2("p2");
      M.freezeWalgovProfileV2("p1");
      M.activateWalgovProfileV2("p3");
      expect(() => M.activateWalgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveWalgovProfilesPerOwnerV2(1);
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.registerWalgovProfileV2({ id: "p2", owner: "b" });
      M.activateWalgovProfileV2("p1");
      expect(() => M.activateWalgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("transfer lifecycle", () => {
    beforeEach(() => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
    });
    it("create→signing→complete", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      M.signingWalgovTransferV2("r1");
      const r = M.completeTransferWalgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      M.signingWalgovTransferV2("r1");
      expect(M.failWalgovTransferV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWalgovTransferV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTransferWalgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createWalgovTransferV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingWalgovTransfersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createWalgovTransferV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createWalgovTransferV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("signing counts as pending", () => {
      M.setMaxPendingWalgovTransfersPerProfileV2(1);
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      M.signingWalgovTransferV2("r1");
      expect(() =>
        M.createWalgovTransferV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingWalgovTransfersPerProfileV2(1);
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      M.signingWalgovTransferV2("r1");
      M.completeTransferWalgovV2("r1");
      expect(() =>
        M.createWalgovTransferV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getWalgovTransferV2("nope")).toBeNull());
    it("list", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      M.createWalgovTransferV2({ id: "r2", profileId: "p1" });
      expect(M.listWalgovTransfersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createWalgovTransferV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createWalgovTransferV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWalgovTransferV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoFreezeIdle", () => {
      M.setWalgovProfileIdleMsV2(1000);
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
      const r = M.autoFreezeIdleWalgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getWalgovProfileV2("p1").status).toBe("frozen");
    });
    it("autoFailStuck", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      M.signingWalgovTransferV2("r1");
      M.setWalgovTransferStuckMsV2(100);
      const r = M.autoFailStuckWalgovTransfersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setWalgovProfileIdleMsV2(1000);
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoFreezeIdleWalgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getWalletManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.transfersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerWalgovProfileV2({ id: "p1", owner: "a" });
      M.activateWalgovProfileV2("p1");
      M.createWalgovTransferV2({ id: "r1", profileId: "p1" });
      const s2 = M.getWalletManagerGovStatsV2();
      expect(s2.totalWalgovProfilesV2).toBe(1);
      expect(s2.totalWalgovTransfersV2).toBe(1);
    });
  });
});
