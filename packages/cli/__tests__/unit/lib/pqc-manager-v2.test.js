import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/pqc-manager.js";

describe("PqcManager V2 Surface", () => {
  beforeEach(() => M._resetStatePqcManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.PQCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.PQCGOV_KEYGEN_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.PQCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.PQCGOV_KEYGEN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActivePqcgovProfilesPerOwnerV2(11);
      expect(M.getMaxActivePqcgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingPqcgovKeygensPerProfileV2(33);
      expect(M.getMaxPendingPqcgovKeygensPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setPqcgovProfileIdleMsV2(60000);
      expect(M.getPqcgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setPqcgovKeygenStuckMsV2(45000);
      expect(M.getPqcgovKeygenStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActivePqcgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setPqcgovKeygenStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActivePqcgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActivePqcgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerPqcgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default algorithm", () =>
      expect(
        M.registerPqcgovProfileV2({ id: "p1", owner: "a" }).algorithm,
      ).toBe("kyber"));
    it("activate", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activatePqcgovProfileV2("p1").status).toBe("active");
    });
    it("deprecate", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
      expect(M.deprecatePqcgovProfileV2("p1").status).toBe("deprecated");
    });
    it("recovery preserves activatedAt", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activatePqcgovProfileV2("p1");
      M.deprecatePqcgovProfileV2("p1");
      expect(M.activatePqcgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
      expect(M.archivePqcgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
      M.archivePqcgovProfileV2("p1");
      expect(() => M.touchPqcgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.deprecatePqcgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerPqcgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerPqcgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getPqcgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.registerPqcgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listPqcgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getPqcgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getPqcgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActivePqcgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPqcgovProfileV2({ id, owner: "a" }),
      );
      M.activatePqcgovProfileV2("p1");
      M.activatePqcgovProfileV2("p2");
      expect(() => M.activatePqcgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActivePqcgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerPqcgovProfileV2({ id, owner: "a" }),
      );
      M.activatePqcgovProfileV2("p1");
      M.activatePqcgovProfileV2("p2");
      M.deprecatePqcgovProfileV2("p1");
      M.activatePqcgovProfileV2("p3");
      expect(() => M.activatePqcgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActivePqcgovProfilesPerOwnerV2(1);
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.registerPqcgovProfileV2({ id: "p2", owner: "b" });
      M.activatePqcgovProfileV2("p1");
      expect(() => M.activatePqcgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("keygen lifecycle", () => {
    beforeEach(() => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
    });
    it("create→generating→complete", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      M.generatingPqcgovKeygenV2("r1");
      const r = M.completeKeygenPqcgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      M.generatingPqcgovKeygenV2("r1");
      expect(M.failPqcgovKeygenV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPqcgovKeygenV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeKeygenPqcgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createPqcgovKeygenV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingPqcgovKeygensPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createPqcgovKeygenV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createPqcgovKeygenV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("generating counts as pending", () => {
      M.setMaxPendingPqcgovKeygensPerProfileV2(1);
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      M.generatingPqcgovKeygenV2("r1");
      expect(() =>
        M.createPqcgovKeygenV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingPqcgovKeygensPerProfileV2(1);
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      M.generatingPqcgovKeygenV2("r1");
      M.completeKeygenPqcgovV2("r1");
      expect(() =>
        M.createPqcgovKeygenV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getPqcgovKeygenV2("nope")).toBeNull());
    it("list", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      M.createPqcgovKeygenV2({ id: "r2", profileId: "p1" });
      expect(M.listPqcgovKeygensV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createPqcgovKeygenV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      expect(M.cancelPqcgovKeygenV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoDeprecateIdle", () => {
      M.setPqcgovProfileIdleMsV2(1000);
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
      const r = M.autoDeprecateIdlePqcgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getPqcgovProfileV2("p1").status).toBe("deprecated");
    });
    it("autoFailStuck", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      M.generatingPqcgovKeygenV2("r1");
      M.setPqcgovKeygenStuckMsV2(100);
      const r = M.autoFailStuckPqcgovKeygensV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setPqcgovProfileIdleMsV2(1000);
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDeprecateIdlePqcgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getPqcManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.keygensByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerPqcgovProfileV2({ id: "p1", owner: "a" });
      M.activatePqcgovProfileV2("p1");
      M.createPqcgovKeygenV2({ id: "r1", profileId: "p1" });
      const s2 = M.getPqcManagerGovStatsV2();
      expect(s2.totalPqcgovProfilesV2).toBe(1);
      expect(s2.totalPqcgovKeygensV2).toBe(1);
    });
  });
});
