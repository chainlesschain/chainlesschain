import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-template-marketplace.js";

describe("CoworkTemplateMarketplaceGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkTemplateMarketplaceGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CTMGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CTMGOV_ORDER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CTMGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CTMGOV_ORDER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCtmgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCtmgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCtmgovOrdersPerProfileV2(33);
      expect(M.getMaxPendingCtmgovOrdersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCtmgovProfileIdleMsV2(60000);
      expect(M.getCtmgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCtmgovOrderStuckMsV2(45000);
      expect(M.getCtmgovOrderStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCtmgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCtmgovOrderStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCtmgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCtmgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCtmgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default vendor", () =>
      expect(M.registerCtmgovProfileV2({ id: "p1", owner: "a" }).vendor).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCtmgovProfileV2("p1").status).toBe("active");
    });
    it("suspend", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
      expect(M.suspendCtmgovProfileV2("p1").status).toBe("suspended");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCtmgovProfileV2("p1");
      M.suspendCtmgovProfileV2("p1");
      expect(M.activateCtmgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
      expect(M.archiveCtmgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
      M.archiveCtmgovProfileV2("p1");
      expect(() => M.touchCtmgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.suspendCtmgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCtmgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCtmgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCtmgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.registerCtmgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCtmgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCtmgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCtmgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCtmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCtmgovProfileV2({ id, owner: "a" }),
      );
      M.activateCtmgovProfileV2("p1");
      M.activateCtmgovProfileV2("p2");
      expect(() => M.activateCtmgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCtmgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCtmgovProfileV2({ id, owner: "a" }),
      );
      M.activateCtmgovProfileV2("p1");
      M.activateCtmgovProfileV2("p2");
      M.suspendCtmgovProfileV2("p1");
      M.activateCtmgovProfileV2("p3");
      expect(() => M.activateCtmgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCtmgovProfilesPerOwnerV2(1);
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.registerCtmgovProfileV2({ id: "p2", owner: "b" });
      M.activateCtmgovProfileV2("p1");
      expect(() => M.activateCtmgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("order lifecycle", () => {
    beforeEach(() => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
    });
    it("create→fulfilling→complete", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      M.fulfillingCtmgovOrderV2("r1");
      const r = M.completeOrderCtmgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      M.fulfillingCtmgovOrderV2("r1");
      expect(M.failCtmgovOrderV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCtmgovOrderV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeOrderCtmgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCtmgovOrderV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCtmgovOrdersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCtmgovOrderV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCtmgovOrderV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("fulfilling counts as pending", () => {
      M.setMaxPendingCtmgovOrdersPerProfileV2(1);
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      M.fulfillingCtmgovOrderV2("r1");
      expect(() =>
        M.createCtmgovOrderV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCtmgovOrdersPerProfileV2(1);
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      M.fulfillingCtmgovOrderV2("r1");
      M.completeOrderCtmgovV2("r1");
      expect(() =>
        M.createCtmgovOrderV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCtmgovOrderV2("nope")).toBeNull());
    it("list", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      M.createCtmgovOrderV2({ id: "r2", profileId: "p1" });
      expect(M.listCtmgovOrdersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCtmgovOrderV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCtmgovOrderV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCtmgovOrderV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setCtmgovProfileIdleMsV2(1000);
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
      const r = M.autoSuspendIdleCtmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCtmgovProfileV2("p1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      M.fulfillingCtmgovOrderV2("r1");
      M.setCtmgovOrderStuckMsV2(100);
      const r = M.autoFailStuckCtmgovOrdersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCtmgovProfileIdleMsV2(1000);
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoSuspendIdleCtmgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkTemplateMarketplaceGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.ordersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCtmgovProfileV2({ id: "p1", owner: "a" });
      M.activateCtmgovProfileV2("p1");
      M.createCtmgovOrderV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkTemplateMarketplaceGovStatsV2();
      expect(s2.totalCtmgovProfilesV2).toBe(1);
      expect(s2.totalCtmgovOrdersV2).toBe(1);
    });
  });
});
