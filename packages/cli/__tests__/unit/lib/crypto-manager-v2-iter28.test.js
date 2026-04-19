import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/crypto-manager.js";

describe("Crygov V2 Surface", () => {
  beforeEach(() => M._resetStateCrygovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CRYGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CRYGOV_ENCRYPT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CRYGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CRYGOV_ENCRYPT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCryProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCryProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCryEncryptsPerProfileV2(33);
      expect(M.getMaxPendingCryEncryptsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCryProfileIdleMsV2(60000);
      expect(M.getCryProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCryEncryptStuckMsV2(45000);
      expect(M.getCryEncryptStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCryProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCryEncryptStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCryProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCryProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCryProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default provider", () =>
      expect(M.registerCryProfileV2({ id: "p1", owner: "a" }).provider).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCryProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
      expect(M.staleCryProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCryProfileV2("p1");
      M.staleCryProfileV2("p1");
      expect(M.activateCryProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
      expect(M.archiveCryProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
      M.archiveCryProfileV2("p1");
      expect(() => M.touchCryProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCryProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerCryProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCryProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCryProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.registerCryProfileV2({ id: "p2", owner: "b" });
      expect(M.listCryProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCryProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCryProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCryProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCryProfileV2({ id, owner: "a" }),
      );
      M.activateCryProfileV2("p1");
      M.activateCryProfileV2("p2");
      expect(() => M.activateCryProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCryProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCryProfileV2({ id, owner: "a" }),
      );
      M.activateCryProfileV2("p1");
      M.activateCryProfileV2("p2");
      M.staleCryProfileV2("p1");
      M.activateCryProfileV2("p3");
      expect(() => M.activateCryProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCryProfilesPerOwnerV2(1);
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.registerCryProfileV2({ id: "p2", owner: "b" });
      M.activateCryProfileV2("p1");
      expect(() => M.activateCryProfileV2("p2")).not.toThrow();
    });
  });

  describe("encrypt lifecycle", () => {
    beforeEach(() => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
    });
    it("create→encrypting→complete", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      M.encryptingCryEncryptV2("r1");
      const r = M.completeEncryptCryV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      M.encryptingCryEncryptV2("r1");
      expect(M.failCryEncryptV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCryEncryptV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeEncryptCryV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCryEncryptV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCryEncryptsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCryEncryptV2({ id, profileId: "p1" }),
      );
      expect(() => M.createCryEncryptV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("encrypting counts as pending", () => {
      M.setMaxPendingCryEncryptsPerProfileV2(1);
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      M.encryptingCryEncryptV2("r1");
      expect(() =>
        M.createCryEncryptV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCryEncryptsPerProfileV2(1);
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      M.encryptingCryEncryptV2("r1");
      M.completeEncryptCryV2("r1");
      expect(() =>
        M.createCryEncryptV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCryEncryptV2("nope")).toBeNull());
    it("list", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      M.createCryEncryptV2({ id: "r2", profileId: "p1" });
      expect(M.listCryEncryptsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCryEncryptV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCryEncryptV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCryEncryptV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCryProfileIdleMsV2(1000);
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
      const r = M.autoStaleIdleCryProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCryProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      M.encryptingCryEncryptV2("r1");
      M.setCryEncryptStuckMsV2(100);
      const r = M.autoFailStuckCryEncryptsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCryProfileIdleMsV2(1000);
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCryProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCrygovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.encryptsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCryProfileV2({ id: "p1", owner: "a" });
      M.activateCryProfileV2("p1");
      M.createCryEncryptV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCrygovStatsV2();
      expect(s2.totalCryProfilesV2).toBe(1);
      expect(s2.totalCryEncryptsV2).toBe(1);
    });
  });
});
