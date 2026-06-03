/**
 * useTradeStore — Pinia store unit tests (decentralized trading)
 *
 * Covers the pure getter surface (nested asset/marketplace/contract/credit state):
 *  - Initial state shape
 *  - Asset getters: myTokenAssets / myNFTAssets / myKnowledgeAssets / myServiceAssets
 *  - Market getters: filteredOrders (orderType + status + search) / openOrders
 *  - Contract getters: filteredContracts (status + templateType) / activeContracts /
 *    pendingSignContracts
 *  - Credit getters: creditLevel / creditScore / creditLevelColor (score thresholds)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useTradeStore } from "../trade";
import type { Asset, MarketOrder, Contract } from "../trade";

function asset(
  id: string,
  asset_type: Asset["asset_type"],
  overrides: Partial<Asset> = {},
): Asset {
  return {
    id,
    name: `Asset ${id}`,
    symbol: id.toUpperCase(),
    asset_type,
    owner_did: "did:me",
    ...overrides,
  };
}

function order(id: string, overrides: Partial<MarketOrder> = {}): MarketOrder {
  return {
    id,
    order_type: "sell",
    title: `Order ${id}`,
    price: 10,
    quantity: 1,
    seller_did: "did:me",
    status: "open",
    ...overrides,
  };
}

function contract(id: string, overrides: Partial<Contract> = {}): Contract {
  return {
    id,
    title: `Contract ${id}`,
    status: "active",
    parties: ["did:a", "did:b"],
    ...overrides,
  };
}

describe("useTradeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts with empty nested namespaces", () => {
      const store = useTradeStore();
      expect(store.asset.myAssets).toEqual([]);
      expect(store.marketplace.orders).toEqual([]);
      expect(store.contract.contracts).toEqual([]);
      expect(store.credit.userCredit).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Asset getters
  // -------------------------------------------------------------------------

  describe("asset getters", () => {
    it("split myAssets by asset_type", () => {
      const store = useTradeStore();
      store.asset.myAssets = [
        asset("t1", "token"),
        asset("n1", "nft"),
        asset("k1", "knowledge"),
        asset("s1", "service"),
        asset("t2", "token"),
      ];
      expect(store.myTokenAssets.map((a) => a.id)).toEqual(["t1", "t2"]);
      expect(store.myNFTAssets.map((a) => a.id)).toEqual(["n1"]);
      expect(store.myKnowledgeAssets.map((a) => a.id)).toEqual(["k1"]);
      expect(store.myServiceAssets.map((a) => a.id)).toEqual(["s1"]);
    });
  });

  // -------------------------------------------------------------------------
  // Market getters
  // -------------------------------------------------------------------------

  describe("market getters", () => {
    function seed(store: ReturnType<typeof useTradeStore>) {
      store.marketplace.orders = [
        order("o1", {
          order_type: "sell",
          status: "open",
          title: "Sell GPU",
          description: "fast",
        }),
        order("o2", { order_type: "buy", status: "open", title: "Buy CPU" }),
        order("o3", {
          order_type: "sell",
          status: "closed",
          title: "Sold RAM",
        }),
      ];
    }

    it("openOrders filters status === 'open'", () => {
      const store = useTradeStore();
      seed(store);
      expect(store.openOrders.map((o) => o.id)).toEqual(["o1", "o2"]);
    });

    it("filteredOrders combines orderType + status + search", () => {
      const store = useTradeStore();
      seed(store);
      store.marketplace.filters.orderType = "sell";
      expect(store.filteredOrders.map((o) => o.id)).toEqual(["o1", "o3"]);
      store.marketplace.filters.status = "open";
      expect(store.filteredOrders.map((o) => o.id)).toEqual(["o1"]);
      // search hits title or description, case-insensitive
      store.marketplace.filters.orderType = "";
      store.marketplace.filters.status = "";
      store.marketplace.filters.searchKeyword = "FAST"; // matches o1.description
      expect(store.filteredOrders.map((o) => o.id)).toEqual(["o1"]);
    });
  });

  // -------------------------------------------------------------------------
  // Contract getters
  // -------------------------------------------------------------------------

  describe("contract getters", () => {
    function seed(store: ReturnType<typeof useTradeStore>) {
      store.contract.contracts = [
        contract("c1", { status: "active", template_type: "sale" }),
        contract("c2", { status: "draft", template_type: "lease" }),
        contract("c3", { status: "active", template_type: "lease" }),
        contract("c4", { status: "completed", template_type: "sale" }),
      ];
    }

    it("activeContracts + pendingSignContracts split by status", () => {
      const store = useTradeStore();
      seed(store);
      expect(store.activeContracts.map((c) => c.id)).toEqual(["c1", "c3"]);
      expect(store.pendingSignContracts.map((c) => c.id)).toEqual(["c2"]); // draft
    });

    it("filteredContracts combines status + templateType", () => {
      const store = useTradeStore();
      seed(store);
      store.contract.filters.templateType = "lease";
      expect(store.filteredContracts.map((c) => c.id)).toEqual(["c2", "c3"]);
      store.contract.filters.status = "active";
      expect(store.filteredContracts.map((c) => c.id)).toEqual(["c3"]);
    });
  });

  // -------------------------------------------------------------------------
  // Credit getters
  // -------------------------------------------------------------------------

  describe("credit getters", () => {
    it("creditLevel + creditScore default safely with no userCredit", () => {
      const store = useTradeStore();
      expect(store.creditLevel).toBeNull();
      expect(store.creditScore).toBe(0);
    });

    it("creditLevel + creditScore read userCredit", () => {
      const store = useTradeStore();
      store.credit.userCredit = {
        user_did: "did:me",
        credit_score: 750,
        credit_level: "gold",
        total_transactions: 10,
        successful_transactions: 9,
      };
      expect(store.creditLevel).toBe("gold");
      expect(store.creditScore).toBe(750);
    });

    it("creditLevelColor maps score thresholds", () => {
      const store = useTradeStore();
      const setScore = (s: number) => {
        store.credit.userCredit = {
          user_did: "did:me",
          credit_score: s,
          credit_level: "newbie",
          total_transactions: 0,
          successful_transactions: 0,
        };
      };
      expect(store.creditLevelColor).toBe("#d9d9d9"); // no credit → 0 → newbie
      setScore(950);
      expect(store.creditLevelColor).toBe("#52c41a"); // >=901 diamond
      setScore(700);
      expect(store.creditLevelColor).toBe("#faad14"); // >=601 gold
      setScore(400);
      expect(store.creditLevelColor).toBe("#1890ff"); // >=301 silver
      setScore(150);
      expect(store.creditLevelColor).toBe("#8c8c8c"); // >=101 bronze
      setScore(50);
      expect(store.creditLevelColor).toBe("#d9d9d9"); // newbie
    });
  });
});
