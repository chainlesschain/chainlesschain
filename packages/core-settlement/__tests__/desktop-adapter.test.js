import { describe, it, expect, beforeAll, beforeEach } from "vitest";

// 被测：桌面集成 adapter（位于 desktop-app-vue，relative require）
const adapter = require("../../../desktop-app-vue/src/main/trade/settlement-escrow.js");
const settlement = require("../lib/index.js");
const ms = require("@chainlesschain/core-multisig");
const ed = require("@chainlesschain/core-mtc/signers/ed25519");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

const LEDGER_ID = "fed-desktop";

// 构造「桌面 DID 身份」：tweetnacl 风格 secret = seed(32)||pub(32)，
// public_key_sign / private_key_ref 与桌面 did-keystore 解密后结构一致。
function makeDesktopIdentity(did) {
  const kp = ed.generateKeyPair(); // {publicKey:32, secretKey:32(seed)}
  const nacl64 = Buffer.concat([Buffer.from(kp.secretKey), Buffer.from(kp.publicKey)]);
  return {
    did,
    public_key_sign: Buffer.from(kp.publicKey).toString("base64"),
    private_key_ref: JSON.stringify({ sign: nacl64.toString("base64"), encrypt: null, mnemonic: null }),
  };
}

describe("settlement-escrow desktop adapter — DID 密钥桥", () => {
  it("naclIdentityToMember 提取 seed 可签可验（64B nacl secret → 32B seed）", () => {
    const id = makeDesktopIdentity("did:chainlesschain:alice");
    const m = adapter.naclIdentityToMember(id);
    expect(m.did).toBe("did:chainlesschain:alice");
    expect(m.secretKey.length).toBe(32);
    const core = { ledgerId: LEDGER_ID, kind: "transfer", from: "x", to: "y", amount: 1, nonce: "n" };
    const sig = settlement.signEntry(core, m.secretKey);
    expect(settlement.verifyEntry(core, sig, m.pubkeyJwk)).toBe(true);
    // 篡改 → 验签失败
    expect(settlement.verifyEntry({ ...core, amount: 2 }, sig, m.pubkeyJwk)).toBe(false);
  });
});

describe("settlement-escrow desktop adapter — 完整流程 + core-multisig 门控", () => {
  let db, se, buyer, seller, custodian, genesis;

  beforeEach(() => {
    db = adaptSqlJsDb(new SQL.Database());
    genesis = adapter.naclIdentityToMember(makeDesktopIdentity("did:chainlesschain:genesis"));
    custodian = adapter.naclIdentityToMember(makeDesktopIdentity("did:chainlesschain:custodian"));
    buyer = adapter.naclIdentityToMember(makeDesktopIdentity("did:chainlesschain:buyer"));
    seller = adapter.naclIdentityToMember(makeDesktopIdentity("did:chainlesschain:seller"));

    // core-multisig 提案状态作为放款门控
    ms.applySchema(db);
    const msStore = ms.createStore(db);
    const mgr = ms.createProposalsManager(msStore);
    se = adapter.createSettlementEscrow({
      settlement, db, ledgerId: LEDGER_ID, genesis, custodian,
      proposalGate: (pid) => {
        const p = msStore.getProposal(pid);
        return { releasable: !!p && (p.state === "reached" || p.state === "consumed"), reason: p ? p.state : "not_found" };
      },
    });
    se.registerMember(buyer);
    se.registerMember(seller);
    se.grant({ to: buyer.did, amount: 1000 });
    se._mgr = mgr; // 测试用
  });

  it("买方押款 → multisig 未达阈放款被拦 → 达阈放款给卖方（守恒）", () => {
    expect(se.balanceOf(buyer.did)).toBe(1000);

    // 2-of-3 提案（买/卖/托管），买方发起
    const policy = {
      domain: "marketplace.knowledge.delivery", m: 2, n: 3,
      members: [buyer, seller, custodian].map((x) => ({ did: x.did, alg: x.alg, pubkeyJwk: x.pubkeyJwk })),
      requirePqc: false,
    };
    const proposed = se._mgr.propose({
      domain: policy.domain, payload: { tx: "t1", amount: "180" }, policy,
      initiator: { did: buyer.did, alg: buyer.alg, secretKey: buyer.secretKey },
    });
    const pid = proposed.proposal.id;

    // 买方用桌面 DID 密钥（seed）签押款转账
    const h = se.openHoldForTransaction({
      transactionId: "t1", buyer: buyer.did, seller: seller.did, amount: 180,
      proposalId: pid, buyerSecretKey: buyer.secretKey,
    });
    expect(h.ok).toBe(true);
    expect(se.balanceOf(buyer.did)).toBe(820);
    expect(se.balanceOf(custodian.did)).toBe(180);

    // 未达阈 → 放款被拦
    const early = se.release(h.holdId);
    expect(early.ok).toBe(false);
    expect(early.reason).toContain("proposal_not_releasable");
    expect(se.balanceOf(seller.did)).toBe(0);

    // 卖方第二签 → 达阈
    const signed = se._mgr.sign({ proposalId: pid, signer: { did: seller.did, alg: seller.alg, secretKey: seller.secretKey } });
    expect(signed.reachedThreshold).toBe(true);

    // 放款成功
    const r = se.release(h.holdId);
    expect(r.ok).toBe(true);
    expect(se.balanceOf(seller.did)).toBe(180);
    expect(se.balanceOf(custodian.did)).toBe(0);
    // 守恒
    expect(se.balanceOf(buyer.did) + se.balanceOf(seller.did) + se.balanceOf(custodian.did)).toBe(1000);
  });

  it("退款路径把 credits 退回买方", () => {
    const h = se.openHoldForTransaction({
      transactionId: "t2", buyer: buyer.did, seller: seller.did, amount: 200, buyerSecretKey: buyer.secretKey,
    });
    expect(h.ok).toBe(true);
    expect(se.balanceOf(buyer.did)).toBe(800);
    const r = se.refund(h.holdId);
    expect(r.ok).toBe(true);
    expect(se.balanceOf(buyer.did)).toBe(1000);
    expect(se.balanceOf(custodian.did)).toBe(0);
  });
});
