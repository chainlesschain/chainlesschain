import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-evomap-adapter.js";

describe("CoworkEvomapAdapterGov V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkEvomapAdapterGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.CEADGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.CEADGOV_BIND_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.CEADGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.CEADGOV_BIND_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveCeadgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveCeadgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingCeadgovBindsPerProfileV2(33);
      expect(M.getMaxPendingCeadgovBindsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setCeadgovProfileIdleMsV2(60000);
      expect(M.getCeadgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setCeadgovBindStuckMsV2(45000);
      expect(M.getCeadgovBindStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveCeadgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setCeadgovBindStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveCeadgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveCeadgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerCeadgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default direction", () =>
      expect(
        M.registerCeadgovProfileV2({ id: "p1", owner: "a" }).direction,
      ).toBe("bidirectional"));
    it("activate", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateCeadgovProfileV2("p1").status).toBe("active");
    });
    it("stale", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
      expect(M.staleCeadgovProfileV2("p1").status).toBe("stale");
    });
    it("recovery preserves activatedAt", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateCeadgovProfileV2("p1");
      M.staleCeadgovProfileV2("p1");
      expect(M.activateCeadgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
      expect(M.archiveCeadgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
      M.archiveCeadgovProfileV2("p1");
      expect(() => M.touchCeadgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.staleCeadgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerCeadgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerCeadgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCeadgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.registerCeadgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listCeadgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getCeadgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getCeadgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveCeadgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCeadgovProfileV2({ id, owner: "a" }),
      );
      M.activateCeadgovProfileV2("p1");
      M.activateCeadgovProfileV2("p2");
      expect(() => M.activateCeadgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveCeadgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerCeadgovProfileV2({ id, owner: "a" }),
      );
      M.activateCeadgovProfileV2("p1");
      M.activateCeadgovProfileV2("p2");
      M.staleCeadgovProfileV2("p1");
      M.activateCeadgovProfileV2("p3");
      expect(() => M.activateCeadgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveCeadgovProfilesPerOwnerV2(1);
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.registerCeadgovProfileV2({ id: "p2", owner: "b" });
      M.activateCeadgovProfileV2("p1");
      expect(() => M.activateCeadgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("bind lifecycle", () => {
    beforeEach(() => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
    });
    it("create→binding→complete", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      M.bindingCeadgovBindV2("r1");
      const r = M.completeBindCeadgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      M.bindingCeadgovBindV2("r1");
      expect(M.failCeadgovBindV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCeadgovBindV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeBindCeadgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createCeadgovBindV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingCeadgovBindsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createCeadgovBindV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createCeadgovBindV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("binding counts as pending", () => {
      M.setMaxPendingCeadgovBindsPerProfileV2(1);
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      M.bindingCeadgovBindV2("r1");
      expect(() =>
        M.createCeadgovBindV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingCeadgovBindsPerProfileV2(1);
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      M.bindingCeadgovBindV2("r1");
      M.completeBindCeadgovV2("r1");
      expect(() =>
        M.createCeadgovBindV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getCeadgovBindV2("nope")).toBeNull());
    it("list", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      M.createCeadgovBindV2({ id: "r2", profileId: "p1" });
      expect(M.listCeadgovBindsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createCeadgovBindV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createCeadgovBindV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      expect(M.cancelCeadgovBindV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => {
      M.setCeadgovProfileIdleMsV2(1000);
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
      const r = M.autoStaleIdleCeadgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getCeadgovProfileV2("p1").status).toBe("stale");
    });
    it("autoFailStuck", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      M.bindingCeadgovBindV2("r1");
      M.setCeadgovBindStuckMsV2(100);
      const r = M.autoFailStuckCeadgovBindsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setCeadgovProfileIdleMsV2(1000);
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoStaleIdleCeadgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getCoworkEvomapAdapterGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.bindsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerCeadgovProfileV2({ id: "p1", owner: "a" });
      M.activateCeadgovProfileV2("p1");
      M.createCeadgovBindV2({ id: "r1", profileId: "p1" });
      const s2 = M.getCoworkEvomapAdapterGovStatsV2();
      expect(s2.totalCeadgovProfilesV2).toBe(1);
      expect(s2.totalCeadgovBindsV2).toBe(1);
    });
  });
});
