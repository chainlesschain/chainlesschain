import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-adapter.js";

describe("CoworkAdapterGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkAdapterGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CADPGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CADPGOV_ADAPT_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CADPGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CADPGOV_ADAPT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCadpgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCadpgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCadpgovAdaptsPerProfileV2(33);
      expect(M.getMaxPendingCadpgovAdaptsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCadpgovProfileIdleMsV2(60000);
      expect(M.getCadpgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCadpgovAdaptStuckMsV2(45000);
      expect(M.getCadpgovAdaptStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCadpgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCadpgovAdaptStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCadpgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCadpgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCadpgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default target", () =>
      expect(M.registerCadpgovProfileV2({ id: "p1", owner: "a" }).target).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCadpgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
      expect(M.staleCadpgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCadpgovProfileV2("p1");
      M.staleCadpgovProfileV2("p1");
      expect(M.activateCadpgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
      expect(M.archiveCadpgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
      M.archiveCadpgovProfileV2("p1");
      expect(() => M.touchCadpgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCadpgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCadpgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCadpgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCadpgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.registerCadpgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCadpgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCadpgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCadpgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCadpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCadpgovProfileV2({ id, owner: "a" }),
      );
      M.activateCadpgovProfileV2("p1");
      M.activateCadpgovProfileV2("p2");
      expect(() => M.activateCadpgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCadpgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCadpgovProfileV2({ id, owner: "a" }),
      );
      M.activateCadpgovProfileV2("p1");
      M.activateCadpgovProfileV2("p2");
      M.staleCadpgovProfileV2("p1");
      M.activateCadpgovProfileV2("p3");
      expect(() => M.activateCadpgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCadpgovProfilesPerOwnerV2(1);
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.registerCadpgovProfileV2({ id: "p2", owner: "b" });
      M.activateCadpgovProfileV2("p1");
      expect(() => M.activateCadpgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("adapt lifecycle", () => {
    beforeEach(() => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
    });
    it("create→adapting→complete", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      M.adaptingCadpgovAdaptV2("r1");
      const r = M.completeAdaptCadpgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      M.adaptingCadpgovAdaptV2("r1");
      expect(M.failCadpgovAdaptV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCadpgovAdaptV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeAdaptCadpgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCadpgovAdaptV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCadpgovAdaptsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCadpgovAdaptV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCadpgovAdaptV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("adapting counts as pending", () => {
      M.setMaxPendingCadpgovAdaptsPerProfileV2(1);
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      M.adaptingCadpgovAdaptV2("r1");
      expect(() =>
        M.createCadpgovAdaptV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCadpgovAdaptsPerProfileV2(1);
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      M.adaptingCadpgovAdaptV2("r1");
      M.completeAdaptCadpgovV2("r1");
      expect(() =>
        M.createCadpgovAdaptV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCadpgovAdaptV2("nope")).toBeNull());
    it("list", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      M.createCadpgovAdaptV2({ id: "r2", profileId: "p1" });
      expect(M.listCadpgovAdaptsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCadpgovAdaptV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCadpgovAdaptV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCadpgovProfileIdleMsV2(1000);
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
      const r = M.autoStaleIdleCadpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCadpgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      M.adaptingCadpgovAdaptV2("r1");
      M.setCadpgovAdaptStuckMsV2(100);
      const r = M.autoFailStuckCadpgovAdaptsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCadpgovProfileIdleMsV2(1000);
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCadpgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkAdapterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.adaptsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCadpgovProfileV2({ id: "p1", owner: "a" });
      M.activateCadpgovProfileV2("p1");
      M.createCadpgovAdaptV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkAdapterGovStatsV2();
      expect(s2.totalCadpgovProfilesV2).toBe(1);
      expect(s2.totalCadpgovAdaptsV2).toBe(1);
    });
  });
});
