import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/hierarchical-memory.js";

describe("Hierarchical Memory V2 Surface", () => {
  beforeEach(() => M._resetStateHierarchicalMemoryV2());

  describe("enums", () => {
    it("tier maturity has 4 states", () => expect(Object.keys(M.HMEM_TIER_MATURITY_V2)).toHaveLength(4));
    it("promotion lifecycle has 5 states", () => expect(Object.keys(M.HMEM_PROMOTION_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.HMEM_TIER_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.HMEM_PROMOTION_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActiveHmemTiersPerOwnerV2", () => { M.setMaxActiveHmemTiersPerOwnerV2(20); expect(M.getMaxActiveHmemTiersPerOwnerV2()).toBe(20); });
    it("setMaxPendingHmemPromotionsPerTierV2", () => { M.setMaxPendingHmemPromotionsPerTierV2(50); expect(M.getMaxPendingHmemPromotionsPerTierV2()).toBe(50); });
    it("setHmemTierIdleMsV2", () => { M.setHmemTierIdleMsV2(3600000); expect(M.getHmemTierIdleMsV2()).toBe(3600000); });
    it("setHmemPromotionStuckMsV2", () => { M.setHmemPromotionStuckMsV2(60000); expect(M.getHmemPromotionStuckMsV2()).toBe(60000); });
    it("rejects zero", () => expect(() => M.setMaxActiveHmemTiersPerOwnerV2(0)).toThrow());
    it("rejects negative", () => expect(() => M.setHmemPromotionStuckMsV2(-1)).toThrow());
    it("floors decimals", () => { M.setMaxPendingHmemPromotionsPerTierV2(9.7); expect(M.getMaxPendingHmemPromotionsPerTierV2()).toBe(9); });
  });

  describe("tier lifecycle", () => {
    it("register", () => { const t = M.registerHmemTierV2({ id: "t1", owner: "alice" }); expect(t.status).toBe("pending"); });
    it("activate stamps activatedAt", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); const t = M.activateHmemTierV2("t1"); expect(t.status).toBe("active"); expect(t.activatedAt).toBeTruthy(); });
    it("dormant active→dormant", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); M.activateHmemTierV2("t1"); expect(M.dormantHmemTierV2("t1").status).toBe("dormant"); });
    it("recovery dormant→active preserves activatedAt", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); const t = M.activateHmemTierV2("t1"); M.dormantHmemTierV2("t1"); const re = M.activateHmemTierV2("t1"); expect(re.activatedAt).toBe(t.activatedAt); });
    it("retire terminal stamps retiredAt", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); M.activateHmemTierV2("t1"); const t = M.retireHmemTierV2("t1"); expect(t.status).toBe("retired"); expect(t.retiredAt).toBeTruthy(); });
    it("cannot touch retired", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); M.activateHmemTierV2("t1"); M.retireHmemTierV2("t1"); expect(() => M.touchHmemTierV2("t1")).toThrow(); });
    it("invalid transition rejected", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); expect(() => M.dormantHmemTierV2("t1")).toThrow(); });
    it("duplicate rejected", () => { M.registerHmemTierV2({ id: "t1", owner: "alice" }); expect(() => M.registerHmemTierV2({ id: "t1", owner: "b" })).toThrow(); });
    it("missing owner rejected", () => expect(() => M.registerHmemTierV2({ id: "t1" })).toThrow());
    it("list all", () => { M.registerHmemTierV2({ id: "t1", owner: "a" }); M.registerHmemTierV2({ id: "t2", owner: "b" }); expect(M.listHmemTiersV2()).toHaveLength(2); });
    it("get null unknown", () => expect(M.getHmemTierV2("none")).toBeNull());
    it("defensive copy metadata", () => { M.registerHmemTierV2({ id: "t1", owner: "a", metadata: { k: 5 } }); const t = M.getHmemTierV2("t1"); t.metadata.k = 99; expect(M.getHmemTierV2("t1").metadata.k).toBe(5); });
    it("default level short-term", () => { M.registerHmemTierV2({ id: "t1", owner: "a" }); expect(M.getHmemTierV2("t1").level).toBe("short-term"); });
    it("level preserved", () => { M.registerHmemTierV2({ id: "t1", owner: "a", level: "long-term" }); expect(M.getHmemTierV2("t1").level).toBe("long-term"); });
  });

  describe("active-tier cap", () => {
    it("enforced on pending→active", () => { M.setMaxActiveHmemTiersPerOwnerV2(2); ["t1","t2","t3"].forEach(id => M.registerHmemTierV2({ id, owner: "o" })); M.activateHmemTierV2("t1"); M.activateHmemTierV2("t2"); expect(() => M.activateHmemTierV2("t3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveHmemTiersPerOwnerV2(2); ["t1","t2","t3"].forEach(id => M.registerHmemTierV2({ id, owner: "o" })); M.activateHmemTierV2("t1"); M.activateHmemTierV2("t2"); M.dormantHmemTierV2("t1"); M.activateHmemTierV2("t3"); expect(() => M.activateHmemTierV2("t1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveHmemTiersPerOwnerV2(1); M.registerHmemTierV2({ id: "t1", owner: "o1" }); M.registerHmemTierV2({ id: "t2", owner: "o2" }); M.activateHmemTierV2("t1"); expect(() => M.activateHmemTierV2("t2")).not.toThrow(); });
  });

  describe("promotion lifecycle", () => {
    beforeEach(() => { M.registerHmemTierV2({ id: "t1", owner: "o" }); M.activateHmemTierV2("t1"); });
    it("create→start→complete", () => { M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); M.startHmemPromotionV2("p1"); const p = M.completeHmemPromotionV2("p1"); expect(p.status).toBe("promoted"); });
    it("fail stores reason", () => { M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); M.startHmemPromotionV2("p1"); const p = M.failHmemPromotionV2("p1", "err"); expect(p.metadata.failReason).toBe("err"); });
    it("cancel queued", () => { M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); expect(M.cancelHmemPromotionV2("p1").status).toBe("cancelled"); });
    it("cannot complete from queued", () => { M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); expect(() => M.completeHmemPromotionV2("p1")).toThrow(); });
    it("unknown tier rejected", () => expect(() => M.createHmemPromotionV2({ id: "p1", tierId: "none" })).toThrow());
    it("per-tier pending cap", () => { M.setMaxPendingHmemPromotionsPerTierV2(2); ["p1","p2"].forEach(id => M.createHmemPromotionV2({ id, tierId: "t1" })); expect(() => M.createHmemPromotionV2({ id: "p3", tierId: "t1" })).toThrow(/max pending/); });
    it("promoting counts as pending", () => { M.setMaxPendingHmemPromotionsPerTierV2(1); M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); M.startHmemPromotionV2("p1"); expect(() => M.createHmemPromotionV2({ id: "p2", tierId: "t1" })).toThrow(); });
    it("promoted frees slot", () => { M.setMaxPendingHmemPromotionsPerTierV2(1); M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); M.startHmemPromotionV2("p1"); M.completeHmemPromotionV2("p1"); expect(() => M.createHmemPromotionV2({ id: "p2", tierId: "t1" })).not.toThrow(); });
    it("default itemKey empty", () => { M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); expect(M.getHmemPromotionV2("p1").itemKey).toBe(""); });
    it("itemKey preserved", () => { M.createHmemPromotionV2({ id: "p1", tierId: "t1", itemKey: "key-123" }); expect(M.getHmemPromotionV2("p1").itemKey).toBe("key-123"); });
  });

  describe("auto flips", () => {
    it("autoDormantIdle", () => { M.setHmemTierIdleMsV2(1000); M.registerHmemTierV2({ id: "t1", owner: "o" }); M.activateHmemTierV2("t1"); const r = M.autoDormantIdleHmemTiersV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getHmemTierV2("t1").status).toBe("dormant"); });
    it("autoFailStuck", () => { M.registerHmemTierV2({ id: "t1", owner: "o" }); M.activateHmemTierV2("t1"); M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); M.startHmemPromotionV2("p1"); M.setHmemPromotionStuckMsV2(100); const r = M.autoFailStuckHmemPromotionsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getHmemPromotionV2("p1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => { const s = M.getHierarchicalMemoryGovStatsV2(); expect(s.tiersByStatus.pending).toBe(0); expect(s.promotionsByStatus.queued).toBe(0); });
    it("counts", () => { M.registerHmemTierV2({ id: "t1", owner: "o" }); M.activateHmemTierV2("t1"); M.createHmemPromotionV2({ id: "p1", tierId: "t1" }); const s = M.getHierarchicalMemoryGovStatsV2(); expect(s.totalTiersV2).toBe(1); expect(s.totalPromotionsV2).toBe(1); });
  });
});
