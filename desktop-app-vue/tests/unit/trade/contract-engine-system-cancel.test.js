/**
 * SmartContractEngine 系统自动取消（时间锁到期）回归测试
 *
 * 历史 bug：autoCheckAndExecute 的 setInterval 对过期合约调用 cancelContract，
 * 但 cancelContract 要求当前登录用户 (currentDid) 是合约参与方，否则抛
 * "只有合约参与方才能取消合约"（无人登录则抛 "未登录"）。于是当登录用户不是
 * 该过期合约的参与方时（或无人登录），系统驱动的到期取消静默失败 → 过期合约
 * 永不取消、托管资金永不退回买家。
 *
 * 修复：cancelContract 增加 options.system（第 3 参，不经 IPC 透传），系统路径
 * 跳过登录/参与方校验；autoCheckAndExecute 传 { system: true }。
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

const {
  SmartContractEngine,
} = require("../../../src/main/trade/contract-engine");
const { AssetManager } = require("../../../src/main/trade/asset-manager");
const { EscrowManager } = require("../../../src/main/trade/escrow-manager");

const describeIf = hasSqlite ? describe : describe.skip;

const ASSET_ID = "asset-coin";
const BUYER = "did:buyer";
const SELLER = "did:seller";
const STRANGER = "did:stranger"; // 当前登录用户，非该合约参与方

function makeDidManager(did) {
  return {
    current: did,
    getCurrentIdentity() {
      return this.current ? { did: this.current } : null;
    },
  };
}

describeIf("SmartContractEngine system cancel (expired time-lock)", () => {
  let db, database, assetManager, escrowManager, engine, didManager;

  beforeEach(async () => {
    db = new Database(":memory:");
    database = { db };
    didManager = makeDidManager(STRANGER); // 登录的是陌生人，不是合约参与方
    assetManager = new AssetManager(database, didManager, null);
    await assetManager.initialize();
    escrowManager = new EscrowManager(database, didManager, assetManager);
    await escrowManager.initialize();
    engine = new SmartContractEngine(
      database,
      didManager,
      assetManager,
      escrowManager,
    );
    await engine.initialize();

    // 资产 + 托管账户里锁着买家的 40（模拟合约创建时已锁定）
    db.prepare(
      `INSERT INTO assets (id, asset_type, name, symbol, creator_did, total_supply, created_at)
       VALUES (?, 'token', 'Coin', 'CN', 'did:issuer', 1000000, 0)`,
    ).run(ASSET_ID);
    db.prepare(
      `INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at)
       VALUES (?, 'ESCROW_SYSTEM', 40, 0, 0)`,
    ).run(ASSET_ID);
    db.prepare(
      `INSERT INTO escrows (id, transaction_id, buyer_did, seller_did, asset_id, amount, status, created_at)
       VALUES ('esc1', 'txn1', ?, ?, ?, 40, 'locked', 0)`,
    ).run(BUYER, SELLER, ASSET_ID);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  function seedContract({ status = "active", expiresAt = 1 } = {}) {
    db.prepare(
      `INSERT INTO contracts
        (id, contract_type, escrow_type, title, creator_did, parties, terms, status, escrow_id, created_at, expires_at)
       VALUES ('c1', 'timelock', 'standard', '到期退款', ?, ?, '{}', ?, 'esc1', 0, ?)`,
    ).run(BUYER, JSON.stringify([BUYER, SELLER]), status, expiresAt);
  }

  it("system cancel refunds the buyer even when the current user is NOT a party", async () => {
    seedContract();

    await engine.cancelContract("c1", "合约已过期", { system: true });

    const contract = db
      .prepare("SELECT status FROM contracts WHERE id = 'c1'")
      .get();
    expect(contract.status).toBe("cancelled");

    // 托管资金退回买家，ESCROW_SYSTEM 清空
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(40);
    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(0);

    // 事件归属为 SYSTEM
    const evt = db
      .prepare(
        "SELECT actor_did FROM contract_events WHERE contract_id = 'c1' AND event_type = 'cancelled'",
      )
      .get();
    expect(evt.actor_did).toBe("SYSTEM");
  });

  it("autoCheckAndExecute auto-cancels the expired contract (timer path)", async () => {
    seedContract({ expiresAt: Date.now() - 1000 });
    // 一个未满足的必需条件 → checkConditions allMet=false → 跳过 executeContract，
    // 走到期取消分支（否则空条件集 allMet=true 会先执行合约）。
    db.prepare(
      `INSERT INTO contract_conditions (contract_id, condition_type, condition_data, is_required, is_met, created_at)
       VALUES ('c1', 'never_met', '{}', 1, 0, 0)`,
    ).run();

    await engine.autoCheckAndExecute();

    const contract = db
      .prepare("SELECT status FROM contracts WHERE id = 'c1'")
      .get();
    expect(contract.status).toBe("cancelled");
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(40);
  });

  it("non-system cancel still rejects a non-party (security preserved)", async () => {
    seedContract();

    await expect(engine.cancelContract("c1", "随便取消")).rejects.toThrow(
      "只有合约参与方才能取消合约",
    );

    // 合约保持激活，资金未动
    const contract = db
      .prepare("SELECT status FROM contracts WHERE id = 'c1'")
      .get();
    expect(contract.status).toBe("active");
    expect(await assetManager.getBalance("ESCROW_SYSTEM", ASSET_ID)).toBe(40);
  });

  it("a party can still cancel via the normal path", async () => {
    seedContract();
    didManager.current = BUYER; // 买家登录

    await engine.cancelContract("c1", "买家取消");

    const contract = db
      .prepare("SELECT status FROM contracts WHERE id = 'c1'")
      .get();
    expect(contract.status).toBe("cancelled");
    expect(await assetManager.getBalance(BUYER, ASSET_ID)).toBe(40);
  });
});
