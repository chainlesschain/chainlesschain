import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/decentral-infra.js";

describe("DecentralInfraGov V2 Surface", () => {
  beforeEach(() => M._resetStateDecentralInfraGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.DIGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.DIGOV_DEAL_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.DIGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.DIGOV_DEAL_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveDigovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveDigovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingDigovDealsPerProfileV2(33);
      expect(M.getMaxPendingDigovDealsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setDigovProfileIdleMsV2(60000);
      expect(M.getDigovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setDigovDealStuckMsV2(45000);
      expect(M.getDigovDealStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveDigovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setDigovDealStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveDigovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveDigovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerDigovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default region", () =>
      expect(M.registerDigovProfileV2({ id: "p1", owner: "a" }).region).toBe(
        "us-east",
      ));
    it("activate", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateDigovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
      expect(M.staleDigovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateDigovProfileV2("p1");
      M.staleDigovProfileV2("p1");
      expect(M.activateDigovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
      expect(M.archiveDigovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
      M.archiveDigovProfileV2("p1");
      expect(() => M.touchDigovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleDigovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerDigovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerDigovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getDigovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.registerDigovProfileV2({ id: "p2", owner: "b" });
      expect(M.listDigovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getDigovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getDigovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveDigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDigovProfileV2({ id, owner: "a" }),
      );
      M.activateDigovProfileV2("p1");
      M.activateDigovProfileV2("p2");
      expect(() => M.activateDigovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveDigovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerDigovProfileV2({ id, owner: "a" }),
      );
      M.activateDigovProfileV2("p1");
      M.activateDigovProfileV2("p2");
      M.staleDigovProfileV2("p1");
      M.activateDigovProfileV2("p3");
      expect(() => M.activateDigovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveDigovProfilesPerOwnerV2(1);
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.registerDigovProfileV2({ id: "p2", owner: "b" });
      M.activateDigovProfileV2("p1");
      expect(() => M.activateDigovProfileV2("p2")).not.toThrow();
    });
  });

  describe("deal lifecycle", () => {
    beforeEach(() => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
    });
    it("create→negotiating→complete", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      M.negotiatingDigovDealV2("r1");
      const r = M.completeDealDigovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      M.negotiatingDigovDealV2("r1");
      expect(M.failDigovDealV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDigovDealV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeDealDigovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createDigovDealV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingDigovDealsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createDigovDealV2({ id, profileId: "p1" }),
      );
      expect(() => M.createDigovDealV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("negotiating counts as pending", () => {
      M.setMaxPendingDigovDealsPerProfileV2(1);
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      M.negotiatingDigovDealV2("r1");
      expect(() =>
        M.createDigovDealV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingDigovDealsPerProfileV2(1);
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      M.negotiatingDigovDealV2("r1");
      M.completeDealDigovV2("r1");
      expect(() =>
        M.createDigovDealV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getDigovDealV2("nope")).toBeNull());
    it("list", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      M.createDigovDealV2({ id: "r2", profileId: "p1" });
      expect(M.listDigovDealsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createDigovDealV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createDigovDealV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      expect(M.cancelDigovDealV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setDigovProfileIdleMsV2(1000);
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
      const r = M.autoStaleIdleDigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getDigovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      M.negotiatingDigovDealV2("r1");
      M.setDigovDealStuckMsV2(100);
      const r = M.autoFailStuckDigovDealsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setDigovProfileIdleMsV2(1000);
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleDigovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getDecentralInfraGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.dealsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerDigovProfileV2({ id: "p1", owner: "a" });
      M.activateDigovProfileV2("p1");
      M.createDigovDealV2({ id: "r1", profileId: "p1" });
      const s2 = M.getDecentralInfraGovStatsV2();
      expect(s2.totalDigovProfilesV2).toBe(1);
      expect(s2.totalDigovDealsV2).toBe(1);
    });
  });
});
