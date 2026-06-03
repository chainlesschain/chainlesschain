import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/instinct-manager.js";

describe("InstinctManager V2 Surface", () => {
  beforeEach(() => M._resetStateInstinctManagerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.INSTGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.INSTGOV_TRIGGER_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.INSTGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.INSTGOV_TRIGGER_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveInstgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveInstgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingInstgovTriggersPerProfileV2(33);
      expect(M.getMaxPendingInstgovTriggersPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setInstgovProfileIdleMsV2(60000);
      expect(M.getInstgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setInstgovTriggerStuckMsV2(45000);
      expect(M.getInstgovTriggerStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveInstgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setInstgovTriggerStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveInstgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveInstgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerInstgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default priority", () =>
      expect(
        M.registerInstgovProfileV2({ id: "p1", owner: "a" }).priority,
      ).toBe("normal"));
    it("activate", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateInstgovProfileV2("p1").status).toBe("active");
    });
    it("dormant", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
      expect(M.dormantInstgovProfileV2("p1").status).toBe("dormant");
    });
    it("recovery preserves activatedAt", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateInstgovProfileV2("p1");
      M.dormantInstgovProfileV2("p1");
      expect(M.activateInstgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
      expect(M.archiveInstgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
      M.archiveInstgovProfileV2("p1");
      expect(() => M.touchInstgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.dormantInstgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerInstgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerInstgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getInstgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.registerInstgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listInstgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getInstgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getInstgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveInstgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerInstgovProfileV2({ id, owner: "a" }),
      );
      M.activateInstgovProfileV2("p1");
      M.activateInstgovProfileV2("p2");
      expect(() => M.activateInstgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveInstgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerInstgovProfileV2({ id, owner: "a" }),
      );
      M.activateInstgovProfileV2("p1");
      M.activateInstgovProfileV2("p2");
      M.dormantInstgovProfileV2("p1");
      M.activateInstgovProfileV2("p3");
      expect(() => M.activateInstgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveInstgovProfilesPerOwnerV2(1);
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.registerInstgovProfileV2({ id: "p2", owner: "b" });
      M.activateInstgovProfileV2("p1");
      expect(() => M.activateInstgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("trigger lifecycle", () => {
    beforeEach(() => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
    });
    it("create→firing→complete", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingInstgovTriggerV2("r1");
      const r = M.completeTriggerInstgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingInstgovTriggerV2("r1");
      expect(M.failInstgovTriggerV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(M.cancelInstgovTriggerV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTriggerInstgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createInstgovTriggerV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingInstgovTriggersPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createInstgovTriggerV2({ id, profileId: "p1" }),
      );
      expect(() =>
        M.createInstgovTriggerV2({ id: "r3", profileId: "p1" }),
      ).toThrow(/max pending/);
    });
    it("firing counts as pending", () => {
      M.setMaxPendingInstgovTriggersPerProfileV2(1);
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingInstgovTriggerV2("r1");
      expect(() =>
        M.createInstgovTriggerV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingInstgovTriggersPerProfileV2(1);
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingInstgovTriggerV2("r1");
      M.completeTriggerInstgovV2("r1");
      expect(() =>
        M.createInstgovTriggerV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getInstgovTriggerV2("nope")).toBeNull());
    it("list", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      M.createInstgovTriggerV2({ id: "r2", profileId: "p1" });
      expect(M.listInstgovTriggersV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createInstgovTriggerV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createInstgovTriggerV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      expect(M.cancelInstgovTriggerV2("r1", "y").metadata.cancelReason).toBe(
        "y",
      );
    });
  });

  describe("auto flips", () => {
    it("autoDormantIdle", () => {
      M.setInstgovProfileIdleMsV2(1000);
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
      const r = M.autoDormantIdleInstgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getInstgovProfileV2("p1").status).toBe("dormant");
    });
    it("autoFailStuck", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      M.firingInstgovTriggerV2("r1");
      M.setInstgovTriggerStuckMsV2(100);
      const r = M.autoFailStuckInstgovTriggersV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setInstgovProfileIdleMsV2(1000);
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoDormantIdleInstgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getInstinctManagerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.triggersByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerInstgovProfileV2({ id: "p1", owner: "a" });
      M.activateInstgovProfileV2("p1");
      M.createInstgovTriggerV2({ id: "r1", profileId: "p1" });
      const s2 = M.getInstinctManagerGovStatsV2();
      expect(s2.totalInstgovProfilesV2).toBe(1);
      expect(s2.totalInstgovTriggersV2).toBe(1);
    });
  });
});
