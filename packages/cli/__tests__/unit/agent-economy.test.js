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
} from "../../src/lib/agent-economy.js";

describe("agent-economy", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
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
});
