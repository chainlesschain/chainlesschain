import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/hook-manager.js";

describe("HookManager V2 Surface", () => {
  beforeEach(() => M._resetStateHookManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.HOOKGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.HOOKGOV_TRIGGER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.HOOKGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.HOOKGOV_TRIGGER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveHookgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveHookgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingHookgovTriggersPerProfileV2(33);
      expect(M.getMaxPendingHookgovTriggersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setHookgovProfileIdleMsV2(60000);
      expect(M.getHookgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setHookgovTriggerStuckMsV2(45000);
      expect(M.getHookgovTriggerStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveHookgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setHookgovTriggerStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveHookgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveHookgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerHookgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default event", () =>
      expect(M.registerHookgovProfileV2({ id: "p1", owner: "a" }).event).toBe(
        "preTurn",
      ));
    it("activate", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateHookgovProfileV2("p1").status).toBe("active");
    });
    it("disable", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
      expect(M.disableHookgovProfileV2("p1").status).toBe("disabled");
    });
    it("recovery preserves activatedAt", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateHookgovProfileV2("p1");
      M.disableHookgovProfileV2("p1");
      expect(M.activateHookgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
      expect(M.archiveHookgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
      M.archiveHookgovProfileV2("p1");
      expect(() => M.touchHookgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.disableHookgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerHookgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerHookgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getHookgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.registerHookgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listHookgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getHookgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getHookgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveHookgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHookgovProfileV2({ id, owner: "a" }),
      );
      M.activateHookgovProfileV2("p1");
      M.activateHookgovProfileV2("p2");
      expect(() => M.activateHookgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveHookgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerHookgovProfileV2({ id, owner: "a" }),
      );
      M.activateHookgovProfileV2("p1");
      M.activateHookgovProfileV2("p2");
      M.disableHookgovProfileV2("p1");
      M.activateHookgovProfileV2("p3");
      expect(() => M.activateHookgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveHookgovProfilesPerOwnerV2(1);
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.registerHookgovProfileV2({ id: "p2", owner: "b" });
      M.activateHookgovProfileV2("p1");
      expect(() => M.activateHookgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("trigger lifecycle", () => {
    beforeEach(() => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
    });
    it("create→firing→complete", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingHookgovTriggerV2("r1");
      const r = M.completeTriggerHookgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingHookgovTriggerV2("r1");
      expect(M.failHookgovTriggerV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHookgovTriggerV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTriggerHookgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createHookgovTriggerV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingHookgovTriggersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createHookgovTriggerV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createHookgovTriggerV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("firing counts as pending", () => {
      M.setMaxPendingHookgovTriggersPerProfileV2(1);
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingHookgovTriggerV2("r1");
      expect(() =>
        M.createHookgovTriggerV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingHookgovTriggersPerProfileV2(1);
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingHookgovTriggerV2("r1");
      M.completeTriggerHookgovV2("r1");
      expect(() =>
        M.createHookgovTriggerV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getHookgovTriggerV2("nope")).toBeNull());
    it("list", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      M.createHookgovTriggerV2({ id: "r2", profileId: "p1" });
      expect(M.listHookgovTriggersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createHookgovTriggerV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createHookgovTriggerV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(M.cancelHookgovTriggerV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDisableIdle", () => {
      M.setHookgovProfileIdleMsV2(1000);
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
      const r = M.autoDisableIdleHookgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getHookgovProfileV2("p1").status).toBe("disabled");
    });
    it("autoFailStuck", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingHookgovTriggerV2("r1");
      M.setHookgovTriggerStuckMsV2(100);
      const r = M.autoFailStuckHookgovTriggersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setHookgovProfileIdleMsV2(1000);
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDisableIdleHookgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getHookManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.triggersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerHookgovProfileV2({ id: "p1", owner: "a" });
      M.activateHookgovProfileV2("p1");
      M.createHookgovTriggerV2({ id: "r1", profileId: "p1" });
      const s2 = M.getHookManagerGovStatsV2();
      expect(s2.totalHookgovProfilesV2).toBe(1);
      expect(s2.totalHookgovTriggersV2).toBe(1);
    });
  });
});
