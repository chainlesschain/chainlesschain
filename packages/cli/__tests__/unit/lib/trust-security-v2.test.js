import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/trust-security.js";

describe("TrustSecurity V2 Surface", () => {
  beforeEach(() => M._resetStateTrustSecurityGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TRUSTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TRUSTGOV_CHECK_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TRUSTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TRUSTGOV_CHECK_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveTrustgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveTrustgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingTrustgovChecksPerProfileV2(33);
      expect(M.getMaxPendingTrustgovChecksPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setTrustgovProfileIdleMsV2(60000);
      expect(M.getTrustgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setTrustgovCheckStuckMsV2(45000);
      expect(M.getTrustgovCheckStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveTrustgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setTrustgovCheckStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveTrustgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveTrustgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerTrustgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default level", () =>
      expect(M.registerTrustgovProfileV2({ id: "p1", owner: "a" }).level).toBe(
        "medium",
      ));
    it("activate", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateTrustgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
      expect(M.suspendTrustgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateTrustgovProfileV2("p1");
      M.suspendTrustgovProfileV2("p1");
      expect(M.activateTrustgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
      expect(M.archiveTrustgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
      M.archiveTrustgovProfileV2("p1");
      expect(() => M.touchTrustgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendTrustgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerTrustgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerTrustgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getTrustgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.registerTrustgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listTrustgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getTrustgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getTrustgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveTrustgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTrustgovProfileV2({ id, owner: "a" }),
      );
      M.activateTrustgovProfileV2("p1");
      M.activateTrustgovProfileV2("p2");
      expect(() => M.activateTrustgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveTrustgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTrustgovProfileV2({ id, owner: "a" }),
      );
      M.activateTrustgovProfileV2("p1");
      M.activateTrustgovProfileV2("p2");
      M.suspendTrustgovProfileV2("p1");
      M.activateTrustgovProfileV2("p3");
      expect(() => M.activateTrustgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveTrustgovProfilesPerOwnerV2(1);
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.registerTrustgovProfileV2({ id: "p2", owner: "b" });
      M.activateTrustgovProfileV2("p1");
      expect(() => M.activateTrustgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("check lifecycle", () => {
    beforeEach(() => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
    });
    it("create→verifying→complete", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      M.verifyingTrustgovCheckV2("r1");
      const r = M.completeCheckTrustgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      M.verifyingTrustgovCheckV2("r1");
      expect(M.failTrustgovCheckV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTrustgovCheckV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeCheckTrustgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createTrustgovCheckV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingTrustgovChecksPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createTrustgovCheckV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createTrustgovCheckV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("verifying counts as pending", () => {
      M.setMaxPendingTrustgovChecksPerProfileV2(1);
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      M.verifyingTrustgovCheckV2("r1");
      expect(() =>
        M.createTrustgovCheckV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingTrustgovChecksPerProfileV2(1);
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      M.verifyingTrustgovCheckV2("r1");
      M.completeCheckTrustgovV2("r1");
      expect(() =>
        M.createTrustgovCheckV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getTrustgovCheckV2("nope")).toBeNull());
    it("list", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      M.createTrustgovCheckV2({ id: "r2", profileId: "p1" });
      expect(M.listTrustgovChecksV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createTrustgovCheckV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createTrustgovCheckV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTrustgovCheckV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setTrustgovProfileIdleMsV2(1000);
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
      const r = M.autoSuspendIdleTrustgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getTrustgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      M.verifyingTrustgovCheckV2("r1");
      M.setTrustgovCheckStuckMsV2(100);
      const r = M.autoFailStuckTrustgovChecksV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setTrustgovProfileIdleMsV2(1000);
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleTrustgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTrustSecurityGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.checksByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerTrustgovProfileV2({ id: "p1", owner: "a" });
      M.activateTrustgovProfileV2("p1");
      M.createTrustgovCheckV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTrustSecurityGovStatsV2();
      expect(s2.totalTrustgovProfilesV2).toBe(1);
      expect(s2.totalTrustgovChecksV2).toBe(1);
    });
  });
});
