/**
 * AssetManager.transferAsset must move value atomically. The local-transfer
 * path debits the sender's holding, credits the receiver's holding, and writes
 * the asset_transfers ledger row as three separate cross-row/cross-table
 * writes. Without an enclosing transaction, a failure on the receiver credit
 * leaves the sender debited but the receiver never credited — value simply
 * vanishes (balances are read straight back from asset_holdings, so the loss
 * persists across processes).
 *
 * These run on a real in-memory better-sqlite3 because a mock db can't model
 * transaction rollback.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { AssetManager } = require("../asset-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const database = { db: sqlite };
  // currentDid only needs to be truthy; the sender is passed explicitly.
  const didManager = { getCurrentIdentity: () => ({ did: "system" }) };
  const manager = new AssetManager(database, didManager, null);
  return { sqlite, manager };
}

function seedHolding(sqlite, { assetId, owner, amount }) {
  const now = Date.now();
  sqlite
    .prepare(
      "INSERT INTO assets (id, asset_type, name, symbol, creator_did, total_supply, decimals, created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(assetId, "token", "T", "T", owner, amount, 0, now);
  sqlite
    .prepare(
      "INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(assetId, owner, amount, now, now);
}

describe("AssetManager.transferAsset — atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
    seedHolding(sqlite, { assetId: "a1", owner: "alice", amount: 100 });
  });

  it("rolls back the sender debit if the receiver credit fails", async () => {
    // Fail ONLY the receiver-credit INSERT; the sender-debit UPDATE would run first.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO asset_holdings/.test(sql)) {
        throw new Error("simulated receiver-credit write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      manager.transferAsset("a1", "bob", 60, "", {}, "alice"),
    ).rejects.toThrow(/receiver-credit/);
    sqlite.prepare = realPrepare;

    // Atomic: alice keeps her full balance, bob got nothing, no ledger row.
    expect(await manager.getBalance("alice", "a1")).toBe(100);
    expect(await manager.getBalance("bob", "a1")).toBe(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM asset_transfers").get().c,
    ).toBe(0);
  });

  it("rolls back the debit + credit if the ledger insert fails", async () => {
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO\s+asset_transfers/.test(sql)) {
        throw new Error("simulated ledger write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      manager.transferAsset("a1", "bob", 60, "", {}, "alice"),
    ).rejects.toThrow(/ledger/);
    sqlite.prepare = realPrepare;

    // Atomic: no value moved at all.
    expect(await manager.getBalance("alice", "a1")).toBe(100);
    expect(await manager.getBalance("bob", "a1")).toBe(0);
  });

  it("a successful transfer conserves value and records the ledger", async () => {
    await manager.transferAsset("a1", "bob", 60, "", {}, "alice");

    expect(await manager.getBalance("alice", "a1")).toBe(40);
    expect(await manager.getBalance("bob", "a1")).toBe(60);
    const ledger = sqlite
      .prepare("SELECT from_did, to_did, amount FROM asset_transfers")
      .all();
    expect(ledger).toEqual([{ from_did: "alice", to_did: "bob", amount: 60 }]);
  });
});

// Seed a token asset created by "system" (the currentDid in makeManager),
// so mint/burn ownership guards pass.
function seedSystemToken(sqlite, { assetId, supply, holder, held }) {
  const now = Date.now();
  sqlite
    .prepare(
      "INSERT INTO assets (id, asset_type, name, symbol, creator_did, total_supply, decimals, created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(assetId, "token", "T", "T", "system", supply, 0, now);
  if (holder) {
    sqlite
      .prepare(
        "INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at) VALUES (?,?,?,?,?)",
      )
      .run(assetId, holder, held, now, now);
  }
}

describe("AssetManager.mintAsset / burnAsset — atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
  });

  it("mintAsset rolls back the supply increase if the holding credit fails", async () => {
    seedSystemToken(sqlite, { assetId: "m1", supply: 100 });

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO asset_holdings/.test(sql)) {
        throw new Error("simulated holding-credit failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.mintAsset("m1", "alice", 50)).rejects.toThrow(
      /holding-credit/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: supply unchanged, nobody credited (supply == sum of holdings).
    expect(
      sqlite.prepare("SELECT total_supply s FROM assets WHERE id = 'm1'").get()
        .s,
    ).toBe(100);
    expect(await manager.getBalance("alice", "m1")).toBe(0);
  });

  it("burnAsset rolls back the holding debit if the supply decrease fails", async () => {
    seedSystemToken(sqlite, {
      assetId: "b1",
      supply: 100,
      holder: "system",
      held: 100,
    });

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE assets SET total_supply = total_supply - /.test(sql)) {
        throw new Error("simulated supply-decrease failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.burnAsset("b1", 40)).rejects.toThrow(
      /supply-decrease/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: holder keeps their balance, supply unchanged.
    expect(await manager.getBalance("system", "b1")).toBe(100);
    expect(
      sqlite.prepare("SELECT total_supply s FROM assets WHERE id = 'b1'").get()
        .s,
    ).toBe(100);
  });
});

// A blockchain adapter stub whose on-chain calls all succeed, so
// transferNFTOnChain reaches its local-DB write block.
function makeNftManager() {
  const sqlite = new Database(":memory:");
  const didManager = { getCurrentIdentity: () => ({ did: "alice" }) };
  const blockchainAdapter = {
    switchChain: async () => {},
    getNFTOwner: async () => "0xFROM",
    transferNFT: async () => "0xtxhash",
    walletManager: {
      unlockWallet: async () => ({ getAddress: async () => "0xFROM" }),
    },
  };
  const manager = new AssetManager(
    { db: sqlite },
    didManager,
    null,
    blockchainAdapter,
  );
  return { sqlite, manager };
}

describe("AssetManager.transferNFTOnChain — local-record atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeNftManager());
    await manager.initialize();
    const now = Date.now();
    // NFT asset owned by alice, deployed on-chain as ERC721.
    sqlite
      .prepare(
        "INSERT INTO assets (id, asset_type, name, symbol, creator_did, total_supply, decimals, created_at) VALUES ('nft1','nft','N','N','alice',1,0,?)",
      )
      .run(now);
    sqlite
      .prepare(
        "INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at) VALUES ('nft1','alice',1,?,?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO blockchain_assets (id, local_asset_id, contract_address, chain_id, token_type, token_id, deployed_at) VALUES ('ba1','nft1','0xc',1,'ERC721','7',?)",
      )
      .run(now);
  });

  it("rolls back the sender zeroing if the receiver credit fails", async () => {
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO asset_holdings/.test(sql)) {
        throw new Error("simulated receiver-credit failure");
      }
      return realPrepare(sql);
    };

    await expect(
      manager.transferNFTOnChain("nft1", "bob", "0xTO", "wallet1", "pw"),
    ).rejects.toThrow(/receiver-credit/);
    sqlite.prepare = realPrepare;

    // Atomic: alice still holds the NFT, bob has nothing (on-chain already ran,
    // but the local record must not lose the NFT).
    expect(await manager.getBalance("alice", "nft1")).toBe(1);
    expect(await manager.getBalance("bob", "nft1")).toBe(0);
  });

  it("a successful on-chain NFT transfer moves the local record", async () => {
    await manager.transferNFTOnChain("nft1", "bob", "0xTO", "wallet1", "pw");
    expect(await manager.getBalance("alice", "nft1")).toBe(0);
    expect(await manager.getBalance("bob", "nft1")).toBe(1);
  });
});
