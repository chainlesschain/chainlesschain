import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/agent-economy.js";

describe("Aecogov V2 Surface", () => {
  beforeEach(() => M._resetStateAecogovV2());

  describe("enums", () => {
    it("4 maturity states", () =>
      expect(Object.keys(M.AECOGOV_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () =>
      expect(Object.keys(M.AECOGOV_TRADE_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => {
      expect(Object.isFrozen(M.AECOGOV_PROFILE_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.AECOGOV_TRADE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActive", () => {
      M.setMaxActiveAecoProfilesPerOwnerV2(11);
      expect(M.getMaxActiveAecoProfilesPerOwnerV2()).toBe(11);
    });
    it("setMaxPending", () => {
      M.setMaxPendingAecoTradesPerProfileV2(33);
      expect(M.getMaxPendingAecoTradesPerProfileV2()).toBe(33);
    });
    it("setIdle", () => {
      M.setAecoProfileIdleMsV2(60000);
      expect(M.getAecoProfileIdleMsV2()).toBe(60000);
    });
    it("setStuck", () => {
      M.setAecoTradeStuckMsV2(45000);
      expect(M.getAecoTradeStuckMsV2()).toBe(45000);
    });
    it("rejects 0", () =>
      expect(() => M.setMaxActiveAecoProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () =>
      expect(() => M.setAecoTradeStuckMsV2("x")).toThrow());
    it("floors decimals", () => {
      M.setMaxActiveAecoProfilesPerOwnerV2(7.9);
      expect(M.getMaxActiveAecoProfilesPerOwnerV2()).toBe(7);
    });
  });

  describe("profile lifecycle", () => {
    it("register pending", () =>
      expect(M.registerAecoProfileV2({ id: "p1", owner: "a" }).status).toBe(
        "pending",
      ));
    it("default market", () =>
      expect(M.registerAecoProfileV2({ id: "p1", owner: "a" }).market).toBe(
        "default",
      ));
    it("activate", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      expect(M.activateAecoProfileV2("p1").status).toBe("active");
    });
    it("paused", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
      expect(M.pausedAecoProfileV2("p1").status).toBe("paused");
    });
    it("recovery preserves activatedAt", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      const a = M.activateAecoProfileV2("p1");
      M.pausedAecoProfileV2("p1");
      expect(M.activateAecoProfileV2("p1").activatedAt).toBe(a.activatedAt);
    });
    it("archive terminal", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
      expect(M.archiveAecoProfileV2("p1").status).toBe("archived");
    });
    it("cannot touch archived", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
      M.archiveAecoProfileV2("p1");
      expect(() => M.touchAecoProfileV2("p1")).toThrow();
    });
    it("invalid transition", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      expect(() => M.pausedAecoProfileV2("p1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      expect(() => M.registerAecoProfileV2({ id: "p1", owner: "b" })).toThrow();
    });
    it("missing owner", () =>
      expect(() => M.registerAecoProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getAecoProfileV2("nope")).toBeNull());
    it("list all", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.registerAecoProfileV2({ id: "p2", owner: "b" });
      expect(M.listAecoProfilesV2()).toHaveLength(2);
    });
    it("defensive copy", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } });
      const p = M.getAecoProfileV2("p1");
      p.metadata.x = 99;
      expect(M.getAecoProfileV2("p1").metadata.x).toBe(1);
    });
  });

  describe("active cap", () => {
    it("enforced", () => {
      M.setMaxActiveAecoProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAecoProfileV2({ id, owner: "a" }),
      );
      M.activateAecoProfileV2("p1");
      M.activateAecoProfileV2("p2");
      expect(() => M.activateAecoProfileV2("p3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveAecoProfilesPerOwnerV2(2);
      ["p1", "p2", "p3"].forEach((id) =>
        M.registerAecoProfileV2({ id, owner: "a" }),
      );
      M.activateAecoProfileV2("p1");
      M.activateAecoProfileV2("p2");
      M.pausedAecoProfileV2("p1");
      M.activateAecoProfileV2("p3");
      expect(() => M.activateAecoProfileV2("p1")).not.toThrow();
    });
    it("per-owner", () => {
      M.setMaxActiveAecoProfilesPerOwnerV2(1);
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.registerAecoProfileV2({ id: "p2", owner: "b" });
      M.activateAecoProfileV2("p1");
      expect(() => M.activateAecoProfileV2("p2")).not.toThrow();
    });
  });

  describe("trade lifecycle", () => {
    beforeEach(() => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
    });
    it("create→trading→complete", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      M.tradingAecoTradeV2("r1");
      const r = M.completeTradeAecoV2("r1");
      expect(r.status).not.toBe("queued");
    });
    it("fail", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      M.tradingAecoTradeV2("r1");
      expect(M.failAecoTradeV2("r1", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAecoTradeV2("r1").status).toBe("cancelled");
    });
    it("invalid complete from queued", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      expect(() => M.completeTradeAecoV2("r1")).toThrow();
    });
    it("unknown profile", () =>
      expect(() =>
        M.createAecoTradeV2({ id: "r1", profileId: "none" }),
      ).toThrow());
    it("pending cap", () => {
      M.setMaxPendingAecoTradesPerProfileV2(2);
      ["r1", "r2"].forEach((id) =>
        M.createAecoTradeV2({ id, profileId: "p1" }),
      );
      expect(() => M.createAecoTradeV2({ id: "r3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("trading counts as pending", () => {
      M.setMaxPendingAecoTradesPerProfileV2(1);
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      M.tradingAecoTradeV2("r1");
      expect(() =>
        M.createAecoTradeV2({ id: "r2", profileId: "p1" }),
      ).toThrow();
    });
    it("completed frees slot", () => {
      M.setMaxPendingAecoTradesPerProfileV2(1);
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      M.tradingAecoTradeV2("r1");
      M.completeTradeAecoV2("r1");
      expect(() =>
        M.createAecoTradeV2({ id: "r2", profileId: "p1" }),
      ).not.toThrow();
    });
    it("get null", () => expect(M.getAecoTradeV2("nope")).toBeNull());
    it("list", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      M.createAecoTradeV2({ id: "r2", profileId: "p1" });
      expect(M.listAecoTradesV2()).toHaveLength(2);
    });
    it("missing id", () =>
      expect(() => M.createAecoTradeV2({ profileId: "p1" })).toThrow());
    it("duplicate id", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      expect(() =>
        M.createAecoTradeV2({ id: "r1", profileId: "p1" }),
      ).toThrow();
    });
    it("cancel reason captured", () => {
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      expect(M.cancelAecoTradeV2("r1", "y").metadata.cancelReason).toBe("y");
    });
  });

  describe("auto flips", () => {
    it("autoPausedIdle", () => {
      M.setAecoProfileIdleMsV2(1000);
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
      const r = M.autoPausedIdleAecoProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getAecoProfileV2("p1").status).toBe("paused");
    });
    it("autoFailStuck", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      M.tradingAecoTradeV2("r1");
      M.setAecoTradeStuckMsV2(100);
      const r = M.autoFailStuckAecoTradesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
    });
    it("only flips active", () => {
      M.setAecoProfileIdleMsV2(1000);
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      const r = M.autoPausedIdleAecoProfilesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(0);
    });
  });

  describe("stats", () => {
    it("zero-init", () => {
      const s2 = M.getAecogovStatsV2();
      expect(s2.profilesByStatus.pending).toBe(0);
      expect(s2.tradesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerAecoProfileV2({ id: "p1", owner: "a" });
      M.activateAecoProfileV2("p1");
      M.createAecoTradeV2({ id: "r1", profileId: "p1" });
      const s2 = M.getAecogovStatsV2();
      expect(s2.totalAecoProfilesV2).toBe(1);
      expect(s2.totalAecoTradesV2).toBe(1);
    });
  });
});
