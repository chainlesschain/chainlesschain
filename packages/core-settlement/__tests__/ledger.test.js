import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { createLedger } = require("../lib/ledger.js");
const { signEntry } = require("../lib/signing.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const { makeMember } = require("./helpers/fixtures.js");

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

const LEDGER_ID = "fed-1";

function setup() {
  const db = adaptSqlJsDb(new SQL.Database());
  applySchema(db);
  const genesis = makeMember("did:cc:genesis");
  const ledger = createLedger(db, { ledgerId: LEDGER_ID, genesisDid: genesis.did });
  ledger.registerMember(genesis);
  const alice = makeMember("did:cc:alice");
  const bob = makeMember("did:cc:bob");
  ledger.registerMember(alice);
  ledger.registerMember(bob);
  return { db, ledger, genesis, alice, bob };
}

describe("ledger — append-only signed transfer log", () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it("genesis mint credits a balance; conservation holds", () => {
    const { ledger, genesis, alice } = ctx;
    const r = ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    expect(r.ok).toBe(true);
    expect(ledger.balanceOf(alice.did)).toBe(1000);
    expect(ledger.totalMinted()).toBe(1000);
    // 守恒：alice 1000，其余 0
    expect(ledger.balanceOf(alice.did) + ledger.balanceOf("did:cc:bob")).toBe(ledger.totalMinted());
  });

  it("rejects mint signed by non-genesis (no central-bank power for others)", () => {
    const { ledger, alice } = ctx;
    // alice 试图自己 mint：用 alice 私钥签 mint core，但 ledger 用 genesis 公钥验 → 失败
    const core = { ledgerId: LEDGER_ID, kind: "mint", from: null, to: alice.did, amount: 999, nonce: "n1" };
    const sig = signEntry(core, alice.secretKey);
    const r = ledger.mint({ to: alice.did, amount: 999, nonce: "n1", sig });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_genesis_sig");
    expect(ledger.totalMinted()).toBe(0);
  });

  it("valid transfer moves balance and conserves total", () => {
    const { ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    const r = ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 300, secretKey: alice.secretKey });
    expect(r.ok).toBe(true);
    expect(ledger.balanceOf(alice.did)).toBe(700);
    expect(ledger.balanceOf(bob.did)).toBe(300);
    expect(ledger.balanceOf(alice.did) + ledger.balanceOf(bob.did)).toBe(ledger.totalMinted());
  });

  it("rejects overdraft", () => {
    const { ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 100, secretKey: genesis.secretKey });
    const r = ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 101, secretKey: alice.secretKey });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_funds");
    expect(ledger.balanceOf(alice.did)).toBe(100);
  });

  it("rejects replay (reused nonce by same payer)", () => {
    const { ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    const ok = ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 100, secretKey: alice.secretKey, nonce: "dup" });
    expect(ok.ok).toBe(true);
    const replay = ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 100, secretKey: alice.secretKey, nonce: "dup" });
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("nonce_reused");
    expect(ledger.balanceOf(bob.did)).toBe(100); // 只过一次
  });

  it("rejects a transfer with a forged signature (node cannot fabricate)", () => {
    const { ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    // 用 bob 的私钥伪造 alice 的转账
    const core = { ledgerId: LEDGER_ID, kind: "transfer", from: alice.did, to: bob.did, amount: 500, nonce: "x" };
    const forged = signEntry(core, bob.secretKey);
    const r = ledger.transfer({ from: alice.did, to: bob.did, amount: 500, nonce: "x", alg: alice.alg, sig: forged });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_sig");
  });

  it("verifyChain passes for honest log and detects tampering", () => {
    const { db, ledger, genesis, alice, bob } = ctx;
    ledger.signAndMint({ to: alice.did, amount: 1000, secretKey: genesis.secretKey });
    ledger.signAndTransfer({ from: alice.did, to: bob.did, amount: 250, secretKey: alice.secretKey });
    expect(ledger.verifyChain()).toMatchObject({ ok: true });

    // 节点篡改余额：直接改某条 amount → 链复算应识破
    db.exec(`UPDATE ledger_entries SET amount = 9999 WHERE kind = 'transfer'`);
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(["hash_mismatch", "bad_sig"]).toContain(v.reason);
  });
});
