import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/tenant-saas.js";

describe("TenantSaas V2 Surface", () => {
  beforeEach(() => M._resetStateTenantSaasGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.TNSGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.TNSGOV_ALLOCATION_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.TNSGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.TNSGOV_ALLOCATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveTnsgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveTnsgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingTnsgovAllocationsPerProfileV2(33);
      expect(M.getMaxPendingTnsgovAllocationsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setTnsgovProfileIdleMsV2(60000);
      expect(M.getTnsgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setTnsgovAllocationStuckMsV2(45000);
      expect(M.getTnsgovAllocationStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveTnsgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setTnsgovAllocationStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveTnsgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveTnsgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerTnsgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default plan", () =>
      expect(M.registerTnsgovProfileV2({ id: "p1", owner: "a" }).plan).toBe(
        "free",
      ));
    it("activate", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateTnsgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
      expect(M.suspendTnsgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateTnsgovProfileV2("p1");
      M.suspendTnsgovProfileV2("p1");
      expect(M.activateTnsgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
      expect(M.archiveTnsgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
      M.archiveTnsgovProfileV2("p1");
      expect(() => M.touchTnsgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendTnsgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerTnsgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerTnsgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getTnsgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.registerTnsgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listTnsgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getTnsgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getTnsgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveTnsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTnsgovProfileV2({ id, owner: "a" }),
      );
      M.activateTnsgovProfileV2("p1");
      M.activateTnsgovProfileV2("p2");
      expect(() => M.activateTnsgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveTnsgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerTnsgovProfileV2({ id, owner: "a" }),
      );
      M.activateTnsgovProfileV2("p1");
      M.activateTnsgovProfileV2("p2");
      M.suspendTnsgovProfileV2("p1");
      M.activateTnsgovProfileV2("p3");
      expect(() => M.activateTnsgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveTnsgovProfilesPerOwnerV2(1);
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.registerTnsgovProfileV2({ id: "p2", owner: "b" });
      M.activateTnsgovProfileV2("p1");
      expect(() => M.activateTnsgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("allocation lifecycle", () => {
    beforeEach(() => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
    });
    it("create→provisioning→complete", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      M.provisioningTnsgovAllocationV2("r1");
      const r = M.completeAllocationTnsgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      M.provisioningTnsgovAllocationV2("r1");
      expect(M.failTnsgovAllocationV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTnsgovAllocationV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeAllocationTnsgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createTnsgovAllocationV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingTnsgovAllocationsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createTnsgovAllocationV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createTnsgovAllocationV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("provisioning counts as pending", () => {
      M.setMaxPendingTnsgovAllocationsPerProfileV2(1);
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      M.provisioningTnsgovAllocationV2("r1");
      expect(() =>
        M.createTnsgovAllocationV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingTnsgovAllocationsPerProfileV2(1);
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      M.provisioningTnsgovAllocationV2("r1");
      M.completeAllocationTnsgovV2("r1");
      expect(() =>
        M.createTnsgovAllocationV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getTnsgovAllocationV2("nope")).toBeNull());
    it("list", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      M.createTnsgovAllocationV2({ id: "r2", profileId: "p1" });
      expect(M.listTnsgovAllocationsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createTnsgovAllocationV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      expect(M.cancelTnsgovAllocationV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setTnsgovProfileIdleMsV2(1000);
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
      const r = M.autoSuspendIdleTnsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getTnsgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      M.provisioningTnsgovAllocationV2("r1");
      M.setTnsgovAllocationStuckMsV2(100);
      const r = M.autoFailStuckTnsgovAllocationsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setTnsgovProfileIdleMsV2(1000);
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleTnsgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getTenantSaasGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.allocationsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerTnsgovProfileV2({ id: "p1", owner: "a" });
      M.activateTnsgovProfileV2("p1");
      M.createTnsgovAllocationV2({ id: "r1", profileId: "p1" });
      const s2 = M.getTenantSaasGovStatsV2();
      expect(s2.totalTnsgovProfilesV2).toBe(1);
      expect(s2.totalTnsgovAllocationsV2).toBe(1);
    });
  });
});
