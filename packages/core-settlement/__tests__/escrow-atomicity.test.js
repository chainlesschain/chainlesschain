import { describe, it, expect, beforeAll } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { createLedger } = require("../lib/ledger.js");
const { createEscrow } = require("../lib/escrow.js");
const { signEntry } = require("../lib/signing.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const { makeMember } = require("./helpers/fixtures.js");

// 证明 escrow 每个写操作是原子的：若「转账成功、状态写失败」这种部分失败发生，
// SAVEPOINT 会把转账一并回滚——钱不动、状态不变，可安全重试，杜绝 double-settle。

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

const LEDGER_ID = "fed-1";

function fundedSetup() {
  const db = adaptSqlJsDb(new SQL.Database());
  applySchema(db);
  const genesis = makeMember("did:cc:genesis");
  const ledger = createLedger(db, { ledgerId: LEDGER_ID, genesisDid: genesis.did });
  ledger.registerMember(genesis);
  const buyer = makeMember("did:cc:buyer");
  const seller = makeMember("did:cc:seller");
  const custodian = makeMember("did:cc:custodian");
  [buyer, seller, custodian].forEach((m) => ledger.registerMember(m));
  ledger.signAndMint({ to: buyer.did, amount: 1000, secretKey: genesis.secretKey });
  return { db, ledger, genesis, buyer, seller, custodian };
}

function buyerFund(buyer, custodianDid, amount, nonce) {
  const core = { ledgerId: LEDGER_ID, kind: "transfer", from: buyer.did, to: custodianDid, amount, nonce };
  return { nonce, alg: buyer.alg, sig: signEntry(core, buyer.secretKey) };
}

// 包一层 db，让命中某个 SQL 子串的 statement.run() 抛错（模拟状态写失败），
// 但同一连接的其它写（转账 INSERT）正常执行 → 触发「转账已落、状态没落」中间态。
function faultyOn(db, sqlSubstr) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      if (sql.includes(sqlSubstr)) {
        return {
          run: () => {
            throw new Error("simulated write failure");
          },
          get: (...a) => stmt.get(...a),
          all: (...a) => stmt.all(...a),
        };
      }
      return stmt;
    },
    exec: (sql) => db.exec(sql),
  };
}

describe("escrow — write atomicity (no double-settle / no lost money on partial failure)", () => {
  it("a failed status UPDATE during release rolls back the payment", () => {
    const { db, ledger, buyer, seller, custodian } = fundedSetup();
    const faulty = faultyOn(db, "UPDATE escrow_holds");
    const escrow = createEscrow(faulty, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });

    const h = escrow.openHold({ orderId: "o1", buyer: buyer.did, seller: seller.did, amount: 180, fund: buyerFund(buyer, custodian.did, 180, "n1") });
    expect(h.ok).toBe(true);
    expect(ledger.balanceOf(custodian.did)).toBe(180);

    // release：转账会成功，但状态 UPDATE 被注入失败 → 整笔应回滚
    const r = escrow.release(h.holdId);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("tx_failed");

    // 钱没动：卖方仍 0、托管人仍持 180；hold 仍 held → 可安全重试
    expect(ledger.balanceOf(seller.did)).toBe(0);
    expect(ledger.balanceOf(custodian.did)).toBe(180);
    expect(escrow.getHold(h.holdId).status).toBe("held");
    // 守恒未被破坏
    expect(ledger.balanceOf(buyer.did) + ledger.balanceOf(seller.did) + ledger.balanceOf(custodian.did)).toBe(ledger.totalMinted());
    // 账本链仍自洽（被回滚的转账没留下半条记录）
    expect(ledger.verifyChain()).toMatchObject({ ok: true });
  });

  it("after rollback, a subsequent healthy release succeeds exactly once", () => {
    const { db, ledger, buyer, seller, custodian } = fundedSetup();
    const faulty = faultyOn(db, "UPDATE escrow_holds");
    const escrowBad = createEscrow(faulty, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });
    const h = escrowBad.openHold({ orderId: "o1", buyer: buyer.did, seller: seller.did, amount: 180, fund: buyerFund(buyer, custodian.did, 180, "n1") });
    expect(escrowBad.release(h.holdId).ok).toBe(false); // 失败回滚

    // 用健康 db 重试同一 hold → 恰好放款一次，不会因前次中间态而重复
    const escrowOk = createEscrow(db, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });
    const r = escrowOk.release(h.holdId);
    expect(r.ok).toBe(true);
    expect(ledger.balanceOf(seller.did)).toBe(180);
    expect(ledger.balanceOf(custodian.did)).toBe(0);
    expect(escrowOk.getHold(h.holdId).status).toBe("released");
    expect(escrowOk.release(h.holdId).ok).toBe(false); // 二次放款被状态闸拦
  });
});
