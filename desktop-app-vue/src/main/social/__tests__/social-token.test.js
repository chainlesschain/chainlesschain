/**
 * SocialTokenManager Unit Tests
 *
 * Covers:
 * - initialize() table creation for community_tokens, token_balances, token_transactions
 * - createToken() happy path, duplicate community guard, validation errors
 * - mint() balance update, transaction record, amount validation
 * - transfer() balance update, self-transfer guard, insufficient balance guard
 * - burn() balance update, insufficient balance guard, transaction record
 * - getBalance() returns current balance, returns 0 for unknown holder
 * - getTransactions() query delegation and return
 * - getTokenInfo() includes holder_count and transaction_count
 * - getTopHolders() sorted query delegation
 * - reward() mints with type 'reward', correct memo
 * - event emissions: token:created, token:minted, token:transferred, token:burned, token:rewarded
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Module under test ────────────────────────────────────────────────────────
const { SocialTokenManager } = require("../social-token.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock database whose prepare().{all,get,run} is fully controllable.
 * Because SocialTokenManager uses this.database.db internally, we wrap in {db: ...}.
 *
 * We expose _inner so tests can drill into innerDb._prep for assertions.
 */
function createMockInnerDb() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
}

function createMockDatabase() {
  const innerDb = createMockInnerDb();
  return { db: innerDb, _inner: innerDb };
}

/**
 * Build a simple token row as would be returned by the DB.
 */
function makeTokenRow(overrides = {}) {
  return {
    id: "token-001",
    community_id: "community-001",
    token_name: "Governance Token",
    token_symbol: "GOV",
    total_supply: 1000000,
    decimals: 0,
    creator_did: "did:creator:001",
    created_at: 1700000000000,
    ...overrides,
  };
}

/**
 * Build a balance row.
 */
