import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evomap-manager.js";

describe("EvoMap Manager V2 Surface", () => {
  beforeEach(() => M._resetStateEvoMapManagerV2());

  describe("enums", () => {
    it("map maturity has 4 states", () => expect(Object.keys(M.EVOMAP_MAP_MATURITY_V2)).toHaveLength(4));
    it("evolution lifecycle has 5 states", () => expect(Object.keys(M.EVOMAP_EVOLUTION_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.EVOMAP_MAP_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.EVOMAP_EVOLUTION_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActiveEvoMapsPerOwnerV2", () => { M.setMaxActiveEvoMapsPerOwnerV2(25); expect(M.getMaxActiveEvoMapsPerOwnerV2()).toBe(25); });
    it("setMaxPendingEvoEvolutionsPerMapV2", () => { M.setMaxPendingEvoEvolutionsPerMapV2(40); expect(M.getMaxPendingEvoEvolutionsPerMapV2()).toBe(40); });
    it("setEvoMapIdleMsV2", () => { M.setEvoMapIdleMsV2(3600000); expect(M.getEvoMapIdleMsV2()).toBe(3600000); });
    it("setEvoEvolutionStuckMsV2", () => { M.setEvoEvolutionStuckMsV2(60000); expect(M.getEvoEvolutionStuckMsV2()).toBe(60000); });
    it("rejects zero", () => expect(() => M.setMaxActiveEvoMapsPerOwnerV2(0)).toThrow());
    it("rejects negative", () => expect(() => M.setEvoEvolutionStuckMsV2(-1)).toThrow());
    it("floors decimals", () => { M.setMaxPendingEvoEvolutionsPerMapV2(8.7); expect(M.getMaxPendingEvoEvolutionsPerMapV2()).toBe(8); });
  });

  describe("map lifecycle", () => {
    it("register", () => { const m = M.registerEvoMapV2({ id: "m1", owner: "alice" }); expect(m.status).toBe("pending"); });
    it("activate stamps activatedAt", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); const m = M.activateEvoMapV2("m1"); expect(m.status).toBe("active"); expect(m.activatedAt).toBeTruthy(); });
    it("stale active→stale", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); M.activateEvoMapV2("m1"); expect(M.staleEvoMapV2("m1").status).toBe("stale"); });
    it("recovery stale→active preserves activatedAt", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); const m = M.activateEvoMapV2("m1"); M.staleEvoMapV2("m1"); const re = M.activateEvoMapV2("m1"); expect(re.activatedAt).toBe(m.activatedAt); });
    it("archive terminal stamps archivedAt", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); M.activateEvoMapV2("m1"); const m = M.archiveEvoMapV2("m1"); expect(m.status).toBe("archived"); expect(m.archivedAt).toBeTruthy(); });
    it("cannot touch archived", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); M.activateEvoMapV2("m1"); M.archiveEvoMapV2("m1"); expect(() => M.touchEvoMapV2("m1")).toThrow(); });
    it("invalid transition rejected", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); expect(() => M.staleEvoMapV2("m1")).toThrow(); });
    it("duplicate rejected", () => { M.registerEvoMapV2({ id: "m1", owner: "alice" }); expect(() => M.registerEvoMapV2({ id: "m1", owner: "b" })).toThrow(); });
    it("missing owner rejected", () => expect(() => M.registerEvoMapV2({ id: "m1" })).toThrow());
    it("list all", () => { M.registerEvoMapV2({ id: "m1", owner: "a" }); M.registerEvoMapV2({ id: "m2", owner: "b" }); expect(M.listEvoMapsV2()).toHaveLength(2); });
    it("get null unknown", () => expect(M.getEvoMapV2("none")).toBeNull());
    it("defensive copy", () => { M.registerEvoMapV2({ id: "m1", owner: "a", metadata: { k: 5 } }); const m = M.getEvoMapV2("m1"); m.metadata.k = 99; expect(M.getEvoMapV2("m1").metadata.k).toBe(5); });
  });

  describe("active-map cap", () => {
    it("enforced on pending→active", () => { M.setMaxActiveEvoMapsPerOwnerV2(2); ["m1","m2","m3"].forEach(id => M.registerEvoMapV2({ id, owner: "o" })); M.activateEvoMapV2("m1"); M.activateEvoMapV2("m2"); expect(() => M.activateEvoMapV2("m3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveEvoMapsPerOwnerV2(2); ["m1","m2","m3"].forEach(id => M.registerEvoMapV2({ id, owner: "o" })); M.activateEvoMapV2("m1"); M.activateEvoMapV2("m2"); M.staleEvoMapV2("m1"); M.activateEvoMapV2("m3"); expect(() => M.activateEvoMapV2("m1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveEvoMapsPerOwnerV2(1); M.registerEvoMapV2({ id: "m1", owner: "o1" }); M.registerEvoMapV2({ id: "m2", owner: "o2" }); M.activateEvoMapV2("m1"); expect(() => M.activateEvoMapV2("m2")).not.toThrow(); });
  });

  describe("evolution lifecycle", () => {
    beforeEach(() => { M.registerEvoMapV2({ id: "m1", owner: "o" }); M.activateEvoMapV2("m1"); });
    it("create→start→complete", () => { M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); M.startEvoEvolutionV2("e1"); const e = M.completeEvoEvolutionV2("e1"); expect(e.status).toBe("completed"); });
    it("fail stores reason", () => { M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); M.startEvoEvolutionV2("e1"); const e = M.failEvoEvolutionV2("e1", "err"); expect(e.metadata.failReason).toBe("err"); });
    it("cancel queued", () => { M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); expect(M.cancelEvoEvolutionV2("e1").status).toBe("cancelled"); });
    it("cannot complete from queued", () => { M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); expect(() => M.completeEvoEvolutionV2("e1")).toThrow(); });
    it("unknown map rejected", () => expect(() => M.createEvoEvolutionV2({ id: "e1", mapId: "none" })).toThrow());
    it("per-map pending cap", () => { M.setMaxPendingEvoEvolutionsPerMapV2(2); ["e1","e2"].forEach(id => M.createEvoEvolutionV2({ id, mapId: "m1" })); expect(() => M.createEvoEvolutionV2({ id: "e3", mapId: "m1" })).toThrow(/max pending/); });
    it("running counts as pending", () => { M.setMaxPendingEvoEvolutionsPerMapV2(1); M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); M.startEvoEvolutionV2("e1"); expect(() => M.createEvoEvolutionV2({ id: "e2", mapId: "m1" })).toThrow(); });
    it("completed frees slot", () => { M.setMaxPendingEvoEvolutionsPerMapV2(1); M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); M.startEvoEvolutionV2("e1"); M.completeEvoEvolutionV2("e1"); expect(() => M.createEvoEvolutionV2({ id: "e2", mapId: "m1" })).not.toThrow(); });
    it("default strategy", () => { M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); expect(M.getEvoEvolutionV2("e1").strategy).toBe("default"); });
    it("strategy preserved", () => { M.createEvoEvolutionV2({ id: "e1", mapId: "m1", strategy: "genetic" }); expect(M.getEvoEvolutionV2("e1").strategy).toBe("genetic"); });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => { M.setEvoMapIdleMsV2(1000); M.registerEvoMapV2({ id: "m1", owner: "o" }); M.activateEvoMapV2("m1"); const r = M.autoStaleIdleEvoMapsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getEvoMapV2("m1").status).toBe("stale"); });
    it("autoFailStuck", () => { M.registerEvoMapV2({ id: "m1", owner: "o" }); M.activateEvoMapV2("m1"); M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); M.startEvoEvolutionV2("e1"); M.setEvoEvolutionStuckMsV2(100); const r = M.autoFailStuckEvoEvolutionsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getEvoEvolutionV2("e1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => { const s = M.getEvoMapManagerStatsV2(); expect(s.mapsByStatus.pending).toBe(0); expect(s.evosByStatus.queued).toBe(0); });
    it("counts", () => { M.registerEvoMapV2({ id: "m1", owner: "o" }); M.activateEvoMapV2("m1"); M.createEvoEvolutionV2({ id: "e1", mapId: "m1" }); const s = M.getEvoMapManagerStatsV2(); expect(s.totalMapsV2).toBe(1); expect(s.totalEvolutionsV2).toBe(1); });
  });
});
