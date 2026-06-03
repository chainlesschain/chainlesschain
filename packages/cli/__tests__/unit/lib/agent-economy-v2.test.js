import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/agent-economy.js";

describe("Agent Economy V2 Surface", () => {
  beforeEach(() => M._resetStateAgentEconomyV2());

  describe("enums", () => {
    it("account maturity has 4 states", () =>
      expect(Object.keys(M.ECONOMY_ACCOUNT_MATURITY_V2)).toHaveLength(4));
    it("tx lifecycle has 5 states", () =>
      expect(Object.keys(M.ECONOMY_TX_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.ECONOMY_ACCOUNT_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ECONOMY_TX_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveEconomyAccountsPerHolderV2", () => {
      M.setMaxActiveEconomyAccountsPerHolderV2(50);
      expect(M.getMaxActiveEconomyAccountsPerHolderV2()).toBe(50);
    });
    it("setMaxPendingEconomyTxsPerAccountV2", () => {
      M.setMaxPendingEconomyTxsPerAccountV2(40);
      expect(M.getMaxPendingEconomyTxsPerAccountV2()).toBe(40);
    });
    it("setEconomyAccountIdleMsV2", () => {
      M.setEconomyAccountIdleMsV2(3600000);
      expect(M.getEconomyAccountIdleMsV2()).toBe(3600000);
    });
    it("setEconomyTxStuckMsV2", () => {
      M.setEconomyTxStuckMsV2(60000);
      expect(M.getEconomyTxStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveEconomyAccountsPerHolderV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setEconomyTxStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingEconomyTxsPerAccountV2(8.7);
      expect(M.getMaxPendingEconomyTxsPerAccountV2()).toBe(8);
    });
  });

  describe("account lifecycle", () => {
    it("register", () => {
      const a = M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      expect(a.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      const a = M.activateEconomyAccountV2("a1");
      expect(a.status).toBe("active");
      expect(a.activatedAt).toBeTruthy();
    });
    it("freeze active→frozen", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      M.activateEconomyAccountV2("a1");
      expect(M.freezeEconomyAccountV2("a1").status).toBe("frozen");
    });
    it("recovery frozen→active preserves activatedAt", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      const a = M.activateEconomyAccountV2("a1");
      M.freezeEconomyAccountV2("a1");
      const re = M.activateEconomyAccountV2("a1");
      expect(re.activatedAt).toBe(a.activatedAt);
    });
    it("close terminal stamps closedAt", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      M.activateEconomyAccountV2("a1");
      const a = M.closeEconomyAccountV2("a1");
      expect(a.status).toBe("closed");
      expect(a.closedAt).toBeTruthy();
    });
    it("cannot touch closed", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      M.activateEconomyAccountV2("a1");
      M.closeEconomyAccountV2("a1");
      expect(() => M.touchEconomyAccountV2("a1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      expect(() => M.freezeEconomyAccountV2("a1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "alice" });
      expect(() =>
        M.registerEconomyAccountV2({ id: "a1", holder: "b" }),
      ).toThrow();
    });
    it("missing holder rejected", () =>
      expect(() => M.registerEconomyAccountV2({ id: "a1" })).toThrow());
    it("list all", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "a" });
      M.registerEconomyAccountV2({ id: "a2", holder: "b" });
      expect(M.listEconomyAccountsV2()).toHaveLength(2);
    });
    it("get null unknown", () =>
      expect(M.getEconomyAccountV2("none")).toBeNull());
    it("defensive copy metadata", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "a", metadata: { k: 5 } });
      const a = M.getEconomyAccountV2("a1");
      a.metadata.k = 99;
      expect(M.getEconomyAccountV2("a1").metadata.k).toBe(5);
    });
    it("default currency CLC", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "a" });
      expect(M.getEconomyAccountV2("a1").currency).toBe("CLC");
    });
    it("currency preserved", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "a", currency: "ETH" });
      expect(M.getEconomyAccountV2("a1").currency).toBe("ETH");
    });
  });

  describe("active-account cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveEconomyAccountsPerHolderV2(2);
      ["a1", "a2", "a3"].forEach((id) =>
        M.registerEconomyAccountV2({ id, holder: "h" }),
      );
      M.activateEconomyAccountV2("a1");
      M.activateEconomyAccountV2("a2");
      expect(() => M.activateEconomyAccountV2("a3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveEconomyAccountsPerHolderV2(2);
      ["a1", "a2", "a3"].forEach((id) =>
        M.registerEconomyAccountV2({ id, holder: "h" }),
      );
      M.activateEconomyAccountV2("a1");
      M.activateEconomyAccountV2("a2");
      M.freezeEconomyAccountV2("a1");
      M.activateEconomyAccountV2("a3");
      expect(() => M.activateEconomyAccountV2("a1")).not.toThrow();
    });
    it("per-holder isolated", () => {
      M.setMaxActiveEconomyAccountsPerHolderV2(1);
      M.registerEconomyAccountV2({ id: "a1", holder: "h1" });
      M.registerEconomyAccountV2({ id: "a2", holder: "h2" });
      M.activateEconomyAccountV2("a1");
      expect(() => M.activateEconomyAccountV2("a2")).not.toThrow();
    });
  });

  describe("tx lifecycle", () => {
    beforeEach(() => {
      M.registerEconomyAccountV2({ id: "a1", holder: "h" });
      M.activateEconomyAccountV2("a1");
    });
    it("create→start→settle", () => {
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      M.startEconomyTxV2("t1");
      const t = M.settleEconomyTxV2("t1");
      expect(t.status).toBe("settled");
    });
    it("fail stores reason", () => {
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      M.startEconomyTxV2("t1");
      const t = M.failEconomyTxV2("t1", "err");
      expect(t.metadata.failReason).toBe("err");
    });
    it("cancel queued", () => {
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      expect(M.cancelEconomyTxV2("t1").status).toBe("cancelled");
    });
    it("cannot settle from queued", () => {
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      expect(() => M.settleEconomyTxV2("t1")).toThrow();
    });
    it("unknown account rejected", () =>
      expect(() =>
        M.createEconomyTxV2({ id: "t1", accountId: "none" }),
      ).toThrow());
    it("per-account pending cap", () => {
      M.setMaxPendingEconomyTxsPerAccountV2(2);
      ["t1", "t2"].forEach((id) =>
        M.createEconomyTxV2({ id, accountId: "a1" }),
      );
      expect(() => M.createEconomyTxV2({ id: "t3", accountId: "a1" })).toThrow(
        /max pending/,
      );
    });
    it("processing counts as pending", () => {
      M.setMaxPendingEconomyTxsPerAccountV2(1);
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      M.startEconomyTxV2("t1");
      expect(() =>
        M.createEconomyTxV2({ id: "t2", accountId: "a1" }),
      ).toThrow();
    });
    it("settled frees slot", () => {
      M.setMaxPendingEconomyTxsPerAccountV2(1);
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      M.startEconomyTxV2("t1");
      M.settleEconomyTxV2("t1");
      expect(() =>
        M.createEconomyTxV2({ id: "t2", accountId: "a1" }),
      ).not.toThrow();
    });
    it("default amount 0", () => {
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      expect(M.getEconomyTxV2("t1").amount).toBe("0");
    });
    it("amount preserved", () => {
      M.createEconomyTxV2({ id: "t1", accountId: "a1", amount: "100" });
      expect(M.getEconomyTxV2("t1").amount).toBe("100");
    });
  });

  describe("auto flips", () => {
    it("autoFreezeIdle", () => {
      M.setEconomyAccountIdleMsV2(1000);
      M.registerEconomyAccountV2({ id: "a1", holder: "h" });
      M.activateEconomyAccountV2("a1");
      const r = M.autoFreezeIdleEconomyAccountsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEconomyAccountV2("a1").status).toBe("frozen");
    });
    it("autoFailStuck", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "h" });
      M.activateEconomyAccountV2("a1");
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      M.startEconomyTxV2("t1");
      M.setEconomyTxStuckMsV2(100);
      const r = M.autoFailStuckEconomyTxsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getEconomyTxV2("t1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getAgentEconomyGovStatsV2();
      expect(s.accountsByStatus.pending).toBe(0);
      expect(s.txsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerEconomyAccountV2({ id: "a1", holder: "h" });
      M.activateEconomyAccountV2("a1");
      M.createEconomyTxV2({ id: "t1", accountId: "a1" });
      const s = M.getAgentEconomyGovStatsV2();
      expect(s.totalAccountsV2).toBe(1);
      expect(s.totalTxsV2).toBe(1);
    });
  });
});
