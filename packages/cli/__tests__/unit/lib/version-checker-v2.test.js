import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/version-checker.js";

describe("Version Checker V2 Surface", () => {
  beforeEach(() => M._resetStateVersionCheckerV2());

  describe("enums", () => {
    it("4 maturity states", () => expect(Object.keys(M.VCHK_PROFILE_MATURITY_V2)).toHaveLength(4));
    it("5 lifecycle states", () => expect(Object.keys(M.VCHK_CHECK_LIFECYCLE_V2)).toHaveLength(5));
    it("frozen", () => { expect(Object.isFrozen(M.VCHK_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.VCHK_CHECK_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActive", () => { M.setMaxActiveVchkProfilesPerOwnerV2(11); expect(M.getMaxActiveVchkProfilesPerOwnerV2()).toBe(11); });
    it("setMaxPending", () => { M.setMaxPendingVchkChecksPerProfileV2(33); expect(M.getMaxPendingVchkChecksPerProfileV2()).toBe(33); });
    it("setIdle", () => { M.setVchkProfileIdleMsV2(60000); expect(M.getVchkProfileIdleMsV2()).toBe(60000); });
    it("setStuck", () => { M.setVchkCheckStuckMsV2(45000); expect(M.getVchkCheckStuckMsV2()).toBe(45000); });
    it("rejects 0", () => expect(() => M.setMaxActiveVchkProfilesPerOwnerV2(0)).toThrow());
    it("rejects NaN", () => expect(() => M.setVchkCheckStuckMsV2("x")).toThrow());
    it("floors decimals", () => { M.setMaxActiveVchkProfilesPerOwnerV2(7.9); expect(M.getMaxActiveVchkProfilesPerOwnerV2()).toBe(7); });
  });

  describe("profile lifecycle", () => {
    it("register pending", () => expect(M.registerVchkProfileV2({ id: "p1", owner: "a" }).status).toBe("pending"));
    it("default channel", () => expect(M.registerVchkProfileV2({ id: "p1", owner: "a" }).channel).toBe("stable"));
    it("activate", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); expect(M.activateVchkProfileV2("p1").status).toBe("active"); });
    it("stale", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); expect(M.staleVchkProfileV2("p1").status).toBe("stale"); });
    it("recovery preserves activatedAt", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); const a = M.activateVchkProfileV2("p1"); M.staleVchkProfileV2("p1"); expect(M.activateVchkProfileV2("p1").activatedAt).toBe(a.activatedAt); });
    it("archive terminal", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); expect(M.archiveVchkProfileV2("p1").status).toBe("archived"); });
    it("cannot touch archived", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); M.archiveVchkProfileV2("p1"); expect(() => M.touchVchkProfileV2("p1")).toThrow(); });
    it("invalid transition", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); expect(() => M.staleVchkProfileV2("p1")).toThrow(); });
    it("duplicate rejected", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); expect(() => M.registerVchkProfileV2({ id: "p1", owner: "b" })).toThrow(); });
    it("missing owner", () => expect(() => M.registerVchkProfileV2({ id: "p1" })).toThrow());
    it("get null", () => expect(M.getVchkProfileV2("nope")).toBeNull());
    it("list all", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.registerVchkProfileV2({ id: "p2", owner: "b" }); expect(M.listVchkProfilesV2()).toHaveLength(2); });
    it("defensive copy", () => { M.registerVchkProfileV2({ id: "p1", owner: "a", metadata: { x: 1 } }); const p = M.getVchkProfileV2("p1"); p.metadata.x = 99; expect(M.getVchkProfileV2("p1").metadata.x).toBe(1); });
  });

  describe("active cap", () => {
    it("enforced", () => { M.setMaxActiveVchkProfilesPerOwnerV2(2); ["p1","p2","p3"].forEach(id => M.registerVchkProfileV2({ id, owner: "a" })); M.activateVchkProfileV2("p1"); M.activateVchkProfileV2("p2"); expect(() => M.activateVchkProfileV2("p3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveVchkProfilesPerOwnerV2(2); ["p1","p2","p3"].forEach(id => M.registerVchkProfileV2({ id, owner: "a" })); M.activateVchkProfileV2("p1"); M.activateVchkProfileV2("p2"); M.staleVchkProfileV2("p1"); M.activateVchkProfileV2("p3"); expect(() => M.activateVchkProfileV2("p1")).not.toThrow(); });
    it("per-owner", () => { M.setMaxActiveVchkProfilesPerOwnerV2(1); M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.registerVchkProfileV2({ id: "p2", owner: "b" }); M.activateVchkProfileV2("p1"); expect(() => M.activateVchkProfileV2("p2")).not.toThrow(); });
  });

  describe("check lifecycle", () => {
    beforeEach(() => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); });
    it("create→checking→complete", () => { M.createVchkCheckV2({ id: "c1", profileId: "p1" }); M.checkingVchkCheckV2("c1"); const c = M.completeVchkCheckV2("c1"); expect(c.status).toBe("completed"); });
    it("fail", () => { M.createVchkCheckV2({ id: "c1", profileId: "p1" }); M.checkingVchkCheckV2("c1"); expect(M.failVchkCheckV2("c1", "x").metadata.failReason).toBe("x"); });
    it("cancel from queued", () => { M.createVchkCheckV2({ id: "c1", profileId: "p1" }); expect(M.cancelVchkCheckV2("c1").status).toBe("cancelled"); });
    it("invalid complete from queued", () => { M.createVchkCheckV2({ id: "c1", profileId: "p1" }); expect(() => M.completeVchkCheckV2("c1")).toThrow(); });
    it("unknown profile", () => expect(() => M.createVchkCheckV2({ id: "c1", profileId: "none" })).toThrow());
    it("pending cap", () => { M.setMaxPendingVchkChecksPerProfileV2(2); ["c1","c2"].forEach(id => M.createVchkCheckV2({ id, profileId: "p1" })); expect(() => M.createVchkCheckV2({ id: "c3", profileId: "p1" })).toThrow(/max pending/); });
    it("checking counts as pending", () => { M.setMaxPendingVchkChecksPerProfileV2(1); M.createVchkCheckV2({ id: "c1", profileId: "p1" }); M.checkingVchkCheckV2("c1"); expect(() => M.createVchkCheckV2({ id: "c2", profileId: "p1" })).toThrow(); });
    it("completed frees slot", () => { M.setMaxPendingVchkChecksPerProfileV2(1); M.createVchkCheckV2({ id: "c1", profileId: "p1" }); M.checkingVchkCheckV2("c1"); M.completeVchkCheckV2("c1"); expect(() => M.createVchkCheckV2({ id: "c2", profileId: "p1" })).not.toThrow(); });
  });

  describe("auto flips", () => {
    it("autoStaleIdle", () => { M.setVchkProfileIdleMsV2(1000); M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); const r = M.autoStaleIdleVchkProfilesV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getVchkProfileV2("p1").status).toBe("stale"); });
    it("autoFailStuck", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); M.createVchkCheckV2({ id: "c1", profileId: "p1" }); M.checkingVchkCheckV2("c1"); M.setVchkCheckStuckMsV2(100); const r = M.autoFailStuckVchkChecksV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); });
  });

  describe("stats", () => {
    it("zero-init", () => { const s = M.getVersionCheckerGovStatsV2(); expect(s.profilesByStatus.pending).toBe(0); expect(s.checksByStatus.queued).toBe(0); });
    it("counts", () => { M.registerVchkProfileV2({ id: "p1", owner: "a" }); M.activateVchkProfileV2("p1"); M.createVchkCheckV2({ id: "c1", profileId: "p1" }); const s = M.getVersionCheckerGovStatsV2(); expect(s.totalVchkProfilesV2).toBe(1); expect(s.totalVchkChecksV2).toBe(1); });
  });
});
