import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/browser-automation.js";

describe("Browser Automation V2 Surface", () => {
  beforeEach(() => M._resetStateBrowserAutomationV2());

  describe("enums", () => {
    it("target maturity has 4 states", () => expect(Object.keys(M.BROWSE_TARGET_MATURITY_V2)).toHaveLength(4));
    it("action lifecycle has 5 states", () => expect(Object.keys(M.BROWSE_ACTION_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.BROWSE_TARGET_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.BROWSE_ACTION_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config setters", () => {
    it("setMaxActiveBrowseTargetsPerOwnerV2", () => { M.setMaxActiveBrowseTargetsPerOwnerV2(15); expect(M.getMaxActiveBrowseTargetsPerOwnerV2()).toBe(15); });
    it("setMaxPendingBrowseActionsPerTargetV2", () => { M.setMaxPendingBrowseActionsPerTargetV2(50); expect(M.getMaxPendingBrowseActionsPerTargetV2()).toBe(50); });
    it("setBrowseTargetIdleMsV2", () => { M.setBrowseTargetIdleMsV2(1000); expect(M.getBrowseTargetIdleMsV2()).toBe(1000); });
    it("setBrowseActionStuckMsV2", () => { M.setBrowseActionStuckMsV2(500); expect(M.getBrowseActionStuckMsV2()).toBe(500); });
    it("rejects zero", () => expect(() => M.setMaxActiveBrowseTargetsPerOwnerV2(0)).toThrow());
    it("rejects negative", () => expect(() => M.setBrowseActionStuckMsV2(-5)).toThrow());
    it("floors decimals", () => { M.setMaxPendingBrowseActionsPerTargetV2(5.9); expect(M.getMaxPendingBrowseActionsPerTargetV2()).toBe(5); });
  });

  describe("target lifecycle", () => {
    it("register starts pending", () => { const t = M.registerBrowseTargetV2({ id: "t1", owner: "a", url: "https://example.com" }); expect(t.status).toBe("pending"); });
    it("activate pending→active", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); const t = M.activateBrowseTargetV2("t1"); expect(t.status).toBe("active"); expect(t.activatedAt).toBeTruthy(); });
    it("degrade active→degraded", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); expect(M.degradeBrowseTargetV2("t1").status).toBe("degraded"); });
    it("recovery degraded→active preserves activatedAt", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); const a = M.activateBrowseTargetV2("t1"); M.degradeBrowseTargetV2("t1"); const r = M.activateBrowseTargetV2("t1"); expect(r.activatedAt).toBe(a.activatedAt); });
    it("retire terminal", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); const t = M.retireBrowseTargetV2("t1"); expect(t.status).toBe("retired"); expect(t.retiredAt).toBeTruthy(); });
    it("cannot touch retired", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); M.retireBrowseTargetV2("t1"); expect(() => M.touchBrowseTargetV2("t1")).toThrow(); });
    it("invalid transition", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); expect(() => M.degradeBrowseTargetV2("t1")).toThrow(); });
    it("duplicate id rejected", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); expect(() => M.registerBrowseTargetV2({ id: "t1", owner: "b" })).toThrow(); });
    it("missing owner rejected", () => expect(() => M.registerBrowseTargetV2({ id: "t1" })).toThrow());
    it("list returns all", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.registerBrowseTargetV2({ id: "t2", owner: "b" }); expect(M.listBrowseTargetsV2()).toHaveLength(2); });
    it("get returns null for unknown", () => expect(M.getBrowseTargetV2("x")).toBeNull());
    it("defensive copy", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a", metadata: { k: 1 } }); const t = M.getBrowseTargetV2("t1"); t.metadata.k = 99; expect(M.getBrowseTargetV2("t1").metadata.k).toBe(1); });
  });

  describe("active-target cap", () => {
    it("enforced on pending→active", () => { M.setMaxActiveBrowseTargetsPerOwnerV2(2); ["t1","t2","t3"].forEach(id => M.registerBrowseTargetV2({ id, owner: "a" })); M.activateBrowseTargetV2("t1"); M.activateBrowseTargetV2("t2"); expect(() => M.activateBrowseTargetV2("t3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveBrowseTargetsPerOwnerV2(2); ["t1","t2","t3"].forEach(id => M.registerBrowseTargetV2({ id, owner: "a" })); M.activateBrowseTargetV2("t1"); M.activateBrowseTargetV2("t2"); M.degradeBrowseTargetV2("t1"); M.activateBrowseTargetV2("t3"); expect(() => M.activateBrowseTargetV2("t1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveBrowseTargetsPerOwnerV2(1); M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.registerBrowseTargetV2({ id: "t2", owner: "b" }); M.activateBrowseTargetV2("t1"); expect(() => M.activateBrowseTargetV2("t2")).not.toThrow(); });
  });

  describe("action lifecycle", () => {
    beforeEach(() => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); });
    it("create→start→complete", () => { M.createBrowseActionV2({ id: "a1", targetId: "t1" }); M.startBrowseActionV2("a1"); const a = M.completeBrowseActionV2("a1"); expect(a.status).toBe("completed"); });
    it("fail from running", () => { M.createBrowseActionV2({ id: "a1", targetId: "t1" }); M.startBrowseActionV2("a1"); const a = M.failBrowseActionV2("a1", "net"); expect(a.metadata.failReason).toBe("net"); });
    it("cancel from queued", () => { M.createBrowseActionV2({ id: "a1", targetId: "t1" }); expect(M.cancelBrowseActionV2("a1").status).toBe("cancelled"); });
    it("cannot complete from queued", () => { M.createBrowseActionV2({ id: "a1", targetId: "t1" }); expect(() => M.completeBrowseActionV2("a1")).toThrow(); });
    it("unknown target rejected", () => expect(() => M.createBrowseActionV2({ id: "a1", targetId: "nope" })).toThrow());
    it("per-target pending cap", () => { M.setMaxPendingBrowseActionsPerTargetV2(2); ["a1","a2"].forEach(id => M.createBrowseActionV2({ id, targetId: "t1" })); expect(() => M.createBrowseActionV2({ id: "a3", targetId: "t1" })).toThrow(/max pending/); });
    it("running counts toward pending", () => { M.setMaxPendingBrowseActionsPerTargetV2(1); M.createBrowseActionV2({ id: "a1", targetId: "t1" }); M.startBrowseActionV2("a1"); expect(() => M.createBrowseActionV2({ id: "a2", targetId: "t1" })).toThrow(); });
    it("completed frees slot", () => { M.setMaxPendingBrowseActionsPerTargetV2(1); M.createBrowseActionV2({ id: "a1", targetId: "t1" }); M.startBrowseActionV2("a1"); M.completeBrowseActionV2("a1"); expect(() => M.createBrowseActionV2({ id: "a2", targetId: "t1" })).not.toThrow(); });
  });

  describe("auto flips", () => {
    it("autoDegradeIdle", () => { M.setBrowseTargetIdleMsV2(1000); M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); const r = M.autoDegradeIdleBrowseTargetsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getBrowseTargetV2("t1").status).toBe("degraded"); });
    it("autoFailStuck", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); M.createBrowseActionV2({ id: "a1", targetId: "t1" }); M.startBrowseActionV2("a1"); M.setBrowseActionStuckMsV2(100); const r = M.autoFailStuckBrowseActionsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getBrowseActionV2("a1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("includes all status keys", () => { const s = M.getBrowserAutomationStatsV2(); expect(s.targetsByStatus.pending).toBe(0); expect(s.actionsByStatus.queued).toBe(0); });
    it("counts", () => { M.registerBrowseTargetV2({ id: "t1", owner: "a" }); M.activateBrowseTargetV2("t1"); M.createBrowseActionV2({ id: "a1", targetId: "t1" }); const s = M.getBrowserAutomationStatsV2(); expect(s.totalTargetsV2).toBe(1); expect(s.totalActionsV2).toBe(1); });
  });
});
