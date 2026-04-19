import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/evolution-system.js";

describe("Evolution System V2 Surface", () => {
  beforeEach(() => M._resetStateEvolutionSystemV2());

  describe("enums", () => {
    it("goal maturity has 4 states", () => expect(Object.keys(M.EVO_GOAL_MATURITY_V2)).toHaveLength(4));
    it("cycle lifecycle has 5 states", () => expect(Object.keys(M.EVO_CYCLE_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.EVO_GOAL_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.EVO_CYCLE_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActiveEvoGoalsPerOwnerV2", () => { M.setMaxActiveEvoGoalsPerOwnerV2(10); expect(M.getMaxActiveEvoGoalsPerOwnerV2()).toBe(10); });
    it("setMaxPendingEvoCyclesPerGoalV2", () => { M.setMaxPendingEvoCyclesPerGoalV2(20); expect(M.getMaxPendingEvoCyclesPerGoalV2()).toBe(20); });
    it("setEvoGoalIdleMsV2", () => { M.setEvoGoalIdleMsV2(3600000); expect(M.getEvoGoalIdleMsV2()).toBe(3600000); });
    it("setEvoCycleStuckMsV2", () => { M.setEvoCycleStuckMsV2(60000); expect(M.getEvoCycleStuckMsV2()).toBe(60000); });
    it("rejects zero", () => expect(() => M.setMaxActiveEvoGoalsPerOwnerV2(0)).toThrow());
    it("rejects negative", () => expect(() => M.setEvoCycleStuckMsV2(-1)).toThrow());
    it("floors decimals", () => { M.setMaxPendingEvoCyclesPerGoalV2(6.8); expect(M.getMaxPendingEvoCyclesPerGoalV2()).toBe(6); });
  });

  describe("goal lifecycle", () => {
    it("register", () => { const g = M.registerEvoGoalV2({ id: "g1", owner: "alice" }); expect(g.status).toBe("pending"); });
    it("activate stamps activatedAt", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); const g = M.activateEvoGoalV2("g1"); expect(g.status).toBe("active"); expect(g.activatedAt).toBeTruthy(); });
    it("pause active→paused", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); M.activateEvoGoalV2("g1"); expect(M.pauseEvoGoalV2("g1").status).toBe("paused"); });
    it("recovery paused→active preserves activatedAt", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); const g = M.activateEvoGoalV2("g1"); M.pauseEvoGoalV2("g1"); const re = M.activateEvoGoalV2("g1"); expect(re.activatedAt).toBe(g.activatedAt); });
    it("archive terminal stamps archivedAt", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); M.activateEvoGoalV2("g1"); const g = M.archiveEvoGoalV2("g1"); expect(g.status).toBe("archived"); expect(g.archivedAt).toBeTruthy(); });
    it("cannot touch archived", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); M.activateEvoGoalV2("g1"); M.archiveEvoGoalV2("g1"); expect(() => M.touchEvoGoalV2("g1")).toThrow(); });
    it("invalid transition rejected", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); expect(() => M.pauseEvoGoalV2("g1")).toThrow(); });
    it("duplicate rejected", () => { M.registerEvoGoalV2({ id: "g1", owner: "alice" }); expect(() => M.registerEvoGoalV2({ id: "g1", owner: "b" })).toThrow(); });
    it("missing owner rejected", () => expect(() => M.registerEvoGoalV2({ id: "g1" })).toThrow());
    it("list all", () => { M.registerEvoGoalV2({ id: "g1", owner: "a" }); M.registerEvoGoalV2({ id: "g2", owner: "b" }); expect(M.listEvoGoalsV2()).toHaveLength(2); });
    it("get null unknown", () => expect(M.getEvoGoalV2("none")).toBeNull());
    it("defensive copy metadata", () => { M.registerEvoGoalV2({ id: "g1", owner: "a", metadata: { k: 5 } }); const g = M.getEvoGoalV2("g1"); g.metadata.k = 99; expect(M.getEvoGoalV2("g1").metadata.k).toBe(5); });
    it("default objective empty", () => { M.registerEvoGoalV2({ id: "g1", owner: "a" }); expect(M.getEvoGoalV2("g1").objective).toBe(""); });
    it("objective preserved", () => { M.registerEvoGoalV2({ id: "g1", owner: "a", objective: "optimize X" }); expect(M.getEvoGoalV2("g1").objective).toBe("optimize X"); });
  });

  describe("active-goal cap", () => {
    it("enforced on pending→active", () => { M.setMaxActiveEvoGoalsPerOwnerV2(2); ["g1","g2","g3"].forEach(id => M.registerEvoGoalV2({ id, owner: "o" })); M.activateEvoGoalV2("g1"); M.activateEvoGoalV2("g2"); expect(() => M.activateEvoGoalV2("g3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveEvoGoalsPerOwnerV2(2); ["g1","g2","g3"].forEach(id => M.registerEvoGoalV2({ id, owner: "o" })); M.activateEvoGoalV2("g1"); M.activateEvoGoalV2("g2"); M.pauseEvoGoalV2("g1"); M.activateEvoGoalV2("g3"); expect(() => M.activateEvoGoalV2("g1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveEvoGoalsPerOwnerV2(1); M.registerEvoGoalV2({ id: "g1", owner: "o1" }); M.registerEvoGoalV2({ id: "g2", owner: "o2" }); M.activateEvoGoalV2("g1"); expect(() => M.activateEvoGoalV2("g2")).not.toThrow(); });
  });

  describe("cycle lifecycle", () => {
    beforeEach(() => { M.registerEvoGoalV2({ id: "g1", owner: "o" }); M.activateEvoGoalV2("g1"); });
    it("create→start→complete", () => { M.createEvoCycleV2({ id: "c1", goalId: "g1" }); M.startEvoCycleV2("c1"); const c = M.completeEvoCycleV2("c1"); expect(c.status).toBe("completed"); });
    it("fail stores reason", () => { M.createEvoCycleV2({ id: "c1", goalId: "g1" }); M.startEvoCycleV2("c1"); const c = M.failEvoCycleV2("c1", "err"); expect(c.metadata.failReason).toBe("err"); });
    it("cancel queued", () => { M.createEvoCycleV2({ id: "c1", goalId: "g1" }); expect(M.cancelEvoCycleV2("c1").status).toBe("cancelled"); });
    it("cannot complete from queued", () => { M.createEvoCycleV2({ id: "c1", goalId: "g1" }); expect(() => M.completeEvoCycleV2("c1")).toThrow(); });
    it("unknown goal rejected", () => expect(() => M.createEvoCycleV2({ id: "c1", goalId: "none" })).toThrow());
    it("per-goal pending cap", () => { M.setMaxPendingEvoCyclesPerGoalV2(2); ["c1","c2"].forEach(id => M.createEvoCycleV2({ id, goalId: "g1" })); expect(() => M.createEvoCycleV2({ id: "c3", goalId: "g1" })).toThrow(/max pending/); });
    it("running counts as pending", () => { M.setMaxPendingEvoCyclesPerGoalV2(1); M.createEvoCycleV2({ id: "c1", goalId: "g1" }); M.startEvoCycleV2("c1"); expect(() => M.createEvoCycleV2({ id: "c2", goalId: "g1" })).toThrow(); });
    it("completed frees slot", () => { M.setMaxPendingEvoCyclesPerGoalV2(1); M.createEvoCycleV2({ id: "c1", goalId: "g1" }); M.startEvoCycleV2("c1"); M.completeEvoCycleV2("c1"); expect(() => M.createEvoCycleV2({ id: "c2", goalId: "g1" })).not.toThrow(); });
    it("default generation 0", () => { M.createEvoCycleV2({ id: "c1", goalId: "g1" }); expect(M.getEvoCycleV2("c1").generation).toBe(0); });
    it("generation preserved", () => { M.createEvoCycleV2({ id: "c1", goalId: "g1", generation: 7 }); expect(M.getEvoCycleV2("c1").generation).toBe(7); });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => { M.setEvoGoalIdleMsV2(1000); M.registerEvoGoalV2({ id: "g1", owner: "o" }); M.activateEvoGoalV2("g1"); const r = M.autoPauseIdleEvoGoalsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getEvoGoalV2("g1").status).toBe("paused"); });
    it("autoFailStuck", () => { M.registerEvoGoalV2({ id: "g1", owner: "o" }); M.activateEvoGoalV2("g1"); M.createEvoCycleV2({ id: "c1", goalId: "g1" }); M.startEvoCycleV2("c1"); M.setEvoCycleStuckMsV2(100); const r = M.autoFailStuckEvoCyclesV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getEvoCycleV2("c1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => { const s = M.getEvolutionSystemGovStatsV2(); expect(s.goalsByStatus.pending).toBe(0); expect(s.cyclesByStatus.queued).toBe(0); });
    it("counts", () => { M.registerEvoGoalV2({ id: "g1", owner: "o" }); M.activateEvoGoalV2("g1"); M.createEvoCycleV2({ id: "c1", goalId: "g1" }); const s = M.getEvolutionSystemGovStatsV2(); expect(s.totalGoalsV2).toBe(1); expect(s.totalCyclesV2).toBe(1); });
  });
});
