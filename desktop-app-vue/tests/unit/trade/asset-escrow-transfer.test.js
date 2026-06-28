/**
 * AssetManager.transferAsset fromDid + 托管资金流转回归测试
 *
 * 历史 bug：transferAsset 硬编码从当前登录用户 (currentDid) 扣款，没有 from 参数。
 * 托管释放/退款注释说"从 ESCROW_SYSTEM 转"，实际却扣 currentDid →
 *   - releaseEscrow：买家被二次扣款 + ESCROW_SYSTEM 锁定的钱永远取不出
 *   - refundEscrow（买家触发时 currentDid===买家===收款方）→ 撞自转账守卫抛错
 *   - marketplace confirmDelivery 带 asset_id 时，买家=当前用户=收款方 → 同样抛错
 * 修复：transferAsset 增加可选第 6 参 fromDid（默认 currentDid，不经 IPC 透传），
 * 托管释放/退款传 ESCROW_SYSTEM、锁定传买家、交付传卖家。
 */

let Database;
let hasSqlite = true;
try {
  Database = require("better-sqlite3");
  const t = new Database(":memory:");
  t.close();
} catch {
  hasSqlite = false;
}

const { AssetManager } = require("../../../src/main/trade/asset-manager");
const { EscrowManager } = require("../../../src/main/trade/escrow-manager");

const describeIf = hasSqlite ? describe : describe.skip;

const ASSET_ID = "asset-coin";

function makeDidManager(did) {
  return {
    current: did,
    getCurrentIdentity() {
      return this.current ? { did: this.current } : null;
    },
  };
}

function seedAsset(db) {
  db.prepare(
    `INSERT INTO assets (id, asset_type, name, symbol, creator_did, total_supply, created_at)
     VALUES (?, 'token', 'Coin', 'CN', 'did:issuer', 1000000, 0)`,
  ).run(ASSET_ID);
}

function setHolding(db, ownerDid, amount) {
  db.prepare(
    `INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at)
     VALUES (?, ?, ?, 0, 0)
     ON CONFLICT(asset_id, owner_did) DO UPDATE SET amount = excluded.amount`,
  ).run(ASSET_ID, ownerDid, amount);
}

describeIf("AssetManager.transferAsset fromDid", () => {
  let db, database, assetManager;
  const BUYER = "did:buyer";
  const SELLER = "did:seller";

  beforeEach(async () => {
    db = new Database(":memory:");
    database = { db };
    assetManager = new AssetManager(database, makeDidManager(BUYER), null);
    await assetManager.initialize();
    seedAsset(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it("defaults to currentDid as sender (backward compatible)", async () => {
    setHolding(db, BUYER, 100);
    await assetManager.transferAsset(ASSET_ID, SELLER, 30);
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(70);
    expect(await assetManager.getBalance(SELLER, ASSET_ID)).toBe(30);
  });

  it("debits fromDid (not the current user) when fromDid is given", async () => {
    // 当前用户是买家，但显式从 ESCROW_SYSTEM 转给卖家（托管释放路径）
    setHolding(db, "ESCROW_SYSTEM", 50);
    setHolding(db, BUYER, 100);

    await assetManager.transferAsset(
      ASSET_ID,
      SELLER,
      50,
      "",
      {},
      "ESCROW_SYSTEM",
    );

    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(0);
    expect(await assetManager.getBalance(SELLER, ASSET_ID)).toBe(50);
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(100); // 买家未被二次扣款
  });

  it("records from_did as the actual sender, not the current user", async () => {
    setHolding(db, "ESCROW_SYSTEM", 40);
    await assetManager.transferAsset(
      ASSET_ID,
      SELLER,
      40,
      "",
      {},
      "ESCROW_SYSTEM",
    );
    const row = db
      .prepare(
        "SELECT from_did, to_did FROM asset_transfers WHERE asset_id = ?",
      )
      .get(ASSET_ID);
    expect(row.from_did).toBe("ESCROW_SYSTEM");
    expect(row.to_did).toBe(SELLER);
  });

  it("refund path: current user == recipient does NOT trip the self-transfer guard", async () => {
    // 退款：当前用户=买家=收款方，但发送方是 ESCROW_SYSTEM → 不应报"不能转账给自己"
    setHolding(db, "ESCROW_SYSTEM", 60);
    setHolding(db, BUYER, 10);

    await expect(
      assetManager.transferAsset(ASSET_ID, BUYER, 60, "", {}, "ESCROW_SYSTEM"),
    ).resolves.toMatchObject({ success: true });

    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(70);
    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(0);
  });

  it("self-transfer guard now applies to the effective sender", async () => {
    setHolding(db, "ESCROW_SYSTEM", 20);
    await expect(
      assetManager.transferAsset(
        ASSET_ID,
        "ESCROW_SYSTEM",
        5,
        "",
        {},
        "ESCROW_SYSTEM",
      ),
    ).rejects.toThrow("不能转账给自己");
  });

  it("insufficient balance is checked against the sender account", async () => {
    setHolding(db, "ESCROW_SYSTEM", 10);
    setHolding(db, BUYER, 1000); // 买家有钱，但发送方是 ESCROW_SYSTEM
    await expect(
      assetManager.transferAsset(ASSET_ID, SELLER, 50, "", {}, "ESCROW_SYSTEM"),
    ).rejects.toThrow("余额不足");
  });
});

describeIf("EscrowManager fund flow (no double-charge / locked-funds)", () => {
  let db, database, assetManager, escrowManager;
  const BUYER = "did:buyer";
  const SELLER = "did:seller";

  beforeEach(async () => {
    db = new Database(":memory:");
    database = { db };
    // 托管由买家在前台触发
    const didManager = makeDidManager(BUYER);
    assetManager = new AssetManager(database, didManager, null);
    await assetManager.initialize();
    escrowManager = new EscrowManager(database, didManager, assetManager);
    await escrowManager.initialize();
    seedAsset(db);
    setHolding(db, BUYER, 100);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it("releaseEscrow moves locked funds from ESCROW_SYSTEM to seller without double-charging the buyer", async () => {
    const escrow = await escrowManager.createEscrow({
      transactionId: "txn-1",
      buyerDid: BUYER,
      sellerDid: SELLER,
      assetId: ASSET_ID,
      amount: 40,
    });
    // 创建即自动锁定：买家 100 → 60，ESCROW_SYSTEM 0 → 40
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(60);
    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(40);

    await escrowManager.releaseEscrow(escrow.id, SELLER);

    expect(await assetManager.getBalance(SELLER, ASSET_ID)).toBe(40); // 卖家收到
    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(0); // 托管账户清空，未锁死
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(60); // 买家未被二次扣款
  });

  it("refundEscrow returns locked funds to the buyer (buyer is current user)", async () => {
    const escrow = await escrowManager.createEscrow({
      transactionId: "txn-2",
      buyerDid: BUYER,
      sellerDid: SELLER,
      assetId: ASSET_ID,
      amount: 40,
    });
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(60);

    await escrowManager.refundEscrow(escrow.id, "买家取消");

    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(100); // 全额退回
    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(0);
    expect(await assetManager.getBalance(SELLER, ASSET_ID)).toBe(0);
  });
});
