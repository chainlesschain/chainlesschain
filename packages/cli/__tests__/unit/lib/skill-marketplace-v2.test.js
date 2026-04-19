import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/skill-marketplace.js";

describe("SkillMarketplace V2 Surface", () => {
  beforeEach(() => M._resetStateSkillMarketplaceV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.MKTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.MKTGOV_ORDER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.MKTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.MKTGOV_ORDER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveMktgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveMktgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingMktgovOrdersPerProfileV2(33);
      expect(M.getMaxPendingMktgovOrdersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setMktgovProfileIdleMsV2(60000);
      expect(M.getMktgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setMktgovOrderStuckMsV2(45000);
      expect(M.getMktgovOrderStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveMktgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setMktgovOrderStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveMktgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveMktgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerMktgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default category", () =>
      expect(M.registerMktgovProfileV2({ id: "p1", owner: "a" }).category).toBe(
        "general",
      ));
    it("activate", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateMktgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
      expect(M.suspendMktgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateMktgovProfileV2("p1");
      M.suspendMktgovProfileV2("p1");
      expect(M.activateMktgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
      expect(M.archiveMktgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
      M.archiveMktgovProfileV2("p1");
      expect(() => M.touchMktgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendMktgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerMktgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerMktgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getMktgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.registerMktgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listMktgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getMktgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getMktgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveMktgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMktgovProfileV2({ id, owner: "a" }),
      );
      M.activateMktgovProfileV2("p1");
      M.activateMktgovProfileV2("p2");
      expect(() => M.activateMktgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveMktgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerMktgovProfileV2({ id, owner: "a" }),
      );
      M.activateMktgovProfileV2("p1");
      M.activateMktgovProfileV2("p2");
      M.suspendMktgovProfileV2("p1");
      M.activateMktgovProfileV2("p3");
      expect(() => M.activateMktgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveMktgovProfilesPerOwnerV2(1);
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.registerMktgovProfileV2({ id: "p2", owner: "b" });
      M.activateMktgovProfileV2("p1");
      expect(() => M.activateMktgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("order lifecycle", () => {
    beforeEach(() => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
    });
    it("create→processing→complete", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      M.processingMktgovOrderV2("r1");
      const r = M.completeOrderMktgovV2("r1");
      expect(r.status).not.toBe("queued");
      expect(r.status).not.toBe("processing");
    });
    it("fail", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      M.processingMktgovOrderV2("r1");
      expect(M.failMktgovOrderV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMktgovOrderV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeOrderMktgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createMktgovOrderV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingMktgovOrdersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createMktgovOrderV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createMktgovOrderV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("processing counts as pending", () => {
      M.setMaxPendingMktgovOrdersPerProfileV2(1);
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      M.processingMktgovOrderV2("r1");
      expect(() =>
        M.createMktgovOrderV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingMktgovOrdersPerProfileV2(1);
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      M.processingMktgovOrderV2("r1");
      M.completeOrderMktgovV2("r1");
      expect(() =>
        M.createMktgovOrderV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getMktgovOrderV2("nope")).toBeNull());
    it("list", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      M.createMktgovOrderV2({ id: "r2", profileId: "p1" });
      expect(M.listMktgovOrdersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createMktgovOrderV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createMktgovOrderV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      expect(M.cancelMktgovOrderV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setMktgovProfileIdleMsV2(1000);
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
      const r = M.autoSuspendIdleMktgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getMktgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      M.processingMktgovOrderV2("r1");
      M.setMktgovOrderStuckMsV2(100);
      const r = M.autoFailStuckMktgovOrdersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setMktgovProfileIdleMsV2(1000);
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleMktgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getSkillMarketplaceGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.ordersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerMktgovProfileV2({ id: "p1", owner: "a" });
      M.activateMktgovProfileV2("p1");
      M.createMktgovOrderV2({ id: "r1", profileId: "p1" });
      const s2 = M.getSkillMarketplaceGovStatsV2();
      expect(s2.totalMktgovProfilesV2).toBe(1);
      expect(s2.totalMktgovOrdersV2).toBe(1);
    });
  });
});
