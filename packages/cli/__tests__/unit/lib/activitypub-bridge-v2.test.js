import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/activitypub-bridge.js";

describe("ActivityPub Bridge V2 Surface", () => {
  beforeEach(() => M._resetStateActivityPubBridgeV2());

  describe("enums", () => {
    it("actor maturity has 4 states", () =>
      expect(Object.keys(M.AP_ACTOR_MATURITY_V2)).toHaveLength(4));
    it("activity lifecycle has 5 states", () =>
      expect(Object.keys(M.AP_ACTIVITY_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.AP_ACTOR_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.AP_ACTIVITY_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveApActorsPerOwnerV2", () => {
      M.setMaxActiveApActorsPerOwnerV2(20);
      expect(M.getMaxActiveApActorsPerOwnerV2()).toBe(20);
    });
    it("setMaxPendingApActivitiesPerActorV2", () => {
      M.setMaxPendingApActivitiesPerActorV2(50);
      expect(M.getMaxPendingApActivitiesPerActorV2()).toBe(50);
    });
    it("setApActorIdleMsV2", () => {
      M.setApActorIdleMsV2(1800000);
      expect(M.getApActorIdleMsV2()).toBe(1800000);
    });
    it("setApActivityStuckMsV2", () => {
      M.setApActivityStuckMsV2(30000);
      expect(M.getApActivityStuckMsV2()).toBe(30000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveApActorsPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setApActivityStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingApActivitiesPerActorV2(7.8);
      expect(M.getMaxPendingApActivitiesPerActorV2()).toBe(7);
    });
  });

  describe("actor lifecycle", () => {
    it("register", () => {
      const a = M.registerApActorV2({ id: "a1", owner: "alice" });
      expect(a.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      const a = M.activateApActorV2("a1");
      expect(a.status).toBe("active");
      expect(a.activatedAt).toBeTruthy();
    });
    it("suspend active→suspended", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      M.activateApActorV2("a1");
      expect(M.suspendApActorV2("a1").status).toBe("suspended");
    });
    it("recovery suspended→active preserves activatedAt", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      const a = M.activateApActorV2("a1");
      M.suspendApActorV2("a1");
      const re = M.activateApActorV2("a1");
      expect(re.activatedAt).toBe(a.activatedAt);
    });
    it("deactivate terminal stamps deactivatedAt", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      M.activateApActorV2("a1");
      const a = M.deactivateApActorV2("a1");
      expect(a.status).toBe("deactivated");
      expect(a.deactivatedAt).toBeTruthy();
    });
    it("cannot touch deactivated", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      M.activateApActorV2("a1");
      M.deactivateApActorV2("a1");
      expect(() => M.touchApActorV2("a1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      expect(() => M.suspendApActorV2("a1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerApActorV2({ id: "a1", owner: "alice" });
      expect(() => M.registerApActorV2({ id: "a1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerApActorV2({ id: "a1" })).toThrow());
    it("list all", () => {
      M.registerApActorV2({ id: "a1", owner: "a" });
      M.registerApActorV2({ id: "a2", owner: "b" });
      expect(M.listApActorsV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getApActorV2("none")).toBeNull());
    it("defensive copy", () => {
      M.registerApActorV2({ id: "a1", owner: "a", metadata: { k: 5 } });
      const a = M.getApActorV2("a1");
      a.metadata.k = 99;
      expect(M.getApActorV2("a1").metadata.k).toBe(5);
    });
  });

  describe("active-actor cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveApActorsPerOwnerV2(2);
      ["a1", "a2", "a3"].forEach((id) =>
        M.registerApActorV2({ id, owner: "o" }),
      );
      M.activateApActorV2("a1");
      M.activateApActorV2("a2");
      expect(() => M.activateApActorV2("a3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveApActorsPerOwnerV2(2);
      ["a1", "a2", "a3"].forEach((id) =>
        M.registerApActorV2({ id, owner: "o" }),
      );
      M.activateApActorV2("a1");
      M.activateApActorV2("a2");
      M.suspendApActorV2("a1");
      M.activateApActorV2("a3");
      expect(() => M.activateApActorV2("a1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveApActorsPerOwnerV2(1);
      M.registerApActorV2({ id: "a1", owner: "o1" });
      M.registerApActorV2({ id: "a2", owner: "o2" });
      M.activateApActorV2("a1");
      expect(() => M.activateApActorV2("a2")).not.toThrow();
    });
  });

  describe("activity lifecycle", () => {
    beforeEach(() => {
      M.registerApActorV2({ id: "a1", owner: "o" });
      M.activateApActorV2("a1");
    });
    it("create→start→deliver", () => {
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      M.startApActivityV2("x1");
      const x = M.deliverApActivityV2("x1");
      expect(x.status).toBe("delivered");
    });
    it("fail stores reason", () => {
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      M.startApActivityV2("x1");
      const x = M.failApActivityV2("x1", "bad");
      expect(x.metadata.failReason).toBe("bad");
    });
    it("cancel queued", () => {
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      expect(M.cancelApActivityV2("x1").status).toBe("cancelled");
    });
    it("cannot deliver from queued", () => {
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      expect(() => M.deliverApActivityV2("x1")).toThrow();
    });
    it("unknown actor rejected", () =>
      expect(() =>
        M.createApActivityV2({ id: "x1", actorId: "none" }),
      ).toThrow());
    it("per-actor pending cap", () => {
      M.setMaxPendingApActivitiesPerActorV2(2);
      ["x1", "x2"].forEach((id) => M.createApActivityV2({ id, actorId: "a1" }));
      expect(() => M.createApActivityV2({ id: "x3", actorId: "a1" })).toThrow(
        /max pending/,
      );
    });
    it("delivering counts as pending", () => {
      M.setMaxPendingApActivitiesPerActorV2(1);
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      M.startApActivityV2("x1");
      expect(() => M.createApActivityV2({ id: "x2", actorId: "a1" })).toThrow();
    });
    it("delivered frees slot", () => {
      M.setMaxPendingApActivitiesPerActorV2(1);
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      M.startApActivityV2("x1");
      M.deliverApActivityV2("x1");
      expect(() =>
        M.createApActivityV2({ id: "x2", actorId: "a1" }),
      ).not.toThrow();
    });
    it("default kind Note", () => {
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      expect(M.getApActivityV2("x1").kind).toBe("Note");
    });
    it("custom kind preserved", () => {
      M.createApActivityV2({ id: "x1", actorId: "a1", kind: "Follow" });
      expect(M.getApActivityV2("x1").kind).toBe("Follow");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setApActorIdleMsV2(1000);
      M.registerApActorV2({ id: "a1", owner: "o" });
      M.activateApActorV2("a1");
      const r = M.autoSuspendIdleApActorsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getApActorV2("a1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerApActorV2({ id: "a1", owner: "o" });
      M.activateApActorV2("a1");
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      M.startApActivityV2("x1");
      M.setApActivityStuckMsV2(100);
      const r = M.autoFailStuckApActivitiesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getApActivityV2("x1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getActivityPubBridgeStatsV2();
      expect(s.actorsByStatus.pending).toBe(0);
      expect(s.activitiesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerApActorV2({ id: "a1", owner: "o" });
      M.activateApActorV2("a1");
      M.createApActivityV2({ id: "x1", actorId: "a1" });
      const s = M.getActivityPubBridgeStatsV2();
      expect(s.totalActorsV2).toBe(1);
      expect(s.totalActivitiesV2).toBe(1);
    });
  });
});
