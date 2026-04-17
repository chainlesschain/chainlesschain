import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureEconomyTables,
  priceService,
  getServicePrice,
  pay,
  getBalance,
  openChannel,
  closeChannel,
  listResource,
  getMarketListings,
  tradeResource,
  mintNFT,
  recordContribution,
  getContributions,
  distributeRevenue,
  _resetState,
  _setBalance,
  // Phase 85 V2
  PAYMENT_TYPE,
  CHANNEL_STATUS,
  RESOURCE_TYPE,
  NFT_STATUS,
  priceServiceV2,
  getPriceModel,
  payV2,
  openChannelV2,
  activateChannel,
  initiateSettlement,
  closeChannelV2,
  disputeChannel,
  listChannelsV2,
  listResourceV2,
  mintNFTV2,
  listNFT,
  buyNFT,
  burnNFT,
  getNFTStatus,
  recordTaskContribution,
  getTaskContributions,
  distributeRevenueV2,
  listDistributions,
  getEconomyStatsV2,
  _resetV2State,
} from "../../src/lib/agent-economy.js";

describe("agent-economy", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    _resetV2State();
    ensureEconomyTables(db);
  });

  // ─── ensureEconomyTables ──────────────────────────────────

  describe("ensureEconomyTables", () => {
    it("creates all 6 economy tables", () => {
      expect(db.tables.has("economy_balances")).toBe(true);
      expect(db.tables.has("economy_transactions")).toBe(true);
      expect(db.tables.has("economy_channels")).toBe(true);
      expect(db.tables.has("economy_market")).toBe(true);
      expect(db.tables.has("economy_nfts")).toBe(true);
      expect(db.tables.has("economy_contributions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureEconomyTables(db);
      ensureEconomyTables(db);
      expect(db.tables.has("economy_balances")).toBe(true);
    });
  });

  // ─── Pricing ──────────────────────────────────────────────

  describe("priceService / getServicePrice", () => {
    it("sets and retrieves a service price", () => {
      priceService(db, "translate", 5.0, { lang: "en" });
      const p = getServicePrice("translate");
      expect(p.price).toBe(5.0);
      expect(p.serviceId).toBe("translate");
    });

    it("returns null for unknown service", () => {
      expect(getServicePrice("unknown")).toBeNull();
    });

    it("overwrites existing price", () => {
      priceService(db, "translate", 5.0, {});
      priceService(db, "translate", 10.0, {});
      expect(getServicePrice("translate").price).toBe(10.0);
    });
  });

  // ─── Payments ─────────────────────────────────────────────

  describe("pay", () => {
    it("transfers funds between agents", () => {
      _setBalance("alice", 100);
      const result = pay(db, "alice", "bob", 30, "test payment");
      expect(result.amount).toBe(30);
      expect(result.balance).toBe(70);
      expect(getBalance("bob").balance).toBe(30);
    });

    it("throws on insufficient balance", () => {
      _setBalance("alice", 10);
      expect(() => pay(db, "alice", "bob", 50, "too much")).toThrow(
        "Insufficient balance",
      );
    });

    it("throws on non-positive amount", () => {
      _setBalance("alice", 100);
      expect(() => pay(db, "alice", "bob", 0, "zero")).toThrow(
        "Amount must be positive",
      );
    });

    it("returns a transaction ID", () => {
      _setBalance("alice", 100);
      const result = pay(db, "alice", "bob", 10, "");
      expect(result.txId).toBeDefined();
      expect(typeof result.txId).toBe("string");
    });

    it("persists transaction to database", () => {
      _setBalance("alice", 100);
      pay(db, "alice", "bob", 25, "persisted");
      const rows = db.data.get("economy_transactions") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].amount).toBe(25);
    });
  });

  // ─── Balance ──────────────────────────────────────────────

  describe("getBalance", () => {
    it("returns zero for new agent", () => {
      const bal = getBalance("new-agent");
      expect(bal.balance).toBe(0);
      expect(bal.locked).toBe(0);
    });

    it("reflects payments", () => {
      _setBalance("alice", 50);
      pay(db, "alice", "bob", 20, "");
      expect(getBalance("alice").balance).toBe(30);
      expect(getBalance("bob").balance).toBe(20);
    });
  });

  // ─── State Channels ──────────────────────────────────────

  describe("openChannel / closeChannel", () => {
    it("opens a channel with deposit", () => {
      _setBalance("alice", 100);
      const ch = openChannel(db, "alice", "bob", 50);
      expect(ch.status).toBe("open");
      expect(ch.balanceA).toBe(50);
      expect(ch.partyA).toBe("alice");
      expect(getBalance("alice").balance).toBe(50);
      expect(getBalance("alice").locked).toBe(50);
    });

    it("opens a channel without deposit", () => {
      const ch = openChannel(db, "alice", "bob", 0);
      expect(ch.status).toBe("open");
      expect(ch.balanceA).toBe(0);
    });

    it("closes channel and settles balances", () => {
      _setBalance("alice", 100);
      const ch = openChannel(db, "alice", "bob", 40);
      const closed = closeChannel(db, ch.id);
      expect(closed.status).toBe("closed");
      // Alice gets her deposit back
      expect(getBalance("alice").balance).toBe(100);
    });

    it("throws when closing unknown channel", () => {
      expect(() => closeChannel(db, "nonexistent")).toThrow(
        "Channel not found",
      );
    });

    it("throws when closing already closed channel", () => {
      _setBalance("alice", 100);
      const ch = openChannel(db, "alice", "bob", 10);
      closeChannel(db, ch.id);
      expect(() => closeChannel(db, ch.id)).toThrow("already closed");
    });

    it("throws on insufficient deposit", () => {
      _setBalance("alice", 5);
      expect(() => openChannel(db, "alice", "bob", 50)).toThrow(
        "Insufficient balance for deposit",
      );
    });
  });

  // ─── Marketplace ──────────────────────────────────────────

  describe("listResource / getMarketListings / tradeResource", () => {
    it("lists a resource on the market", () => {
      const listing = listResource(
        db,
        "compute",
        "provider-1",
        2.5,
        100,
        "gpu-hour",
      );
      expect(listing.resourceType).toBe("compute");
      expect(listing.price).toBe(2.5);
      expect(listing.available).toBe(100);
    });

    it("returns market listings", () => {
      listResource(db, "compute", "p1", 2.5, 100, "hour");
      listResource(db, "storage", "p2", 0.1, 1000, "gb");
      const all = getMarketListings();
      expect(all.length).toBe(2);
    });

    it("filters by type", () => {
      listResource(db, "compute", "p1", 2.5, 100, "hour");
      listResource(db, "storage", "p2", 0.1, 1000, "gb");
      const filtered = getMarketListings({ type: "compute" });
      expect(filtered.length).toBe(1);
      expect(filtered[0].resourceType).toBe("compute");
    });

    it("trades a resource successfully", () => {
      const listing = listResource(db, "compute", "seller", 10, 50, "hour");
      _setBalance("buyer", 200);
      const result = tradeResource(listing.id, "buyer", 5);
      expect(result.cost).toBe(50);
      expect(result.remaining).toBe(45);
      expect(getBalance("buyer").balance).toBe(150);
      expect(getBalance("seller").balance).toBe(50);
    });

    it("throws on insufficient availability", () => {
      const listing = listResource(db, "compute", "seller", 10, 2, "hour");
      _setBalance("buyer", 1000);
      expect(() => tradeResource(listing.id, "buyer", 5)).toThrow(
        "Insufficient availability",
      );
    });

    it("throws on insufficient buyer balance", () => {
      const listing = listResource(db, "compute", "seller", 100, 50, "hour");
      _setBalance("buyer", 10);
      expect(() => tradeResource(listing.id, "buyer", 5)).toThrow(
        "Insufficient balance",
      );
    });

    it("throws on unknown listing", () => {
      expect(() => tradeResource("no-such-id", "buyer", 1)).toThrow(
        "Listing not found",
      );
    });
  });

  // ─── NFTs ─────────────────────────────────────────────────

  describe("mintNFT", () => {
    it("mints an NFT", () => {
      const nft = mintNFT(db, "alice", "artwork", { title: "Sunset" });
      expect(nft.owner).toBe("alice");
      expect(nft.type).toBe("artwork");
      expect(nft.metadata.title).toBe("Sunset");
      expect(nft.id).toBeDefined();
    });

    it("persists NFT to database", () => {
      mintNFT(db, "bob", "certificate", {});
      const rows = db.data.get("economy_nfts") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].owner).toBe("bob");
    });
  });

  // ─── Contributions ────────────────────────────────────────

  describe("recordContribution / getContributions", () => {
    it("records a contribution", () => {
      const c = recordContribution(db, "agent-1", "code-review", 10, "pr-123");
      expect(c.agentId).toBe("agent-1");
      expect(c.value).toBe(10);
      expect(c.proof).toBe("pr-123");
    });

    it("retrieves contributions for an agent", () => {
      recordContribution(db, "agent-1", "code-review", 10, "");
      recordContribution(db, "agent-1", "bug-fix", 20, "");
      const contribs = getContributions("agent-1");
      expect(contribs.length).toBe(2);
    });

    it("returns empty for unknown agent", () => {
      expect(getContributions("nobody")).toEqual([]);
    });
  });

  // ─── Revenue Distribution ─────────────────────────────────

  describe("distributeRevenue", () => {
    it("splits pool equally", () => {
      const results = distributeRevenue(db, 90, ["a", "b", "c"]);
      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r.share).toBe(30);
        expect(r.newBalance).toBe(30);
      }
    });

    it("adds to existing balances", () => {
      _setBalance("a", 10);
      const results = distributeRevenue(db, 20, ["a", "b"]);
      expect(results.find((r) => r.agentId === "a").newBalance).toBe(20);
      expect(results.find((r) => r.agentId === "b").newBalance).toBe(10);
    });

    it("throws on empty agent list", () => {
      expect(() => distributeRevenue(db, 100, [])).toThrow("No agents");
    });

    it("throws on non-positive pool", () => {
      expect(() => distributeRevenue(db, 0, ["a"])).toThrow(
        "Pool must be positive",
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Phase 85 — Agent Economy 2.0 additions
  // ═════════════════════════════════════════════════════════════════

  describe("Phase 85 frozen enums", () => {
    it("PAYMENT_TYPE has 4 values and is frozen", () => {
      expect(Object.values(PAYMENT_TYPE).sort()).toEqual(
        ["flat_rate", "per_call", "per_minute", "per_token"].sort(),
      );
      expect(Object.isFrozen(PAYMENT_TYPE)).toBe(true);
    });

    it("CHANNEL_STATUS has 5 values and is frozen", () => {
      expect(Object.values(CHANNEL_STATUS).sort()).toEqual(
        ["active", "closed", "disputed", "open", "settling"].sort(),
      );
      expect(Object.isFrozen(CHANNEL_STATUS)).toBe(true);
    });

    it("RESOURCE_TYPE has 5 values and is frozen", () => {
      expect(Object.values(RESOURCE_TYPE).sort()).toEqual(
        ["compute", "data", "model", "skill", "storage"].sort(),
      );
      expect(Object.isFrozen(RESOURCE_TYPE)).toBe(true);
    });

    it("NFT_STATUS has 4 values and is frozen", () => {
      expect(Object.values(NFT_STATUS).sort()).toEqual(
        ["burned", "listed", "minted", "sold"].sort(),
      );
      expect(Object.isFrozen(NFT_STATUS)).toBe(true);
    });
  });

  describe("priceServiceV2 + payV2", () => {
    it("priceServiceV2 rejects invalid paymentType", () => {
      expect(() =>
        priceServiceV2(db, { serviceId: "s1", paymentType: "bogus", rate: 1 }),
      ).toThrow(/Invalid paymentType/);
    });

    it("priceServiceV2 rejects negative rate", () => {
      expect(() =>
        priceServiceV2(db, {
          serviceId: "s1",
          paymentType: PAYMENT_TYPE.PER_CALL,
          rate: -1,
        }),
      ).toThrow(/Invalid rate/);
    });

    it("priceServiceV2 stores and getPriceModel retrieves", () => {
      priceServiceV2(db, {
        serviceId: "s1",
        paymentType: PAYMENT_TYPE.PER_TOKEN,
        rate: 0.002,
      });
      const m = getPriceModel("s1");
      expect(m.paymentType).toBe(PAYMENT_TYPE.PER_TOKEN);
      expect(m.rate).toBe(0.002);
    });

    it("payV2 per_call computes cost per invocation", () => {
      _setBalance("alice", 100);
      priceServiceV2(db, {
        serviceId: "api",
        paymentType: PAYMENT_TYPE.PER_CALL,
        rate: 0.5,
      });
      const r = payV2(db, {
        fromAgentId: "alice",
        toAgentId: "bob",
        serviceId: "api",
        calls: 4,
      });
      expect(r.amount).toBe(2);
      expect(getBalance("alice").balance).toBe(98);
    });

    it("payV2 per_token requires tokens", () => {
      priceServiceV2(db, {
        serviceId: "llm",
        paymentType: PAYMENT_TYPE.PER_TOKEN,
        rate: 0.001,
      });
      expect(() =>
        payV2(db, {
          fromAgentId: "alice",
          toAgentId: "bob",
          serviceId: "llm",
        }),
      ).toThrow(/tokens required/);
    });

    it("payV2 per_minute computes cost by minutes", () => {
      _setBalance("alice", 50);
      priceServiceV2(db, {
        serviceId: "voice",
        paymentType: PAYMENT_TYPE.PER_MINUTE,
        rate: 0.1,
      });
      const r = payV2(db, {
        fromAgentId: "alice",
        toAgentId: "bob",
        serviceId: "voice",
        minutes: 30,
      });
      expect(r.amount).toBe(3);
    });

    it("payV2 flat_rate ignores usage", () => {
      _setBalance("alice", 100);
      priceServiceV2(db, {
        serviceId: "flat",
        paymentType: PAYMENT_TYPE.FLAT_RATE,
        rate: 10,
      });
      const r = payV2(db, {
        fromAgentId: "alice",
        toAgentId: "bob",
        serviceId: "flat",
        tokens: 99999,
      });
      expect(r.amount).toBe(10);
    });

    it("payV2 throws when service unknown", () => {
      expect(() =>
        payV2(db, {
          fromAgentId: "alice",
          toAgentId: "bob",
          serviceId: "unknown",
        }),
      ).toThrow(/No price model/);
    });
  });

  describe("Channel lifecycle V2", () => {
    it("openChannelV2 deposits from both parties", () => {
      _setBalance("a", 100);
      _setBalance("b", 50);
      const ch = openChannelV2(db, {
        partyA: "a",
        partyB: "b",
        depositA: 30,
        depositB: 20,
      });
      expect(ch.balanceA).toBe(30);
      expect(ch.balanceB).toBe(20);
      expect(ch.status).toBe(CHANNEL_STATUS.OPEN);
      expect(getBalance("b").locked).toBe(20);
    });

    it("openChannelV2 rejects when partyA === partyB", () => {
      expect(() => openChannelV2(db, { partyA: "a", partyB: "a" })).toThrow(
        /cannot equal/,
      );
    });

    it("activateChannel transitions OPEN → ACTIVE", () => {
      _setBalance("a", 50);
      const ch = openChannelV2(db, { partyA: "a", partyB: "b", depositA: 10 });
      const r = activateChannel(db, ch.id);
      expect(r.status).toBe(CHANNEL_STATUS.ACTIVE);
    });

    it("activateChannel throws if not OPEN", () => {
      _setBalance("a", 50);
      const ch = openChannelV2(db, { partyA: "a", partyB: "b", depositA: 10 });
      activateChannel(db, ch.id);
      expect(() => activateChannel(db, ch.id)).toThrow(/not open/);
    });

    it("initiateSettlement enforces total preservation", () => {
      _setBalance("a", 100);
      _setBalance("b", 100);
      const ch = openChannelV2(db, {
        partyA: "a",
        partyB: "b",
        depositA: 40,
        depositB: 40,
      });
      activateChannel(db, ch.id);
      expect(() =>
        initiateSettlement(db, ch.id, { finalBalanceA: 50, finalBalanceB: 50 }),
      ).toThrow(/preserve total/);
    });

    it("initiateSettlement with valid totals moves to SETTLING", () => {
      _setBalance("a", 100);
      _setBalance("b", 100);
      const ch = openChannelV2(db, {
        partyA: "a",
        partyB: "b",
        depositA: 40,
        depositB: 40,
      });
      activateChannel(db, ch.id);
      const r = initiateSettlement(db, ch.id, {
        finalBalanceA: 60,
        finalBalanceB: 20,
      });
      expect(r.status).toBe(CHANNEL_STATUS.SETTLING);
      expect(r.balanceA).toBe(60);
    });

    it("closeChannelV2 releases locked funds", () => {
      _setBalance("a", 100);
      const ch = openChannelV2(db, { partyA: "a", partyB: "b", depositA: 30 });
      activateChannel(db, ch.id);
      initiateSettlement(db, ch.id, { finalBalanceA: 30, finalBalanceB: 0 });
      closeChannelV2(db, ch.id);
      expect(getBalance("a").balance).toBe(100);
      expect(getBalance("a").locked).toBe(0);
    });

    it("disputeChannel marks DISPUTED", () => {
      _setBalance("a", 50);
      const ch = openChannelV2(db, { partyA: "a", partyB: "b", depositA: 10 });
      activateChannel(db, ch.id);
      const r = disputeChannel(db, ch.id, "unauthorized charge");
      expect(r.status).toBe(CHANNEL_STATUS.DISPUTED);
      expect(r.disputeReason).toBe("unauthorized charge");
    });

    it("listChannelsV2 filters by status", () => {
      _setBalance("a", 100);
      const ch1 = openChannelV2(db, { partyA: "a", partyB: "b", depositA: 10 });
      const ch2 = openChannelV2(db, { partyA: "a", partyB: "c", depositA: 10 });
      activateChannel(db, ch2.id);
      const open = listChannelsV2({ status: CHANNEL_STATUS.OPEN });
      const active = listChannelsV2({ status: CHANNEL_STATUS.ACTIVE });
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(ch1.id);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(ch2.id);
    });

    it("listChannelsV2 filters by party", () => {
      _setBalance("a", 100);
      openChannelV2(db, { partyA: "a", partyB: "b", depositA: 10 });
      openChannelV2(db, { partyA: "a", partyB: "c", depositA: 10 });
      const r = listChannelsV2({ party: "b" });
      expect(r).toHaveLength(1);
    });
  });

  describe("listResourceV2", () => {
    it("rejects invalid resourceType", () => {
      expect(() =>
        listResourceV2(db, {
          sellerId: "s",
          resourceType: "bogus",
          price: 5,
        }),
      ).toThrow(/Invalid resourceType/);
    });

    it("creates listing with valid enum", () => {
      const r = listResourceV2(db, {
        sellerId: "s",
        resourceType: RESOURCE_TYPE.COMPUTE,
        name: "GPU Hours",
        price: 0.5,
        available: 10,
      });
      expect(r.resourceType).toBe(RESOURCE_TYPE.COMPUTE);
      expect(r.name).toBe("GPU Hours");
    });
  });

  describe("NFT lifecycle V2", () => {
    it("mintNFTV2 starts in MINTED", () => {
      const n = mintNFTV2(db, {
        owner: "alice",
        assetType: "skill",
        metadata: { name: "SkillX" },
        royaltyPercent: 5,
      });
      expect(n.status).toBe(NFT_STATUS.MINTED);
      expect(n.royaltyPercent).toBe(5);
      expect(getNFTStatus(n.id).status).toBe(NFT_STATUS.MINTED);
    });

    it("mintNFTV2 rejects royalty > 50", () => {
      expect(() =>
        mintNFTV2(db, {
          owner: "a",
          assetType: "skill",
          royaltyPercent: 51,
        }),
      ).toThrow(/royaltyPercent/);
    });

    it("listNFT transitions MINTED → LISTED", () => {
      const n = mintNFTV2(db, { owner: "a", assetType: "skill" });
      const r = listNFT(db, n.id, 100);
      expect(r.status).toBe(NFT_STATUS.LISTED);
      expect(r.price).toBe(100);
    });

    it("listNFT rejects non-MINTED", () => {
      const n = mintNFTV2(db, { owner: "a", assetType: "skill" });
      listNFT(db, n.id, 100);
      expect(() => listNFT(db, n.id, 200)).toThrow(/Cannot list/);
    });

    it("buyNFT transfers payment + ownership + royalty", () => {
      _setBalance("buyer", 1000);
      const n = mintNFTV2(db, {
        owner: "alice",
        assetType: "skill",
        royaltyPercent: 10,
      });
      listNFT(db, n.id, 100);
      const r = buyNFT(db, n.id, "buyer");
      expect(r.price).toBe(100);
      expect(r.royalty).toBe(10);
      expect(r.status).toBe(NFT_STATUS.SOLD);
      // alice gets full price (90 + 10 royalty) since she's the minter
      expect(getBalance("alice").balance).toBe(100);
      expect(getBalance("buyer").balance).toBe(900);
    });

    it("buyNFT fails with insufficient balance", () => {
      _setBalance("poor", 5);
      const n = mintNFTV2(db, { owner: "a", assetType: "skill" });
      listNFT(db, n.id, 100);
      expect(() => buyNFT(db, n.id, "poor")).toThrow(/Insufficient/);
    });

    it("burnNFT transitions to BURNED", () => {
      const n = mintNFTV2(db, { owner: "a", assetType: "skill" });
      const r = burnNFT(db, n.id);
      expect(r.status).toBe(NFT_STATUS.BURNED);
      expect(() => burnNFT(db, n.id)).toThrow(/already burned/);
    });
  });

  describe("Contribution-weighted revenue distribution", () => {
    it("records task contributions", () => {
      recordTaskContribution(db, { taskId: "t1", agentId: "a", weight: 3 });
      recordTaskContribution(db, { taskId: "t1", agentId: "b", weight: 1 });
      const contribs = getTaskContributions("t1");
      expect(contribs).toHaveLength(2);
    });

    it("rejects non-positive weight", () => {
      expect(() =>
        recordTaskContribution(db, { taskId: "t1", agentId: "a", weight: 0 }),
      ).toThrow(/weight/);
    });

    it("distributeRevenueV2 splits proportional to weight", () => {
      recordTaskContribution(db, { taskId: "t1", agentId: "a", weight: 3 });
      recordTaskContribution(db, { taskId: "t1", agentId: "b", weight: 1 });
      const r = distributeRevenueV2(db, { taskId: "t1", total: 100 });
      const shareA = r.shares.find((s) => s.agentId === "a");
      const shareB = r.shares.find((s) => s.agentId === "b");
      expect(shareA.share).toBe(75);
      expect(shareB.share).toBe(25);
    });

    it("aggregates multiple contributions from the same agent", () => {
      recordTaskContribution(db, { taskId: "t2", agentId: "a", weight: 2 });
      recordTaskContribution(db, { taskId: "t2", agentId: "a", weight: 2 });
      recordTaskContribution(db, { taskId: "t2", agentId: "b", weight: 4 });
      const r = distributeRevenueV2(db, { taskId: "t2", total: 80 });
      expect(r.shares).toHaveLength(2);
      const shareA = r.shares.find((s) => s.agentId === "a");
      expect(shareA.weight).toBe(4);
      expect(shareA.share).toBe(40);
    });

    it("throws when task has no contributions", () => {
      expect(() =>
        distributeRevenueV2(db, { taskId: "empty", total: 100 }),
      ).toThrow(/No contributions/);
    });

    it("listDistributions filters by taskId", () => {
      recordTaskContribution(db, { taskId: "t1", agentId: "a", weight: 1 });
      recordTaskContribution(db, { taskId: "t2", agentId: "a", weight: 1 });
      distributeRevenueV2(db, { taskId: "t1", total: 50 });
      distributeRevenueV2(db, { taskId: "t2", total: 50 });
      expect(listDistributions({ taskId: "t1" })).toHaveLength(1);
      expect(listDistributions()).toHaveLength(2);
    });
  });

  describe("getEconomyStatsV2", () => {
    it("surfaces totals + breakdowns", () => {
      _setBalance("a", 100);
      _setBalance("b", 100);
      const ch = openChannelV2(db, {
        partyA: "a",
        partyB: "b",
        depositA: 30,
      });
      activateChannel(db, ch.id);
      const n = mintNFTV2(db, { owner: "a", assetType: "skill" });
      listNFT(db, n.id, 100);
      priceServiceV2(db, {
        serviceId: "s1",
        paymentType: PAYMENT_TYPE.PER_CALL,
        rate: 1,
      });
      const stats = getEconomyStatsV2();
      expect(stats.totalAccounts).toBe(2);
      expect(stats.totalChannels).toBe(1);
      expect(stats.channelsByStatus.active).toBe(1);
      expect(stats.nftByStatus.listed).toBe(1);
      expect(stats.priceModels).toBe(1);
    });
  });
});
