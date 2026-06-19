import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { createLedger } = require("../lib/ledger.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const { makeMember } = require("./helpers/fixtures.js");

// 一个 DB 托管两个联邦账本（schema 每条都带 ledger_id）。校验读/链/nonce
// 查询都按 ledger_id 隔离，不串账、不交织哈希链、不跨账本误拦 nonce。
let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

function setupTwoLedgers() {
  const db = adaptSqlJsDb(new SQL.Database());
  applySchema(db);
  // 两账本共用同一 genesis 身份（同 did/同密钥），刻意制造跨账本碰撞场景
  const genesis = makeMember("did:cc:genesis");
  const alice = makeMember("did:cc:alice");
  const bob = makeMember("did:cc:bob");

  const A = createLedger(db, { ledgerId: "fed-A", genesisDid: genesis.did });
  const B = createLedger(db, { ledgerId: "fed-B", genesisDid: genesis.did });
  for (const L of [A, B]) [genesis, alice, bob].forEach((m) => L.registerMember(m));
  return { db, A, B, genesis, alice, bob };
}

describe("ledger — multi-ledger isolation in one DB", () => {
  let ctx;
  beforeEach(() => {
    ctx = setupTwoLedgers();
  });

  it("balances and totalMinted do not commingle across ledgers", () => {
    const { A, B, genesis, alice, bob } = ctx;
    A.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    B.signAndMint({ to: bob.did, amount: 500, secretKey: genesis.secretKey });

    // 账本 A 只看得到自己的钱
    expect(A.balanceOf(alice.did)).toBe(1000);
    expect(A.balanceOf(bob.did)).toBe(0);
    expect(A.totalMinted()).toBe(1000);

    // 账本 B 只看得到自己的钱
    expect(B.balanceOf(bob.did)).toBe(500);
    expect(B.balanceOf(alice.did)).toBe(0);
    expect(B.totalMinted()).toBe(500);

    // 各自守恒
    expect(A.balanceOf(alice.did) + A.balanceOf(bob.did)).toBe(A.totalMinted());
    expect(B.balanceOf(alice.did) + B.balanceOf(bob.did)).toBe(B.totalMinted());
  });

  it("each ledger keeps an independent, verifiable hash chain", () => {
    const { A, B, genesis, alice, bob } = ctx;
    A.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    B.signAndMint({ to: bob.did, amount: 500, secretKey: genesis.secretKey });
    A.signAndTransfer({ from: alice.did, to: bob.did, amount: 200, secretKey: alice.secretKey });

    // 哈希链按账本独立计数（A 有 mint+transfer=2，B 只有 mint=1）
    const va = A.verifyChain();
    const vb = B.verifyChain();
    expect(va).toMatchObject({ ok: true, count: 2 });
    expect(vb).toMatchObject({ ok: true, count: 1 });
    // head 各自指向本账本最后一条
    expect(A.head()).not.toBe(B.head());
  });

  it("same signer may reuse a nonce across different ledgers (not a replay)", () => {
    const { A, B, genesis, alice } = ctx;
    // genesis 在 A 用 nonce "n1" mint
    const a = A.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey, nonce: "n1" });
    expect(a.ok).toBe(true);
    // 同一 genesis 在 B 复用 nonce "n1"：签名 core 含 ledgerId → 字节不同，非重放 → 应放行
    const b = B.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey, nonce: "n1" });
    expect(b.ok).toBe(true);
    // 但在同一账本内复用同一 nonce 仍被拦
    const dup = A.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey, nonce: "n1" });
    expect(dup.ok).toBe(false);
    expect(dup.reason).toBe("nonce_reused");
  });
});
