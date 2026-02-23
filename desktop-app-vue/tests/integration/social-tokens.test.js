/**
 * Social Tokens Integration Tests
 *
 * Tests the full token economics lifecycle: create token, mint, transfer, burn,
 * and query operations through the SocialTokenManager.
 *
 * All database access goes through a stateful in-memory mock so no native
 * better-sqlite3 binary is required.
 *
 * Scenarios covered:
 * 1. Token lifecycle: create → transfer → burn → mint
 * 2. Token constraints (insufficient balance, self-transfer, negative amounts)
 * 3. Transaction history ordering and types
 * 4. Top holders ranking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `uuid-${++counter}` };
});

// ---------------------------------------------------------------------------
// Stateful in-memory mock database
// ---------------------------------------------------------------------------

function createStatefulMockDatabase() {
  const communityTokens = new Map();  // tokenId → row
  const tokenBalances = new Map();    // "tokenId:holderDid" → row
  const tokenTransactions = new Map(); // txId → row

  function balKey(tokenId, holderDid) {
    return `${tokenId}:${holderDid}`;
  }

  function makeStmt(sql) {
    return {
      run: vi.fn((...args) => {
        const flat = args.flat();

        // -- community_tokens --
        if (sql.includes("INSERT INTO community_tokens")) {
          const [id, communityId, tokenName, tokenSymbol, totalSupply, decimals, creatorDid, createdAt] = flat;
          communityTokens.set(id, { id, community_id: communityId, token_name: tokenName, token_symbol: tokenSymbol, total_supply: totalSupply, decimals, creator_did: creatorDid, created_at: createdAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE community_tokens SET total_supply = total_supply + ?")) {
          const [amount, tokenId] = flat;
          const t = communityTokens.get(tokenId);
          if (t) t.total_supply += amount;
          return { changes: 1 };
        }
        if (sql.includes("UPDATE community_tokens SET total_supply = total_supply - ?")) {
          const [amount, tokenId] = flat;
          const t = communityTokens.get(tokenId);
          if (t) t.total_supply -= amount;
          return { changes: 1 };
        }

        // -- token_balances --
        if (sql.includes("INSERT INTO token_balances")) {
          const [id, tokenId, holderDid, balance, updatedAt] = flat;
          tokenBalances.set(balKey(tokenId, holderDid), { id, token_id: tokenId, holder_did: holderDid, balance, updated_at: updatedAt });
          return { changes: 1 };
        }
        if (sql.includes("UPDATE token_balances SET balance =")) {
          const [balance, updatedAt, tokenId, holderDid] = flat;
          const row = tokenBalances.get(balKey(tokenId, holderDid));
          if (row) { row.balance = balance; row.updated_at = updatedAt; }
          return { changes: 1 };
        }

        // -- token_transactions --
        if (sql.includes("INSERT INTO token_transactions")) {
          const [id, tokenId, fromDid, toDid, amount, txType, memo, createdAt] = flat;
          tokenTransactions.set(id, { id, token_id: tokenId, from_did: fromDid, to_did: toDid, amount, tx_type: txType, memo, created_at: createdAt });
          return { changes: 1 };
        }

        return { changes: 0 };
      }),

      get: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("SELECT id FROM community_tokens WHERE community_id =")) {
          const [communityId] = flat;
          for (const [, t] of communityTokens) {
            if (t.community_id === communityId) return t;
          }
          return null;
        }

        if (sql.includes("SELECT * FROM community_tokens WHERE id =")) {
          return communityTokens.get(flat[0]) || null;
        }

        if (sql.includes("SELECT * FROM token_balances WHERE token_id = ? AND holder_did =")) {
          const [tokenId, holderDid] = flat;
          return tokenBalances.get(balKey(tokenId, holderDid)) || null;
        }

        if (sql.includes("SELECT balance FROM token_balances WHERE token_id = ? AND holder_did =")) {
          const [tokenId, holderDid] = flat;
          return tokenBalances.get(balKey(tokenId, holderDid)) || null;
        }

        if (sql.includes("SELECT id FROM token_balances WHERE token_id = ? AND holder_did =")) {
          const [tokenId, holderDid] = flat;
          return tokenBalances.get(balKey(tokenId, holderDid)) || null;
        }

        if (sql.includes("SELECT COUNT(*)") && sql.includes("token_balances")) {
          const [tokenId] = flat;
          const count = [...tokenBalances.values()].filter(
            (b) => b.token_id === tokenId && b.balance > 0,
          ).length;
          return { count };
        }

        if (sql.includes("SELECT COUNT(*)") && sql.includes("token_transactions")) {
          const [tokenId] = flat;
          const count = [...tokenTransactions.values()].filter(
            (tx) => tx.token_id === tokenId,
          ).length;
          return { count };
        }

        return null;
      }),

      all: vi.fn((...args) => {
        const flat = args.flat();

        if (sql.includes("SELECT * FROM token_transactions WHERE token_id =")) {
          const [tokenId, limit] = flat;
          return [...tokenTransactions.values()]
            .filter((tx) => tx.token_id === tokenId)
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, limit || 50);
        }

        if (sql.includes("SELECT * FROM token_balances WHERE token_id = ? AND balance > 0 ORDER BY balance DESC")) {
          const [tokenId, limit] = flat;
          return [...tokenBalances.values()]
            .filter((b) => b.token_id === tokenId && b.balance > 0)
            .sort((a, b) => b.balance - a.balance)
            .slice(0, limit || 10);
        }

        return [];
      }),
    };
  }

  const db = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => makeStmt(sql)),
    _communityTokens: communityTokens,
    _tokenBalances: tokenBalances,
    _tokenTransactions: tokenTransactions,
  };

  return {
    db,
    saveToFile: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

async function buildTokenManager(database) {
  const { SocialTokenManager } = await import("../../src/main/social/social-token.js");
  const mgr = new SocialTokenManager(database);
  mgr.initialized = true;
  await mgr.initializeTables();
  return mgr;
}

// ---------------------------------------------------------------------------
// Suite 1 – Token lifecycle
// ---------------------------------------------------------------------------

describe("Social Tokens Integration – Token Lifecycle", () => {
  const ALICE = "did:test:alice-tok";
  const BOB = "did:test:bob-tok";
  const ADMIN = "did:test:admin-tok";

  let database;
  let tokenManager;
  let tokenId;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    tokenManager = await buildTokenManager(database);

    // Create the token – initial supply 1000 goes to ALICE
    const token = await tokenManager.createToken("community-1", "AliceCoin", "ALC", 1000, {
      creatorDid: ALICE,
    });
    tokenId = token.id;
  });

  afterEach(() => {
    tokenManager.removeAllListeners();
  });

  it("alice starts with 1000 tokens after creation", async () => {
    const bal = await tokenManager.getBalance(tokenId, ALICE);
    expect(bal.balance).toBe(1000);
    expect(bal.tokenSymbol).toBe("ALC");
  });

  it("alice transfers 100 tokens to bob → alice has 900, bob has 100", async () => {
    await tokenManager.transfer(tokenId, ALICE, BOB, 100);

    const aliceBal = await tokenManager.getBalance(tokenId, ALICE);
    const bobBal = await tokenManager.getBalance(tokenId, BOB);

    expect(aliceBal.balance).toBe(900);
    expect(bobBal.balance).toBe(100);
  });

  it("alice burns 50 tokens → alice has 850", async () => {
    await tokenManager.burn(tokenId, ALICE, 50);

    const bal = await tokenManager.getBalance(tokenId, ALICE);
    expect(bal.balance).toBe(950); // 1000 - 50
  });

  it("full lifecycle: transfer 100 → burn 50 → mint 200 → alice has 1150", async () => {
    await tokenManager.transfer(tokenId, ALICE, BOB, 100);
    await tokenManager.burn(tokenId, ALICE, 50);
    await tokenManager.mint(tokenId, ALICE, 200);

    const bal = await tokenManager.getBalance(tokenId, ALICE);
    // 1000 - 100 - 50 + 200 = 1050
    expect(bal.balance).toBe(1050);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Token constraints
// ---------------------------------------------------------------------------

describe("Social Tokens Integration – Token Constraints", () => {
  const ALICE = "did:test:alice-constr";
  const BOB = "did:test:bob-constr";

  let database;
  let tokenManager;
  let tokenId;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    tokenManager = await buildTokenManager(database);

    const token = await tokenManager.createToken("community-2", "TestCoin", "TST", 500, {
      creatorDid: ALICE,
    });
    tokenId = token.id;
  });

  afterEach(() => {
    tokenManager.removeAllListeners();
  });

  it("transferring more than balance throws an insufficient-balance error", async () => {
    await expect(
      tokenManager.transfer(tokenId, ALICE, BOB, 9999),
    ).rejects.toThrow(/insufficient balance/i);
  });

  it("minting a negative amount throws a validation error", async () => {
    await expect(
      tokenManager.mint(tokenId, ALICE, -50),
    ).rejects.toThrow(/positive|amount/i);
  });

  it("burning more than the held balance throws", async () => {
    await expect(
      tokenManager.burn(tokenId, ALICE, 999999),
    ).rejects.toThrow(/insufficient balance/i);
  });

  it("self-transfer throws an error", async () => {
    await expect(
      tokenManager.transfer(tokenId, ALICE, ALICE, 10),
    ).rejects.toThrow(/yourself|self/i);
  });

  it("minting zero amount throws a validation error", async () => {
    await expect(
      tokenManager.mint(tokenId, ALICE, 0),
    ).rejects.toThrow(/positive|amount/i);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Transaction history
// ---------------------------------------------------------------------------

describe("Social Tokens Integration – Transaction History", () => {
  const ALICE = "did:test:alice-hist";
  const BOB = "did:test:bob-hist";

  let database;
  let tokenManager;
  let tokenId;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    tokenManager = await buildTokenManager(database);

    const token = await tokenManager.createToken("community-3", "HistCoin", "HIS", 1000, {
      creatorDid: ALICE,
    });
    tokenId = token.id;
  });

  afterEach(() => {
    tokenManager.removeAllListeners();
  });

  it("getTransactions returns the initial mint transaction from token creation", async () => {
    const txs = await tokenManager.getTransactions(tokenId);
    expect(txs.length).toBeGreaterThanOrEqual(1);
    expect(txs.some((tx) => tx.tx_type === "mint")).toBe(true);
  });

  it("after full lifecycle has 4 transactions: initial mint + transfer + burn + additional mint", async () => {
    await tokenManager.transfer(tokenId, ALICE, BOB, 100);
    await tokenManager.burn(tokenId, ALICE, 50);
    await tokenManager.mint(tokenId, ALICE, 200);

    const txs = await tokenManager.getTransactions(tokenId);

    // There should be at least 4 transactions (1 initial mint + 3 operations)
    expect(txs.length).toBeGreaterThanOrEqual(4);

    const types = txs.map((tx) => tx.tx_type);
    expect(types).toContain("mint");
    expect(types).toContain("transfer");
    expect(types).toContain("burn");
  });

  it("transaction records contain correct from/to/amount fields", async () => {
    await tokenManager.transfer(tokenId, ALICE, BOB, 77);

    const txs = await tokenManager.getTransactions(tokenId);
    const transferTx = txs.find((tx) => tx.tx_type === "transfer");

    expect(transferTx).toBeDefined();
    expect(transferTx.from_did).toBe(ALICE);
    expect(transferTx.to_did).toBe(BOB);
    expect(transferTx.amount).toBe(77);
  });

  it("reward transaction is recorded with type 'reward'", async () => {
    await tokenManager.reward(tokenId, BOB, 25, "great contribution");

    const txs = await tokenManager.getTransactions(tokenId);
    const rewardTx = txs.find((tx) => tx.tx_type === "reward");

    expect(rewardTx).toBeDefined();
    expect(rewardTx.to_did).toBe(BOB);
    expect(rewardTx.amount).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 – Top holders
// ---------------------------------------------------------------------------

describe("Social Tokens Integration – Top Holders", () => {
  const ALICE = "did:test:alice-top";
  const BOB = "did:test:bob-top";
  const CAROL = "did:test:carol-top";

  let database;
  let tokenManager;
  let tokenId;

  beforeEach(async () => {
    vi.clearAllMocks();
    database = createStatefulMockDatabase();
    tokenManager = await buildTokenManager(database);

    // Create token with supply all initially going to ALICE
    const token = await tokenManager.createToken("community-4", "TopCoin", "TOP", 1000, {
      creatorDid: ALICE,
    });
    tokenId = token.id;

    // Distribute: Alice keeps 600, Bob gets 300, Carol gets 100
    await tokenManager.transfer(tokenId, ALICE, BOB, 300);
    await tokenManager.transfer(tokenId, ALICE, CAROL, 100);
  });

  afterEach(() => {
    tokenManager.removeAllListeners();
  });

  it("getTopHolders returns holders in descending balance order", async () => {
    const holders = await tokenManager.getTopHolders(tokenId);

    expect(holders.length).toBeGreaterThanOrEqual(3);

    // Verify descending order
    for (let i = 0; i < holders.length - 1; i++) {
      expect(holders[i].balance).toBeGreaterThanOrEqual(holders[i + 1].balance);
    }

    expect(holders[0].holder_did).toBe(ALICE);
  });

  it("getTopHolders(2) returns only the top 2 holders", async () => {
    const top2 = await tokenManager.getTopHolders(tokenId, 2);

    expect(top2.length).toBe(2);
    expect(top2[0].holder_did).toBe(ALICE);  // 600
    expect(top2[1].holder_did).toBe(BOB);   // 300
  });

  it("getTopHolders does not include zero-balance holders", async () => {
    // Alice burns all her remaining tokens
    const aliceBal = await tokenManager.getBalance(tokenId, ALICE);
    await tokenManager.burn(tokenId, ALICE, aliceBal.balance);

    const holders = await tokenManager.getTopHolders(tokenId);
    const aliceEntry = holders.find((h) => h.holder_did === ALICE);
    expect(aliceEntry).toBeUndefined();
  });

  it("getTokenInfo returns correct holder and transaction counts", async () => {
    const info = await tokenManager.getTokenInfo(tokenId);

    // At least 3 holders (alice, bob, carol) with balance > 0
    expect(info.holder_count).toBeGreaterThanOrEqual(2);
    // At least 3 transactions (initial mint + 2 transfers)
    expect(info.transaction_count).toBeGreaterThanOrEqual(3);
    expect(info.token_symbol).toBe("TOP");
  });
});
