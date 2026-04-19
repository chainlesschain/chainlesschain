import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cowork-cron.js";

describe("Cowork Cron V2 Surface", () => {
  beforeEach(() => M._resetStateCoworkCronV2());

  describe("enums", () => {
    it("4 maturity states", () => expect(Object.keys(M.CCRON_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () => expect(Object.keys(M.CCRON_TICK_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => { expect(Object.isFrozen(M.CCRON_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.CCRON_TICK_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActive", () => { M.setMaxActiveCcronProfilesPerOwnerV2(11); expect(M.getMaxActiveCcronProfilesPerOwnerV2()).toBe(11); });
    it("setMaxPending", () => { M.setMaxPendingCcronTicksPerProfileV2(33); expect(M.getMaxPendingCcronTicksPerProfileV2()).toBe(33); });
    it("setIdle", () => { M.setCcronProfileIdleMsV2(60000); expect(M.getCcronProfileIdleMsV2()).toBe(60000); });
    it("setStuck", () => { M.setCcronTickStuckMsV2(45000); expect(M.getCcronTickStuckMsV2()).toBe(45000); });
    it("rejects 0", () => expect(() => M.setMaxActiveCcronProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setCcronTickStuckMsV2("x")).toThrow());
    it("floors decimals", () => { M.setMaxActiveCcronProfilesPerOwnerV2(7.9); expect(M.getMaxActiveCcronProfilesPerOwnerV2()).toBe(7); });
  });

  describe("profile lifecycle", () => {
    it("register pending", () => expect(M.registerCcronProfileV2({ id: "p1", owner: "a" }).status).toBe("pending"));
    it("default expr", () => expect(M.registerCcronProfileV2({ id: "p1", owner: "a" }).expr).toBe("0 0 * * *"));
    it("activate", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); expect(M.activateCcronProfileV2("p1").status).toBe("active"); });
    it("pause", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); expect(M.pauseCcronProfileV2("p1").status).toBe("paused"); });
    it("recovery preserves activatedAt", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); const a = M.activateCcronProfileV2("p1"); M.pauseCcronProfileV2("p1"); expect(M.activateCcronProfileV2("p1").activatedAt).toBe(a.activatedAt); });
    it("archive terminal", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); expect(M.archiveCcronProfileV2("p1").status).toBe("archived"); });
    it("cannot touch archived", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); M.archiveCcronProfileV2("p1"); expect(() => M.touchCcronProfileV2("p1")).toThrow(); });
    it("invalid transition", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); expect(() => M.pauseCcronProfileV2("p1")).toThrow(); });
    it("duplicate rejected", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); expect(() => M.registerCcronProfileV2({ id: "p1", owner: "b" })).toThrow(); });
    it("missing owner", () => expect(() => M.registerCcronProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getCcronProfileV2("nope")).toBeNull());
    it("list all", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.registerCcronProfileV2({ id: "p2", owner: "b" }); expect(M.listCcronProfilesV2()).toHaveLength(2); });
    it("defensive copy", () => { M.registerCcronProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } }); const p = M.getCcronProfileV2("p1"); p.metadata.x = 99; expect(M.getCcronProfileV2("p1").metadata.x).toBe(1); });
  });

  describe("active cap", () => {
    it("enforced", () => { M.setMaxActiveCcronProfilesPerOwnerV2(2); ["p1","p2","p3"].forEach(id => M.registerCcronProfileV2({ id, owner: "a" })); M.activateCcronProfileV2("p1"); M.activateCcronProfileV2("p2"); expect(() => M.activateCcronProfileV2("p3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveCcronProfilesPerOwnerV2(2); ["p1","p2","p3"].forEach(id => M.registerCcronProfileV2({ id, owner: "a" })); M.activateCcronProfileV2("p1"); M.activateCcronProfileV2("p2"); M.pauseCcronProfileV2("p1"); M.activateCcronProfileV2("p3"); expect(() => M.activateCcronProfileV2("p1")).not.toThrow(); });
    it("per-owner", () => { M.setMaxActiveCcronProfilesPerOwnerV2(1); M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.registerCcronProfileV2({ id: "p2", owner: "b" }); M.activateCcronProfileV2("p1"); expect(() => M.activateCcronProfileV2("p2")).not.toThrow(); });
  });

  describe("tick lifecycle", () => {
    beforeEach(() => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); });
    it("create→running→complete", () => { M.createCcronTickV2({ id: "t1", profileId: "p1" }); M.runningCcronTickV2("t1"); const t = M.completeCcronTickV2("t1"); expect(t.status).toBe("completed"); });
    it("fail", () => { M.createCcronTickV2({ id: "t1", profileId: "p1" }); M.runningCcronTickV2("t1"); expect(M.failCcronTickV2("t1", "x").metadata.failReason).toBe("x"); });
    it("cancel from queued", () => { M.createCcronTickV2({ id: "t1", profileId: "p1" }); expect(M.cancelCcronTickV2("t1").status).toBe("cancelled"); });
    it("invalid complete from queued", () => { M.createCcronTickV2({ id: "t1", profileId: "p1" }); expect(() => M.completeCcronTickV2("t1")).toThrow(); });
    it("unknown profile", () => expect(() => M.createCcronTickV2({ id: "t1", profileId: "none" })).toThrow());
    it("pending cap", () => { M.setMaxPendingCcronTicksPerProfileV2(2); ["t1","t2"].forEach(id => M.createCcronTickV2({ id, profileId: "p1" })); expect(() => M.createCcronTickV2({ id: "t3", profileId: "p1" })).toThrow(/max pending/); });
    it("running counts as pending", () => { M.setMaxPendingCcronTicksPerProfileV2(1); M.createCcronTickV2({ id: "t1", profileId: "p1" }); M.runningCcronTickV2("t1"); expect(() => M.createCcronTickV2({ id: "t2", profileId: "p1" })).toThrow(); });
    it("completed frees slot", () => { M.setMaxPendingCcronTicksPerProfileV2(1); M.createCcronTickV2({ id: "t1", profileId: "p1" }); M.runningCcronTickV2("t1"); M.completeCcronTickV2("t1"); expect(() => M.createCcronTickV2({ id: "t2", profileId: "p1" })).not.toThrow(); });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => { M.setCcronProfileIdleMsV2(1000); M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); const r = M.autoPauseIdleCcronProfilesV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getCcronProfileV2("p1").status).toBe("paused"); });
    it("autoFailStuck", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); M.createCcronTickV2({ id: "t1", profileId: "p1" }); M.runningCcronTickV2("t1"); M.setCcronTickStuckMsV2(100); const r = M.autoFailStuckCcronTicksV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); });
  });

  describe("stats", () => {
    it("zero-init", () => { const s = M.getCoworkCronGovStatsV2(); expect(s.profilesByStatus.pending).toBe(0); expect(s.ticksByStatus.queued).toBe(0); });
    it("counts", () => { M.registerCcronProfileV2({ id: "p1", owner: "a" }); M.activateCcronProfileV2("p1"); M.createCcronTickV2({ id: "t1", profileId: "p1" }); const s = M.getCoworkCronGovStatsV2(); expect(s.totalCcronProfilesV2).toBe(1); expect(s.totalCcronTicksV2).toBe(1); });
  });
});
