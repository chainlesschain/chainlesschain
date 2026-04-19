import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/cross-chain.js";

describe("Cross-Chain V2 Surface", () => {
  beforeEach(() => M._resetStateCrossChainV2());

  describe("enums", () => {
    it("channel maturity has 4 states", () => expect(Object.keys(M.XCHAIN_CHANNEL_MATURITY_V2)).toHaveLength(4));
    it("transfer lifecycle has 5 states", () => expect(Object.keys(M.XCHAIN_TRANSFER_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => { expect(Object.isFrozen(M.XCHAIN_CHANNEL_MATURITY_V2)).toBe(true); expect(Object.isFrozen(M.XCHAIN_TRANSFER_LIFECYCLE_V2)).toBe(true); });
  });

  describe("config", () => {
    it("setMaxActiveXchainChannelsPerOwnerV2", () => { M.setMaxActiveXchainChannelsPerOwnerV2(25); expect(M.getMaxActiveXchainChannelsPerOwnerV2()).toBe(25); });
    it("setMaxPendingXchainTransfersPerChannelV2", () => { M.setMaxPendingXchainTransfersPerChannelV2(40); expect(M.getMaxPendingXchainTransfersPerChannelV2()).toBe(40); });
    it("setXchainChannelIdleMsV2", () => { M.setXchainChannelIdleMsV2(3600000); expect(M.getXchainChannelIdleMsV2()).toBe(3600000); });
    it("setXchainTransferStuckMsV2", () => { M.setXchainTransferStuckMsV2(60000); expect(M.getXchainTransferStuckMsV2()).toBe(60000); });
    it("rejects zero", () => expect(() => M.setMaxActiveXchainChannelsPerOwnerV2(0)).toThrow());
    it("rejects negative", () => expect(() => M.setXchainTransferStuckMsV2(-1)).toThrow());
    it("floors decimals", () => { M.setMaxPendingXchainTransfersPerChannelV2(8.7); expect(M.getMaxPendingXchainTransfersPerChannelV2()).toBe(8); });
  });

  describe("channel lifecycle", () => {
    it("register", () => { const c = M.registerXchainChannelV2({ id: "c1", owner: "alice" }); expect(c.status).toBe("pending"); });
    it("activate stamps activatedAt", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); const c = M.activateXchainChannelV2("c1"); expect(c.status).toBe("active"); expect(c.activatedAt).toBeTruthy(); });
    it("pause active→paused", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); M.activateXchainChannelV2("c1"); expect(M.pauseXchainChannelV2("c1").status).toBe("paused"); });
    it("recovery paused→active preserves activatedAt", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); const c = M.activateXchainChannelV2("c1"); M.pauseXchainChannelV2("c1"); const re = M.activateXchainChannelV2("c1"); expect(re.activatedAt).toBe(c.activatedAt); });
    it("decommission terminal stamps decommissionedAt", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); M.activateXchainChannelV2("c1"); const c = M.decommissionXchainChannelV2("c1"); expect(c.status).toBe("decommissioned"); expect(c.decommissionedAt).toBeTruthy(); });
    it("cannot touch decommissioned", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); M.activateXchainChannelV2("c1"); M.decommissionXchainChannelV2("c1"); expect(() => M.touchXchainChannelV2("c1")).toThrow(); });
    it("invalid transition rejected", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); expect(() => M.pauseXchainChannelV2("c1")).toThrow(); });
    it("duplicate rejected", () => { M.registerXchainChannelV2({ id: "c1", owner: "alice" }); expect(() => M.registerXchainChannelV2({ id: "c1", owner: "b" })).toThrow(); });
    it("missing owner rejected", () => expect(() => M.registerXchainChannelV2({ id: "c1" })).toThrow());
    it("list all", () => { M.registerXchainChannelV2({ id: "c1", owner: "a" }); M.registerXchainChannelV2({ id: "c2", owner: "b" }); expect(M.listXchainChannelsV2()).toHaveLength(2); });
    it("get null unknown", () => expect(M.getXchainChannelV2("none")).toBeNull());
    it("defensive copy metadata", () => { M.registerXchainChannelV2({ id: "c1", owner: "a", metadata: { k: 5 } }); const c = M.getXchainChannelV2("c1"); c.metadata.k = 99; expect(M.getXchainChannelV2("c1").metadata.k).toBe(5); });
    it("fromChain/toChain preserved", () => { M.registerXchainChannelV2({ id: "c1", owner: "a", fromChain: "eth", toChain: "bsc" }); const c = M.getXchainChannelV2("c1"); expect(c.fromChain).toBe("eth"); expect(c.toChain).toBe("bsc"); });
  });

  describe("active-channel cap", () => {
    it("enforced on pending→active", () => { M.setMaxActiveXchainChannelsPerOwnerV2(2); ["c1","c2","c3"].forEach(id => M.registerXchainChannelV2({ id, owner: "o" })); M.activateXchainChannelV2("c1"); M.activateXchainChannelV2("c2"); expect(() => M.activateXchainChannelV2("c3")).toThrow(/max active/); });
    it("recovery exempt", () => { M.setMaxActiveXchainChannelsPerOwnerV2(2); ["c1","c2","c3"].forEach(id => M.registerXchainChannelV2({ id, owner: "o" })); M.activateXchainChannelV2("c1"); M.activateXchainChannelV2("c2"); M.pauseXchainChannelV2("c1"); M.activateXchainChannelV2("c3"); expect(() => M.activateXchainChannelV2("c1")).not.toThrow(); });
    it("per-owner isolated", () => { M.setMaxActiveXchainChannelsPerOwnerV2(1); M.registerXchainChannelV2({ id: "c1", owner: "o1" }); M.registerXchainChannelV2({ id: "c2", owner: "o2" }); M.activateXchainChannelV2("c1"); expect(() => M.activateXchainChannelV2("c2")).not.toThrow(); });
  });

  describe("transfer lifecycle", () => {
    beforeEach(() => { M.registerXchainChannelV2({ id: "c1", owner: "o" }); M.activateXchainChannelV2("c1"); });
    it("create→start→confirm", () => { M.createXchainTransferV2({ id: "t1", channelId: "c1" }); M.startXchainTransferV2("t1"); const t = M.confirmXchainTransferV2("t1"); expect(t.status).toBe("confirmed"); });
    it("fail stores reason", () => { M.createXchainTransferV2({ id: "t1", channelId: "c1" }); M.startXchainTransferV2("t1"); const t = M.failXchainTransferV2("t1", "err"); expect(t.metadata.failReason).toBe("err"); });
    it("cancel queued", () => { M.createXchainTransferV2({ id: "t1", channelId: "c1" }); expect(M.cancelXchainTransferV2("t1").status).toBe("cancelled"); });
    it("cannot confirm from queued", () => { M.createXchainTransferV2({ id: "t1", channelId: "c1" }); expect(() => M.confirmXchainTransferV2("t1")).toThrow(); });
    it("unknown channel rejected", () => expect(() => M.createXchainTransferV2({ id: "t1", channelId: "none" })).toThrow());
    it("per-channel pending cap", () => { M.setMaxPendingXchainTransfersPerChannelV2(2); ["t1","t2"].forEach(id => M.createXchainTransferV2({ id, channelId: "c1" })); expect(() => M.createXchainTransferV2({ id: "t3", channelId: "c1" })).toThrow(/max pending/); });
    it("relaying counts as pending", () => { M.setMaxPendingXchainTransfersPerChannelV2(1); M.createXchainTransferV2({ id: "t1", channelId: "c1" }); M.startXchainTransferV2("t1"); expect(() => M.createXchainTransferV2({ id: "t2", channelId: "c1" })).toThrow(); });
    it("confirmed frees slot", () => { M.setMaxPendingXchainTransfersPerChannelV2(1); M.createXchainTransferV2({ id: "t1", channelId: "c1" }); M.startXchainTransferV2("t1"); M.confirmXchainTransferV2("t1"); expect(() => M.createXchainTransferV2({ id: "t2", channelId: "c1" })).not.toThrow(); });
    it("default amount 0", () => { M.createXchainTransferV2({ id: "t1", channelId: "c1" }); expect(M.getXchainTransferV2("t1").amount).toBe("0"); });
    it("amount preserved", () => { M.createXchainTransferV2({ id: "t1", channelId: "c1", amount: "100" }); expect(M.getXchainTransferV2("t1").amount).toBe("100"); });
  });

  describe("auto flips", () => {
    it("autoPauseIdle", () => { M.setXchainChannelIdleMsV2(1000); M.registerXchainChannelV2({ id: "c1", owner: "o" }); M.activateXchainChannelV2("c1"); const r = M.autoPauseIdleXchainChannelsV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getXchainChannelV2("c1").status).toBe("paused"); });
    it("autoFailStuck", () => { M.registerXchainChannelV2({ id: "c1", owner: "o" }); M.activateXchainChannelV2("c1"); M.createXchainTransferV2({ id: "t1", channelId: "c1" }); M.startXchainTransferV2("t1"); M.setXchainTransferStuckMsV2(100); const r = M.autoFailStuckXchainTransfersV2({ now: Date.now() + 5000 }); expect(r.count).toBe(1); expect(M.getXchainTransferV2("t1").status).toBe("failed"); });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => { const s = M.getCrossChainGovStatsV2(); expect(s.channelsByStatus.pending).toBe(0); expect(s.transfersByStatus.queued).toBe(0); });
    it("counts", () => { M.registerXchainChannelV2({ id: "c1", owner: "o" }); M.activateXchainChannelV2("c1"); M.createXchainTransferV2({ id: "t1", channelId: "c1" }); const s = M.getCrossChainGovStatsV2(); expect(s.totalChannelsV2).toBe(1); expect(s.totalTransfersV2).toBe(1); });
  });
});
