import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/ws-chat-handler.js";

describe("WsChatHandlerGov V2 Surface", () => {
  beforeEach(() => M._resetStateWsChatHandlerGovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.WSCGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.WSCGOV_MSG_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.WSCGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.WSCGOV_MSG_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveWscgovProfilesPerOwnerV2(11);
      expect(M.getMaxActiveWscgovProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingWscgovMsgsPerProfileV2(33);
      expect(M.getMaxPendingWscgovMsgsPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setWscgovProfileIdleMsV2(60000);
      expect(M.getWscgovProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setWscgovMsgStuckMsV2(45000);
      expect(M.getWscgovMsgStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveWscgovProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setWscgovMsgStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveWscgovProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveWscgovProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerWscgovProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default connection", () =>
      expect(
        M.registerWscgovProfileV2({ id: "p1", owner: "a" }).connection,
      ).toBe("default"));
    it("activate", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      expect(M.activateWscgovProfileV2("p1").status).toBe("active");
    });
    it("idle", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
      expect(M.idleWscgovProfileV2("p1").status).toBe("idle");
    });
    it("recovery preserves activatedAt", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      const a = M.activateWscgovProfileV2("p1");
      M.idleWscgovProfileV2("p1");
      expect(M.activateWscgovProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
      expect(M.archiveWscgovProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
      M.archiveWscgovProfileV2("p1");
      expect(() => M.touchWscgovProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      expect(() => M.idleWscgovProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      expect(() =>
        M.registerWscgovProfileV2({ id: "p1", owner: "b" }),
      ).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerWscgovProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getWscgovProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.registerWscgovProfileV2({ id: "p2", owner: "b" });
      expect(M.listWscgovProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getWscgovProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getWscgovProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveWscgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWscgovProfileV2({ id, owner: "a" }),
      );
      M.activateWscgovProfileV2("p1");
      M.activateWscgovProfileV2("p2");
      expect(() => M.activateWscgovProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveWscgovProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerWscgovProfileV2({ id, owner: "a" }),
      );
      M.activateWscgovProfileV2("p1");
      M.activateWscgovProfileV2("p2");
      M.idleWscgovProfileV2("p1");
      M.activateWscgovProfileV2("p3");
      expect(() => M.activateWscgovProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveWscgovProfilesPerOwnerV2(1);
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.registerWscgovProfileV2({ id: "p2", owner: "b" });
      M.activateWscgovProfileV2("p1");
      expect(() => M.activateWscgovProfileV2("p2")).not.toThrow();
    });
  });

  describe("msg lifecycle", () => {
    beforeEach(() => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
    });
    it("create→handling→complete", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      M.handlingWscgovMsgV2("r1");
      const r = M.completeMsgWscgovV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      M.handlingWscgovMsgV2("r1");
      expect(M.failWscgovMsgV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWscgovMsgV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeMsgWscgovV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createWscgovMsgV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingWscgovMsgsPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createWscgovMsgV2({ id, profileId: "p1" }),
      );
      expect(() => M.createWscgovMsgV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("handling counts as pending", () => {
      M.setMaxPendingWscgovMsgsPerProfileV2(1);
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      M.handlingWscgovMsgV2("r1");
      expect(() =>
        M.createWscgovMsgV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingWscgovMsgsPerProfileV2(1);
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      M.handlingWscgovMsgV2("r1");
      M.completeMsgWscgovV2("r1");
      expect(() =>
        M.createWscgovMsgV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getWscgovMsgV2("nope")).toBeNull());
    it("list", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      M.createWscgovMsgV2({ id: "r2", profileId: "p1" });
      expect(M.listWscgovMsgsV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createWscgovMsgV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createWscgovMsgV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      expect(M.cancelWscgovMsgV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoIdleIdle", () => {
      M.setWscgovProfileIdleMsV2(1000);
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
      const r = M.autoIdleIdleWscgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getWscgovProfileV2("p1").status).toBe("idle");
    });
    it("autoFailStuck", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      M.handlingWscgovMsgV2("r1");
      M.setWscgovMsgStuckMsV2(100);
      const r = M.autoFailStuckWscgovMsgsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setWscgovProfileIdleMsV2(1000);
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      const r = M.autoIdleIdleWscgovProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getWsChatHandlerGovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.msgsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerWscgovProfileV2({ id: "p1", owner: "a" });
      M.activateWscgovProfileV2("p1");
      M.createWscgovMsgV2({ id: "r1", profileId: "p1" });
      const s2 = M.getWsChatHandlerGovStatsV2();
      expect(s2.totalWscgovProfilesV2).toBe(1);
      expect(s2.totalWscgovMsgsV2).toBe(1);
    });
  });
});