function makeBalanceRow(balance, overrides = {}) {
  return {
    id: "bal-001",
    token_id: "token-001",
    holder_did: "did:holder:001",
    balance,
    updated_at: 1700000000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SocialTokenManager", () => {
  let manager;
  let mockDb;
  let innerDb;

  beforeEach(() => {
    uuidCounter = 0;
    mockDb = createMockDatabase();
    innerDb = mockDb._inner;
    manager = new SocialTokenManager(mockDb);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should store database reference and start uninitialized", () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.initialized).toBe(false);
    });

    it("should be an EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create community_tokens table", async () => {
      await manager.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS community_tokens"),
      );
      expect(hasTable).toBe(true);
    });

    it("should create token_balances table", async () => {
      await manager.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS token_balances"),
      );
      expect(hasTable).toBe(true);
    });

    it("should create token_transactions table", async () => {
      await manager.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS token_transactions"),
      );
      expect(hasTable).toBe(true);
    });

    it("should create indexes", async () => {
      await manager.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasIndex = execCalls.some((sql) =>
        sql.includes("idx_token_balances_token"),
      );
      expect(hasIndex).toBe(true);
    });

    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent – second call skips re-creation", async () => {
      await manager.initialize();
      const firstCount = innerDb.exec.mock.calls.length;

      await manager.initialize();
      expect(innerDb.exec.mock.calls.length).toBe(firstCount);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createToken()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createToken()", () => {
    /**
     * createToken() calls prepare() multiple times:
     *   1. get() – check existing token for community
     *   2. prepare INSERT community_tokens
     *   3. _setBalance internally calls get() to check existing balance row,
     *      then INSERT
     *   4. _recordTransaction INSERT
     *
     * The default mock returns null for get() (no existing token / no balance row),
     * which is the happy path.
     */

    it("should insert a row into community_tokens", async () => {
      const token = await manager.createToken(
        "community-001",
        "Governance Token",
        "GOV",
        1000000,
        { creatorDid: "did:creator:001" },
      );

      const insertCall = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO community_tokens"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should return a token object with correct shape", async () => {
      const token = await manager.createToken(
        "community-001",
        "Governance Token",
        "GOV",
        1000000,
        { creatorDid: "did:creator:001" },
      );

      expect(token).toMatchObject({
        community_id: "community-001",
        token_name: "Governance Token",
        token_symbol: "GOV",
        total_supply: 1000000,
        creator_did: "did:creator:001",
      });
      expect(token.id).toBeTruthy();
      expect(token.created_at).toBeGreaterThan(0);
    });

    it("should uppercase the token symbol", async () => {
      const token = await manager.createToken(
        "community-002",
        "My Token",
        "mtk",
        500,
        { creatorDid: "did:creator:002" },
      );

      expect(token.token_symbol).toBe("MTK");
    });

    it("should assign the full supply balance to the creator", async () => {
      await manager.createToken(
        "community-003",
        "Rep Token",
        "REP",
        5000,
        { creatorDid: "did:creator:003" },
      );

      // _setBalance is called for the creator; find the INSERT into token_balances
      const balanceInsert = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO token_balances"),
      );
      expect(balanceInsert).toBeTruthy();
    });

    it("should record an initial mint transaction", async () => {
      await manager.createToken(
        "community-004",
        "Rep Token",
        "REP",
        5000,
        { creatorDid: "did:creator:004" },
      );

      const txInsert = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO token_transactions"),
      );
      expect(txInsert).toBeTruthy();
    });

    it("should emit token:created event", async () => {
      const spy = vi.fn();
      manager.on("token:created", spy);

      await manager.createToken("community-005", "Tok", "TOK", 100, {
        creatorDid: "did:creator:005",
      });

      expect(spy).toHaveBeenCalledOnce();
      const { token } = spy.mock.calls[0][0];
      expect(token.community_id).toBe("community-005");
    });

    it("should throw if communityId already has a token", async () => {
      // Simulate existing token found
      innerDb._prep.get.mockReturnValueOnce({ id: "existing-token" });

      await expect(
        manager.createToken("community-dup", "Dup Token", "DUP", 100),
      ).rejects.toThrow("Community already has a token");
    });

    it("should throw when communityId is missing", async () => {
      await expect(
        manager.createToken("", "Token", "TOK", 100),
      ).rejects.toThrow("Community ID is required");
    });

    it("should throw when name is empty", async () => {
      await expect(
        manager.createToken("community-006", "  ", "TOK", 100),
      ).rejects.toThrow("Token name is required");
    });

    it("should throw when symbol is empty", async () => {
      await expect(
        manager.createToken("community-007", "Token", "", 100),
      ).rejects.toThrow("Token symbol is required");
    });

    it("should throw when supply is zero or negative", async () => {
      await expect(
        manager.createToken("community-008", "Token", "TOK", 0),
      ).rejects.toThrow("Total supply must be a positive integer");

      await expect(
        manager.createToken("community-009", "Token", "TOK", -1),
      ).rejects.toThrow("Total supply must be a positive integer");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // mint()
  // ─────────────────────────────────────────────────────────────────────────
  describe("mint()", () => {
    /**
     * mint() calls:
     *   1. _getToken: prepare().get() → must return a token row
     *   2. UPDATE community_tokens (total_supply +)
     *   3. _getBalanceValue: prepare().get() → returns balance row or null
     *   4. _setBalance: prepare().get() check, then INSERT or UPDATE
     *   5. _recordTransaction INSERT
     */
    function setupMintMocks({ tokenRow = makeTokenRow(), currentBalance = 0 } = {}) {
      let getCount = 0;
      innerDb._prep.get.mockImplementation(() => {
        getCount++;
        // 1st get: _getToken
        if (getCount === 1) return tokenRow;
        // 2nd get: _getBalanceValue → return balance row
        if (getCount === 2) return currentBalance > 0 ? { balance: currentBalance } : null;
        // 3rd get: _setBalance existence check → always null (insert path)
        return null;
      });
    }

    it("should call UPDATE community_tokens to increase total_supply", async () => {
      setupMintMocks();

      await manager.mint("token-001", "did:recipient:001", 100);

      const updateCall = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE community_tokens") && c[0].includes("total_supply"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should insert a balance row for the recipient", async () => {
      setupMintMocks();

      await manager.mint("token-001", "did:recipient:001", 100);

      const balInsert = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO token_balances"),
      );
      expect(balInsert).toBeTruthy();
    });

    it("should record a transaction of type mint", async () => {
      setupMintMocks();

      await manager.mint("token-001", "did:recipient:001", 50);

      const txInsert = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO token_transactions"),
      );
      expect(txInsert).toBeTruthy();
      // The run call for the transaction should include 'mint' as tx_type
      const txRunArgs = innerDb._prep.run.mock.calls.find((args) =>
        args.includes("mint"),
      );
      expect(txRunArgs).toBeTruthy();
    });

    it("should emit token:minted event with tokenId, toDid, amount", async () => {
      setupMintMocks();

      const spy = vi.fn();
      manager.on("token:minted", spy);

      await manager.mint("token-001", "did:recipient:001", 200);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({
        tokenId: "token-001",
        toDid: "did:recipient:001",
        amount: 200,
      });
    });

    it("should return { success: true, transactionId }", async () => {
      setupMintMocks();

      const result = await manager.mint("token-001", "did:recipient:001", 50);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeTruthy();
    });

    it("should throw when amount is 0", async () => {
      await expect(manager.mint("token-001", "did:recipient:001", 0)).rejects.toThrow(
        "Amount must be a positive number",
      );
    });

    it("should throw when amount is negative", async () => {
      await expect(manager.mint("token-001", "did:recipient:001", -5)).rejects.toThrow(
        "Amount must be a positive number",
      );
    });

    it("should throw when amount is a float", async () => {
      await expect(manager.mint("token-001", "did:recipient:001", 1.5)).rejects.toThrow(
        "Amount must be an integer",
      );
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null); // _getToken returns null

      await expect(manager.mint("nonexistent", "did:recipient:001", 100)).rejects.toThrow(
        "Token not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // transfer()
  // ─────────────────────────────────────────────────────────────────────────
  describe("transfer()", () => {
    /**
     * transfer() calls:
     *   1. _getToken: get() → token row
     *   2. _getBalanceValue (sender): get() → { balance: N }
     *   3. _setBalance sender: get() check, UPDATE
     *   4. _getBalanceValue (recipient): get() → { balance: M }
     *   5. _setBalance recipient: get() check, INSERT or UPDATE
     *   6. _recordTransaction INSERT
     */
    function setupTransferMocks({
      tokenRow = makeTokenRow(),
      senderBalance = 1000,
      recipientBalance = 0,
    } = {}) {
      let getCount = 0;
      innerDb._prep.get.mockImplementation(() => {
        getCount++;
        if (getCount === 1) return tokenRow;                          // _getToken
        if (getCount === 2) return { balance: senderBalance };        // sender balance
        if (getCount === 3) return { id: "sender-bal" };              // sender _setBalance check → exists
        if (getCount === 4) return recipientBalance > 0              // recipient balance
          ? { balance: recipientBalance } : null;
        if (getCount === 5) return null;                              // recipient _setBalance check → insert
        return null;
      });
    }

    it("should deduct from sender and add to recipient", async () => {
      setupTransferMocks({ senderBalance: 500, recipientBalance: 0 });

      await manager.transfer("token-001", "did:sender:001", "did:recipient:001", 100);

      // Should have UPDATE calls for sender and INSERT for recipient (balance management)
      const updates = innerDb.prepare.mock.calls.filter((c) =>
        c[0].includes("UPDATE token_balances"),
      );
      expect(updates.length).toBeGreaterThan(0);
    });

    it("should record a transaction of type transfer", async () => {
      setupTransferMocks({ senderBalance: 500 });

      await manager.transfer("token-001", "did:sender:001", "did:recipient:001", 100);

      const txRunArgs = innerDb._prep.run.mock.calls.find((args) =>
        args.includes("transfer"),
      );
      expect(txRunArgs).toBeTruthy();
    });

    it("should emit token:transferred event", async () => {
      setupTransferMocks({ senderBalance: 500 });

      const spy = vi.fn();
      manager.on("token:transferred", spy);

      await manager.transfer("token-001", "did:sender:001", "did:recipient:001", 50);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({
        tokenId: "token-001",
        fromDid: "did:sender:001",
        toDid: "did:recipient:001",
        amount: 50,
      });
    });

    it("should return { success: true, transactionId }", async () => {
      setupTransferMocks({ senderBalance: 500 });

      const result = await manager.transfer(
        "token-001",
        "did:sender:001",
        "did:recipient:001",
        100,
      );

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeTruthy();
    });

    it("should throw when sender has insufficient balance", async () => {
      setupTransferMocks({ senderBalance: 10 });

      await expect(
        manager.transfer("token-001", "did:sender:001", "did:recipient:001", 100),
      ).rejects.toThrow("Insufficient balance");
    });

    it("should throw when fromDid === toDid (self-transfer)", async () => {
      await expect(
        manager.transfer("token-001", "did:self:001", "did:self:001", 10),
      ).rejects.toThrow("Cannot transfer to yourself");
    });

    it("should throw when amount is 0", async () => {
      await expect(
        manager.transfer("token-001", "did:sender:001", "did:recipient:001", 0),
      ).rejects.toThrow("Amount must be a positive number");
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await expect(
        manager.transfer("nonexistent", "did:sender:001", "did:recipient:001", 10),
      ).rejects.toThrow("Token not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // burn()
  // ─────────────────────────────────────────────────────────────────────────
  describe("burn()", () => {
    /**
     * burn() calls:
     *   1. _getToken: get() → token row
     *   2. _getBalanceValue: get() → { balance: N }
     *   3. _setBalance: get() check, UPDATE
     *   4. UPDATE community_tokens (total_supply -)
     *   5. _recordTransaction INSERT
     */
    function setupBurnMocks({
      tokenRow = makeTokenRow(),
      holderBalance = 500,
      balanceRowExists = true,
    } = {}) {
      let getCount = 0;
      innerDb._prep.get.mockImplementation(() => {
        getCount++;
        if (getCount === 1) return tokenRow;
        if (getCount === 2) return holderBalance > 0 ? { balance: holderBalance } : null;
        if (getCount === 3) return balanceRowExists ? { id: "bal-row" } : null;
        return null;
      });
    }

    it("should call UPDATE token_balances to reduce balance", async () => {
      setupBurnMocks({ holderBalance: 500 });

      await manager.burn("token-001", "did:holder:001", 100);

      const updateBal = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE token_balances"),
      );
      expect(updateBal).toBeTruthy();
    });

    it("should call UPDATE community_tokens to reduce total_supply", async () => {
      setupBurnMocks({ holderBalance: 500 });

      await manager.burn("token-001", "did:holder:001", 100);

      const updateSupply = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE community_tokens") && c[0].includes("total_supply"),
      );
      expect(updateSupply).toBeTruthy();
    });

    it("should record a transaction of type burn", async () => {
      setupBurnMocks({ holderBalance: 500 });

      await manager.burn("token-001", "did:holder:001", 100);

      const txRunArgs = innerDb._prep.run.mock.calls.find((args) =>
        args.includes("burn"),
      );
      expect(txRunArgs).toBeTruthy();
    });

    it("should emit token:burned event", async () => {
      setupBurnMocks({ holderBalance: 500 });

      const spy = vi.fn();
      manager.on("token:burned", spy);

      await manager.burn("token-001", "did:holder:001", 200);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({
        tokenId: "token-001",
        fromDid: "did:holder:001",
        amount: 200,
      });
    });

    it("should throw when holder has insufficient balance", async () => {
      setupBurnMocks({ holderBalance: 10 });

      await expect(
        manager.burn("token-001", "did:holder:001", 100),
      ).rejects.toThrow("Insufficient balance");
    });

    it("should throw when amount is 0 or negative", async () => {
      await expect(manager.burn("token-001", "did:holder:001", 0)).rejects.toThrow(
        "Amount must be a positive number",
      );
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await expect(manager.burn("nonexistent", "did:holder:001", 10)).rejects.toThrow(
        "Token not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getBalance()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getBalance()", () => {
    it("should return the holder's balance from a balance row", async () => {
      // getBalance calls _getToken then queries token_balances
      innerDb._prep.get
        .mockReturnValueOnce(makeTokenRow())  // _getToken
        .mockReturnValueOnce(makeBalanceRow(750)); // SELECT token_balances

      const result = await manager.getBalance("token-001", "did:holder:001");

      expect(result.balance).toBe(750);
      expect(result.tokenId).toBe("token-001");
      expect(result.holderDid).toBe("did:holder:001");
    });

    it("should return balance = 0 when no balance row exists", async () => {
      innerDb._prep.get
        .mockReturnValueOnce(makeTokenRow()) // _getToken
        .mockReturnValueOnce(null);          // no balance row

      const result = await manager.getBalance("token-001", "did:holder:new");
      expect(result.balance).toBe(0);
    });

    it("should return tokenSymbol from the token row", async () => {
      innerDb._prep.get
        .mockReturnValueOnce(makeTokenRow({ token_symbol: "GOV" }))
        .mockReturnValueOnce(null);

      const result = await manager.getBalance("token-001", "did:holder:001");
      expect(result.tokenSymbol).toBe("GOV");
    });

    it("should throw when tokenId is missing", async () => {
      await expect(manager.getBalance("", "did:holder:001")).rejects.toThrow(
        "Token ID is required",
      );
    });

    it("should throw when holderDid is missing", async () => {
      await expect(manager.getBalance("token-001", "")).rejects.toThrow(
        "Holder DID is required",
      );
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await expect(manager.getBalance("nonexistent", "did:holder:001")).rejects.toThrow(
        "Token not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTransactions()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTransactions()", () => {
    it("should query token_transactions for the given tokenId", async () => {
      await manager.getTransactions("token-001");

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("token_transactions");
      expect(sql).toContain("token_id");
    });

    it("should use default limit of 50", async () => {
      await manager.getTransactions("token-001");

      expect(innerDb._prep.all).toHaveBeenCalledWith("token-001", 50);
    });

    it("should use a custom limit when provided", async () => {
      await manager.getTransactions("token-001", 10);

      expect(innerDb._prep.all).toHaveBeenCalledWith("token-001", 10);
    });

    it("should return an array of transactions", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        { id: "tx-1", tx_type: "mint", amount: 100 },
        { id: "tx-2", tx_type: "transfer", amount: 50 },
      ]);

      const txs = await manager.getTransactions("token-001");
      expect(txs).toHaveLength(2);
    });

    it("should throw when tokenId is missing", async () => {
      await expect(manager.getTransactions("")).rejects.toThrow("Token ID is required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTokenInfo()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTokenInfo()", () => {
    it("should return token metadata with holder_count and transaction_count", async () => {
      innerDb._prep.get
        .mockReturnValueOnce(makeTokenRow())      // _getToken
        .mockReturnValueOnce({ count: 5 })        // holder count
        .mockReturnValueOnce({ count: 20 });      // tx count

      const info = await manager.getTokenInfo("token-001");

      expect(info.id).toBe("token-001");
      expect(info.holder_count).toBe(5);
      expect(info.transaction_count).toBe(20);
    });

    it("should default holder_count and transaction_count to 0 when queries return null", async () => {
      innerDb._prep.get
        .mockReturnValueOnce(makeTokenRow())
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);

      const info = await manager.getTokenInfo("token-001");
      expect(info.holder_count).toBe(0);
      expect(info.transaction_count).toBe(0);
    });

    it("should throw when tokenId is missing", async () => {
      await expect(manager.getTokenInfo("")).rejects.toThrow("Token ID is required");
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await expect(manager.getTokenInfo("nonexistent")).rejects.toThrow("Token not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTopHolders()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTopHolders()", () => {
    it("should query token_balances ordered by balance DESC", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeTokenRow()); // _getToken in verify step

      await manager.getTopHolders("token-001");

      const sql = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("ORDER BY balance DESC"),
      );
      expect(sql).toBeTruthy();
    });

    it("should use default limit of 10", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeTokenRow());

      await manager.getTopHolders("token-001");

      expect(innerDb._prep.all).toHaveBeenCalledWith("token-001", 10);
    });

    it("should use a custom limit when provided", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeTokenRow());

      await manager.getTopHolders("token-001", 3);

      expect(innerDb._prep.all).toHaveBeenCalledWith("token-001", 3);
    });

    it("should return the list from DB", async () => {
      innerDb._prep.get.mockReturnValueOnce(makeTokenRow());
      innerDb._prep.all.mockReturnValueOnce([
        { holder_did: "did:holder:A", balance: 500 },
        { holder_did: "did:holder:B", balance: 200 },
      ]);

      const holders = await manager.getTopHolders("token-001");
      expect(holders).toHaveLength(2);
      expect(holders[0].balance).toBe(500);
    });

    it("should throw when tokenId is missing", async () => {
      await expect(manager.getTopHolders("")).rejects.toThrow("Token ID is required");
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await expect(manager.getTopHolders("nonexistent")).rejects.toThrow("Token not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // reward()
  // ─────────────────────────────────────────────────────────────────────────
  describe("reward()", () => {
    /**
     * reward() is similar to mint() but uses TX_TYPES.REWARD and includes a memo.
     */
    function setupRewardMocks({ tokenRow = makeTokenRow(), currentBalance = 0 } = {}) {
      let getCount = 0;
      innerDb._prep.get.mockImplementation(() => {
        getCount++;
        if (getCount === 1) return tokenRow;
        if (getCount === 2) return currentBalance > 0 ? { balance: currentBalance } : null;
        return null;
      });
    }

    it("should increase total_supply via UPDATE community_tokens", async () => {
      setupRewardMocks();

      await manager.reward("token-001", "did:contributor:001", 50, "Great contribution");

      const updateCall = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE community_tokens") && c[0].includes("total_supply"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should record a transaction of type reward", async () => {
      setupRewardMocks();

      await manager.reward("token-001", "did:contributor:001", 25, "Bug fix");

      const txRunArgs = innerDb._prep.run.mock.calls.find((args) =>
        args.includes("reward"),
      );
      expect(txRunArgs).toBeTruthy();
    });

    it("should include the reason as memo in the transaction", async () => {
      setupRewardMocks();

      await manager.reward("token-001", "did:contributor:001", 10, "Top post of the week");

      const txRunArgs = innerDb._prep.run.mock.calls.find((args) =>
        args.includes("Top post of the week"),
      );
      expect(txRunArgs).toBeTruthy();
    });

    it("should emit token:rewarded event with reason", async () => {
      setupRewardMocks();

      const spy = vi.fn();
      manager.on("token:rewarded", spy);

      await manager.reward("token-001", "did:contributor:001", 30, "Helpful answer");

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({
        tokenId: "token-001",
        toDid: "did:contributor:001",
        amount: 30,
        reason: "Helpful answer",
      });
    });

    it("should return { success: true, transactionId }", async () => {
      setupRewardMocks();

      const result = await manager.reward("token-001", "did:contributor:001", 15, "");
      expect(result.success).toBe(true);
      expect(result.transactionId).toBeTruthy();
    });

    it("should throw when amount is 0", async () => {
      await expect(
        manager.reward("token-001", "did:contributor:001", 0, ""),
      ).rejects.toThrow("Amount must be a positive number");
    });

    it("should throw when token is not found", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await expect(
        manager.reward("nonexistent", "did:contributor:001", 10, ""),
      ).rejects.toThrow("Token not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // close()
  // ─────────────────────────────────────────────────────────────────────────
  describe("close()", () => {
    it("should set initialized to false", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);

      await manager.close();
      expect(manager.initialized).toBe(false);
    });

    it("should remove all event listeners", async () => {
      const spy = vi.fn();
      manager.on("token:created", spy);

      await manager.close();
      manager.emit("token:created", {});

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
