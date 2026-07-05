/**
 * AuctionManager.placeBid must update bid state atomically. A single bid
 * (1) marks the previous top bid 'outbid', (2) inserts the new 'active' bid,
 * and (3) updates the auction's current_price / current_bidder / bid_count
 * across two tables. Without a transaction, a failure on the auction update
 * leaves the tables inconsistent — e.g. the previous bidder marked outbid and
 * the new bid inserted, but the auction still points at the old bidder/price,
 * so finalizeAuction settles with the wrong winner (or an 'active' bid that
 * nothing references).
 *
 * Runs on a real in-memory better-sqlite3 (a mock db can't model rollback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { AuctionManager } = require("../auction-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const manager = new AuctionManager({ db: sqlite }, null, null);
  return { sqlite, manager };
}

// Seed an active auction that already has one active top bid, without going
// through createAuction (which starts a 24h timer handle).
function seedAuctionWithBid(sqlite, { auctionId, seller, topBidder, price }) {
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO auctions (id, seller_id, item_id, type, start_price, current_price, current_bidder, bid_count, start_time, end_time, status, created_at, updated_at)
       VALUES (?, ?, 'item', 'english', ?, ?, ?, 1, ?, ?, 'active', ?, ?)`,
    )
    .run(auctionId, seller, price, price, topBidder, now, now + 3600, now, now);
  sqlite
    .prepare(
      `INSERT INTO auction_bids (id, auction_id, bidder_id, amount, bid_time, status)
       VALUES ('bid-top', ?, ?, ?, ?, 'active')`,
    )
    .run(auctionId, topBidder, price, now);
}

describe("AuctionManager.placeBid — atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
    seedAuctionWithBid(sqlite, {
      auctionId: "auc1",
      seller: "seller",
      topBidder: "alice",
      price: 100,
    });
  });

  it("rolls back the outbid mark + new bid if the auction update fails", async () => {
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE auctions SET current_price/.test(sql)) {
        throw new Error("simulated auction-update write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.placeBid("auc1", "bob", 150)).rejects.toThrow(
      /auction-update/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: alice's bid still active, bob's bid never inserted, auction
    // still points at alice/100.
    const bids = sqlite
      .prepare("SELECT bidder_id, status FROM auction_bids ORDER BY bidder_id")
      .all();
    expect(bids).toEqual([{ bidder_id: "alice", status: "active" }]);
    const auction = sqlite
      .prepare("SELECT * FROM auctions WHERE id = ?")
      .get("auc1");
    expect(auction.current_bidder).toBe("alice");
    expect(auction.current_price).toBe(100);
  });

  it("a successful bid outbids the previous and updates the auction", async () => {
    const res = await manager.placeBid("auc1", "bob", 150);
    expect(res.success).toBe(true);

    const alice = sqlite
      .prepare(
        "SELECT status FROM auction_bids WHERE auction_id = ? AND bidder_id = 'alice'",
      )
      .get("auc1");
    expect(alice.status).toBe("outbid");
    const bob = sqlite
      .prepare(
        "SELECT status FROM auction_bids WHERE auction_id = ? AND bidder_id = 'bob'",
      )
      .get("auc1");
    expect(bob.status).toBe("active");
    const auction = sqlite
      .prepare("SELECT * FROM auctions WHERE id = ?")
      .get("auc1");
    expect(auction.current_bidder).toBe("bob");
    expect(auction.current_price).toBe(150);
    expect(auction.bid_count).toBe(2);
  });
});
