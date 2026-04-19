import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/nostr-bridge.js";

describe("Nostr Bridge V2 Surface", () => {
  beforeEach(() => M._resetStateNostrBridgeV2());

  describe("enums", () => {
    it("relay maturity has 4 states", () => expect(Object.keys(M.NOSTR_RELAY_MATURITY_V2)).toHaveLength(4));
    it("event lifecycle has 5 states", () => expect(Object.keys(M.NOSTR_EVENT_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.NOSTR_RELAY_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.NOSTR_EVENT_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActiveNostrRelaysPerOwnerV2", () => { M.setMaxActiveNostrRelaysPerOwnerV2(20); expect(M.getMaxActiveNostrRelaysPerOwnerV2()).toBe(20); });
    it("setMaxPendingNostrEventsPerRelayV2", () => { M.setMaxPendingNostrEventsPerRelayV2(50); expect(M.getMaxPendingNostrEventsPerRelayV2()).toBe(50); });
    it("setNostrRelayIdleMsV2", () => { M.setNostrRelayIdleMsV2(1800000); expect(M.getNostrRelayIdleMsV2()).toBe(1800000); });
    it("setNostrEventStuckMsV2", () => { M.setNostrEventStuckMsV2(30000); expect(M.getNostrEventStuckMsV2()).toBe(30000); });
    it("rejects zero", () => expect(() => M.setMaxActiveNostrRelaysPerOwnerV2(0)).toThrow());
    it("rejects negative", () => expect(() => M.setNostrEventStuckMsV2(-1)).toThrow());
    it("floors decimals", () => { M.setMaxPendingNostrEventsPerRelayV2(7.3); expect(M.getMaxPendingNostrEventsPerRelayV2()).toBe(7); });
  });

  describe("relay lifecycle", () => {
    it("register", () => { const r = M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); expect(r.status).toBe("pending"); });
    it("activate", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); const r = M.activateNostrRelayV2("rel1"); expect(r.status).toBe("active"); expect(r.activatedAt).toBeTruthy(); });
    it("offline active→offline", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); M.activateNostrRelayV2("rel1"); expect(M.offlineNostrRelayV2("rel1").status).toBe("offline"); });
    it("recovery offline→active preserves activatedAt", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); const a = M.activateNostrRelayV2("rel1"); M.offlineNostrRelayV2("rel1"); const re = M.activateNostrRelayV2("rel1"); expect(re.activatedAt).toBe(a.activatedAt); });
    it("retire terminal", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); M.activateNostrRelayV2("rel1"); const r = M.retireNostrRelayV2("rel1"); expect(r.status).toBe("retired"); expect(r.retiredAt).toBeTruthy(); });
    it("cannot touch retired", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); M.activateNostrRelayV2("rel1"); M.retireNostrRelayV2("rel1"); expect(() => M.touchNostrRelayV2("rel1")).toThrow(); });
    it("invalid transition", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); expect(() => M.offlineNostrRelayV2("rel1")).toThrow(); });
    it("duplicate rejected", () => { M.registerNostrRelayV2({ id: "rel1", owner: "alice" }); expect(() => M.registerNostrRelayV2({ id: "rel1", owner: "b" })).toThrow(); });
    it("missing owner", () => expect(() => M.registerNostrRelayV2({ id: "rel1" })).toThrow());
    it("list all", () => { M.registerNostrRelayV2({ id: "rel1", owner: "a" }); M.registerNostrRelayV2({ id: "rel2", owner: "b" }); expect(M.listNostrRelaysV2()).toHaveLength(2); });
    it("get null unknown", () => expect(M.getNostrRelayV2("none")).toBeNull());
    it("defensive copy", () => { M.registerNostrRelayV2({ id: "rel1", owner: "a", metadata: { k: 5 } }); const r = M.getNostrRelayV2("rel1"); r.metadata.k = 99; expect(M.getNostrRelayV2("rel1").metadata.k).toBe(5); });
  });

  describe("active-relay cap", () => {
    it("enforced", () => { M.setMaxActiveNostrRelaysPerOwnerV2(2); ["r1","r2","r3"].forEach(id => M.registerNostrRelayV2({ id, owner: "a" })); M.activateNostrRelayV2("r1"); M.activateNostrRelayV2("r2"); expect(() => M.activateNostrRelayV2("r3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveNostrRelaysPerOwnerV2(2); ["r1","r2","r3"].forEach(id => M.registerNostrRelayV2({ id, owner: "a" })); M.activateNostrRelayV2("r1"); M.activateNostrRelayV2("r2"); M.offlineNostrRelayV2("r1"); M.activateNostrRelayV2("r3"); expect(() => M.activateNostrRelayV2("r1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveNostrRelaysPerOwnerV2(1); M.registerNostrRelayV2({ id: "r1", owner: "a" }); M.registerNostrRelayV2({ id: "r2", owner: "b" }); M.activateNostrRelayV2("r1"); expect(() => M.activateNostrRelayV2("r2")).not.toThrow(); });
  });

  describe("event lifecycle", () => {
    beforeEach(() => { M.registerNostrRelayV2({ id: "r1", owner: "a" }); M.activateNostrRelayV2("r1"); });
    it("create→start→publish", () => { M.createNostrEventV2({ id: "e1", relayId: "r1" }); M.startNostrEventV2("e1"); const e = M.publishNostrEventV2("e1"); expect(e.status).toBe("published"); });
    it("fail", () => { M.createNostrEventV2({ id: "e1", relayId: "r1" }); M.startNostrEventV2("e1"); const e = M.failNostrEventV2("e1", "rejected"); expect(e.metadata.failReason).toBe("rejected"); });
    it("cancel queued", () => { M.createNostrEventV2({ id: "e1", relayId: "r1" }); expect(M.cancelNostrEventV2("e1").status).toBe("cancelled"); });
    it("cannot publish from queued", () => { M.createNostrEventV2({ id: "e1", relayId: "r1" }); expect(() => M.publishNostrEventV2("e1")).toThrow(); });
    it("unknown relay rejected", () => expect(() => M.createNostrEventV2({ id: "e1", relayId: "none" })).toThrow());
    it("per-relay pending cap", () => { M.setMaxPendingNostrEventsPerRelayV2(2); ["e1","e2"].forEach(id => M.createNostrEventV2({ id, relayId: "r1" })); expect(() => M.createNostrEventV2({ id: "e3", relayId: "r1" })).toThrow(/max pending/); });
    it("publishing counts toward pending", () => { M.setMaxPendingNostrEventsPerRelayV2(1); M.createNostrEventV2({ id: "e1", relayId: "r1" }); M.startNostrEventV2("e1"); expect(() => M.createNostrEventV2({ id: "e2", relayId: "r1" })).toThrow(); });
    it("published frees slot", () => { M.setMaxPendingNostrEventsPerRelayV2(1); M.createNostrEventV2({ id: "e1", relayId: "r1" }); M.startNostrEventV2("e1"); M.publishNostrEventV2("e1"); expect(() => M.createNostrEventV2({ id: "e2", relayId: "r1" })).not.toThrow(); });
    it("default kind is 1", () => { M.createNostrEventV2({ id: "e1", relayId: "r1" }); expect(M.getNostrEventV2("e1").kind).toBe(1); });
    it("custom kind preserved", () => { M.createNostrEventV2({ id: "e1", relayId: "r1", kind: 4 }); expect(M.getNostrEventV2("e1").kind).toBe(4); });
  });

  describe("auto flips", () => {
    it("autoOfflineIdle", () => { M.setNostrRelayIdleMsV2(1000); M.registerNostrRelayV2({ id: "r1", owner: "a" }); M.activateNostrRelayV2("r1"); const r = M.autoOfflineIdleNostrRelaysV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getNostrRelayV2("r1").status).toBe("offline"); });
    it("autoFailStuck", () => { M.registerNostrRelayV2({ id: "r1", owner: "a" }); M.activateNostrRelayV2("r1"); M.createNostrEventV2({ id: "e1", relayId: "r1" }); M.startNostrEventV2("e1"); M.setNostrEventStuckMsV2(100); const r = M.autoFailStuckNostrEventsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getNostrEventV2("e1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("all keys", () => { const s = M.getNostrBridgeStatsV2(); expect(s.relaysByStatus.pending).toBe(0); expect(s.eventsByStatus.queued).toBe(0); });
    it("counts", () => { M.registerNostrRelayV2({ id: "r1", owner: "a" }); M.activateNostrRelayV2("r1"); M.createNostrEventV2({ id: "e1", relayId: "r1" }); const s = M.getNostrBridgeStatsV2(); expect(s.totalRelaysV2).toBe(1); expect(s.totalEventsV2).toBe(1); });
  });
});
