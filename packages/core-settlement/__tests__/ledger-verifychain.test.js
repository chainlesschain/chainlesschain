import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "crypto";

const { applySchema } = require("../lib/schema.js");
const { createLedger } = require("../lib/ledger.js");
const { canonicalizeEntry, signEntry } = require("../lib/signing.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const { makeMember } = require("./helpers/fixtures.js");

// verifyChain 是篡改/伪造的后置检测：必须再校验「写入路径的每条不变量」，否则
// 合谋节点/成员直接 INSERT 一条 well-formed（哈希对、签名对）的越权/透支条目就
// 能瞒过再验。下面所有 forge 都构造**自洽哈希链 + 有效签名**，只违反某一条
// 授权/经济规则，证明 verifyChain 不靠哈希/签名兜底也能识破。

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

const LEDGER_ID = "fed-1";

// 复刻 ledger.js 内部的 entry_hash 格式（攻击者也能算）：sha256(canonical || prev)
function entryHash(canonicalBuf, prevHashHex) {
  const h = crypto.createHash("sha256").update(canonicalBuf);
  if (prevHashHex) h.update(Buffer.from(prevHashHex, "hex"));
  return h.digest("hex");
}

function setup() {
  const db = adaptSqlJsDb(new SQL.Database());
  applySchema(db);
  const genesis = makeMember("did:cc:genesis");
  const alice = makeMember("did:cc:alice");
  const bob = makeMember("did:cc:bob");
  const ledger = createLedger(db, { ledgerId: LEDGER_ID, genesisDid: genesis.did });
  [genesis, alice, bob].forEach((m) => ledger.registerMember(m));
  return { db, ledger, genesis, alice, bob };
}

// 把一条自洽哈希链 + 有效签名、但可越权的条目直接塞进表（绕过 mint()/transfer()）。
function injectForged(db, ledger, { kind, from, to, amount, nonce, signer, entryId }) {
  const prev = ledger.head();
  const core = { ledgerId: LEDGER_ID, kind, from: from == null ? null : from, to, amount, nonce };
  const sig = signEntry(core, signer.secretKey); // 由 signer 真实签名（验签会过）
  const eh = entryHash(canonicalizeEntry(core), prev);
  // entry_id 不入签名 core、不入哈希 → 攻击者可自由设定；默认按 nonce 命名，重放
  // 测试需显式传不同 entryId（同 nonce、异 entry_id，模拟真实快照里的复制条目）。
  const id = entryId || "forge-" + nonce;
  db.prepare(
    `INSERT INTO ledger_entries(entry_id, ledger_id, kind, from_did, to_did, amount, nonce, prev_hash, entry_hash, signer_did, alg, sig, created_at_ms)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, LEDGER_ID, kind, from == null ? null : from, to, amount, nonce, prev, eh, signer.did, signer.alg, sig, 0);
}

describe("verifyChain — full invariant re-validation (anti node/member collusion)", () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it("honest chain still verifies (regression)", () => {
    const { ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 300, secretKey: alice.secretKey });
    expect(ledger.verifyChain()).toMatchObject({ ok: true, count: 2 });
  });

  it("returns bad_sig (does not throw) when a member's pubkey_jwk is corrupt (tampered DB)", () => {
    const { db, ledger, genesis, alice } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey });
    // Corrupt the signing member's pubkey_jwk — exactly the tampering verifyChain
    // exists to catch. getMember used to JSON.parse it unguarded → uncaught throw.
    db.prepare("UPDATE settlement_members SET pubkey_jwk = ? WHERE did = ?").run(
      "not-json{",
      genesis.did,
    );
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad_sig");
  });

  it("detects an unauthorized self-mint signed by a non-genesis member", () => {
    const { db, ledger, genesis, alice } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey });
    // alice 直接注入一条 mint 1000 给自己，由 alice 真实签名（签名会过、哈希自洽）
    injectForged(db, ledger, { kind: "mint", from: null, to: alice.did, amount: 1000, nonce: "self-mint", signer: alice });
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("mint_not_by_genesis");
  });

  it("detects a transfer whose signer is not the payer", () => {
    const { db, ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: bob.did, amount: 1000, secretKey: genesis.secretKey });
    // 注入 bob→alice 的转账，但由 alice 自己签 + signer_did=alice（冒名扣 bob 的钱）
    injectForged(db, ledger, { kind: "transfer", from: bob.did, to: alice.did, amount: 500, nonce: "imp", signer: alice });
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("transfer_signer_mismatch");
  });

  it("detects an injected overdraft (spending money that was never funded)", () => {
    const { db, ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey });
    // alice 自己签一条 alice→bob 500（远超余额 100），signer 合法、哈希自洽
    injectForged(db, ledger, { kind: "transfer", from: alice.did, to: bob.did, amount: 500, nonce: "overdraw", signer: alice });
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("insufficient_funds");
  });

  it("detects an injected non-positive amount", () => {
    const { db, ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey });
    injectForged(db, ledger, { kind: "transfer", from: alice.did, to: bob.did, amount: -50, nonce: "neg", signer: alice });
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("invalid_amount");
  });

  // 重放（双花）：把一条已被付款方合法签名的 transfer 原样复制一遍 —— 签名仍有效、
  // 哈希自洽、付款方仍买得起。写入路径靠唯一索引 (ledger_id,signer_did,nonce) 拦；
  // 这里 DROP 掉该索引以模拟 verifyChain 真正的用例：审计一份来源不可信、其存储未
  // 强制 nonce 唯一的账本快照（旧 schema / 文件级篡改）。verifyChain 必须不靠 DB
  // 约束兜底、独立识破重放，否则离线审计会放行双花。
  it("detects a replayed (duplicate-nonce) transfer even without the storage uniqueness constraint", () => {
    const { db, ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 300, secretKey: alice.secretKey });
    // 模拟来源 DB 缺唯一约束（否则下面的重复 nonce INSERT 会被存储层直接拒绝）。
    db.exec("DROP INDEX IF EXISTS idx_ledger_signer_nonce");
    // 同一笔 alice→bob 300（同 nonce "rp"）被注入两次：余额折叠仍 < 1000，守恒不报，
    // 仅 nonce 唯一性能识破。
    injectForged(db, ledger, { kind: "transfer", from: alice.did, to: bob.did, amount: 300, nonce: "rp", signer: alice, entryId: "forge-rp-1" });
    injectForged(db, ledger, { kind: "transfer", from: alice.did, to: bob.did, amount: 300, nonce: "rp", signer: alice, entryId: "forge-rp-2" });
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("nonce_reused");
  });

  // 同一签名者在「不同」nonce 下的多笔合法 transfer 不应被 nonce 检查误伤（回归）。
  it("does not false-positive on distinct nonces from the same signer", () => {
    const { ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 100, secretKey: alice.secretKey });
    ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 100, secretKey: alice.secretKey });
    expect(ledger.verifyChain()).toMatchObject({ ok: true, count: 3 });
  });
});
