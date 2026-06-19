import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { createLedger } = require("../lib/ledger.js");
const { createEscrow } = require("../lib/escrow.js");
const { signEntry } = require("../lib/signing.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const { makeMember } = require("./helpers/fixtures.js");

// 真实承重墙：把 escrow 的 proposalGate 接到 core-multisig 的提案状态
const ms = require("@chainlesschain/core-multisig");

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

const LEDGER_ID = "fed-1";

function fundedSetup() {
  const db = adaptSqlJsDb(new SQL.Database());
  applySchema(db); // 结算核 schema
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

// 买方对 buyer→custodian 转账的签名（外部签名 → openHold 的 fund）
function buyerFund(buyer, custodianDid, amount, nonce) {
  const core = { ledgerId: LEDGER_ID, kind: "transfer", from: buyer.did, to: custodianDid, amount, nonce };
  return { nonce, alg: buyer.alg, sig: signEntry(core, buyer.secretKey) };
}

describe("escrow — custodian-driven, default gate", () => {
  let ctx;
  beforeEach(() => {
    ctx = fundedSetup();
  });

  it("openHold locks buyer credits into custodian", () => {
    const { db, ledger, buyer, seller, custodian } = ctx;
    const escrow = createEscrow(db, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });
    const h = escrow.openHold({ orderId: "o1", buyer: buyer.did, seller: seller.did, amount: 180, fund: buyerFund(buyer, custodian.did, 180, "n1") });
    expect(h.ok).toBe(true);
    expect(ledger.balanceOf(buyer.did)).toBe(820);
    expect(ledger.balanceOf(custodian.did)).toBe(180);
    expect(escrow.getHold(h.holdId).status).toBe("held");
  });

  it("release pays seller; double-release is blocked", () => {
    const { db, ledger, buyer, seller, custodian } = ctx;
    const escrow = createEscrow(db, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });
    const h = escrow.openHold({ orderId: "o1", buyer: buyer.did, seller: seller.did, amount: 180, fund: buyerFund(buyer, custodian.did, 180, "n1") });
    const r = escrow.release(h.holdId);
    expect(r.ok).toBe(true);
    expect(ledger.balanceOf(seller.did)).toBe(180);
    expect(ledger.balanceOf(custodian.did)).toBe(0);
    expect(escrow.getHold(h.holdId).status).toBe("released");
    // 重复放款被状态闸拦
    const again = escrow.release(h.holdId);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe("hold_state_released");
    // 守恒：总额未变
    expect(ledger.balanceOf(buyer.did) + ledger.balanceOf(seller.did) + ledger.balanceOf(custodian.did)).toBe(ledger.totalMinted());
  });

  it("refund returns credits to buyer", () => {
    const { db, ledger, buyer, seller, custodian } = ctx;
    const escrow = createEscrow(db, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey });
    const h = escrow.openHold({ orderId: "o1", buyer: buyer.did, seller: seller.did, amount: 180, fund: buyerFund(buyer, custodian.did, 180, "n1") });
    const r = escrow.refund(h.holdId);
    expect(r.ok).toBe(true);
    expect(ledger.balanceOf(buyer.did)).toBe(1000);
    expect(ledger.balanceOf(custodian.did)).toBe(0);
    expect(escrow.getHold(h.holdId).status).toBe("refunded");
  });
});

describe("escrow — gated by core-multisig (the P1 settlement seam)", () => {
  it("release is blocked until the 2-of-3 multisig proposal reaches threshold", () => {
    const { db, ledger, buyer, seller, custodian } = fundedSetup();

    // 同一个 db 上叠加 core-multisig schema + 提案
    ms.applySchema(db);
    const msStore = ms.createStore(db);
    const mgr = ms.createProposalsManager(msStore);

    // 2-of-3 policy：买/卖/托管人（托管人作仲裁/必需签名之一）
    const policy = {
      domain: "marketplace.knowledge.delivery",
      m: 2,
      n: 3,
      members: [buyer, seller, custodian].map((x) => ({ did: x.did, alg: x.alg, pubkeyJwk: x.pubkeyJwk })),
      requirePqc: false,
    };
    const proposed = mgr.propose({
      domain: policy.domain,
      payload: { order_id: "o1", asset_id: "a1", amount: "180", buyer: buyer.did, seller: seller.did },
      policy,
      initiator: { did: buyer.did, alg: buyer.alg, secretKey: buyer.secretKey },
    });
    const proposalId = proposed.proposal.id;
    expect(proposed.reachedThreshold).toBe(false); // 仅 1 签

    // gate 接到 multisig 提案状态
    const proposalGate = (pid) => {
      const p = msStore.getProposal(pid);
      return { releasable: !!p && (p.state === "reached" || p.state === "consumed"), reason: p ? p.state : "not_found" };
    };
    const escrow = createEscrow(db, ledger, { custodianDid: custodian.did, custodianSecretKey: custodian.secretKey, proposalGate });

    const h = escrow.openHold({ orderId: "o1", buyer: buyer.did, seller: seller.did, amount: 180, proposalId, fund: buyerFund(buyer, custodian.did, 180, "n1") });
    expect(h.ok).toBe(true);

    // 阈值未达 → 放款被拦
    const early = escrow.release(h.holdId);
    expect(early.ok).toBe(false);
    expect(early.reason).toContain("proposal_not_releasable");
    expect(ledger.balanceOf(seller.did)).toBe(0); // 卖方未收到

    // 第二签 → 2-of-3 达阈
    const signed = mgr.sign({ proposalId, signer: { did: seller.did, alg: seller.alg, secretKey: seller.secretKey } });
    expect(signed.reachedThreshold).toBe(true);
    expect(msStore.getProposal(proposalId).state).toBe("reached");

    // 现在放款成功
    const r = escrow.release(h.holdId);
    expect(r.ok).toBe(true);
    expect(ledger.balanceOf(seller.did)).toBe(180);
    expect(ledger.balanceOf(custodian.did)).toBe(0);
    // 守恒
    expect(ledger.balanceOf(buyer.did) + ledger.balanceOf(seller.did) + ledger.balanceOf(custodian.did)).toBe(ledger.totalMinted());
  });
});
