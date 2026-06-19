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
function injectForged(db, ledger, { kind, from, to, amount, nonce, signer }) {
  const prev = ledger.head();
  const core = { ledgerId: LEDGER_ID, kind, from: from == null ? null : from, to, amount, nonce };
  const sig = signEntry(core, signer.secretKey); // 由 signer 真实签名（验签会过）
  const eh = entryHash(canonicalizeEntry(core), prev);
  db.prepare(
    `INSERT INTO ledger_entries(entry_id, ledger_id, kind, from_did, to_did, amount, nonce, prev_hash, entry_hash, signer_did, alg, sig, created_at_ms)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run("forge-" + nonce, LEDGER_ID, kind, from == null ? null : from, to, amount, nonce, prev, eh, signer.did, signer.alg, sig, 0);
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
});
