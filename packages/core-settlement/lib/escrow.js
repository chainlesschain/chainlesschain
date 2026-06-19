"use strict";

/**
 * P1 结算核 — 托管人驱动的 escrow（§3.2 + §8.2）。
 *
 * 多签是「授权层」、托管人是「结算层」：
 *  - openHold : 买方签名把 credits 转给 custodian（锁定），记一条 hold。
 *  - release  : 经 proposalGate（multisig 是否达阈/consume）门控，达标才由
 *               custodian 签名把 credits 转给 seller —— consume 即原子放款的
 *               货款侧（加密交付侧 P3 再接 held_wrapped_key）。
 *  - refund   : custodian 把 credits 退回买方。
 *  - 状态闸（held→released/refunded）防重复放款（double-settle）。
 *
 * proposalGate 注入 → 本模块不硬依赖 core-multisig（解耦）；P1 接线/测试把它
 * 接到 core-multisig 的 proposal 状态。
 */

const crypto = require("crypto");

const _deps = {
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
};

/**
 * @param {object} db
 * @param {object} ledger  - createLedger(...) 实例
 * @param {{custodianDid:string, custodianSecretKey:Buffer, proposalGate?:(proposalId:string)=>{releasable:boolean, reason?:string}}} opts
 */
function createEscrow(db, ledger, opts) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("createEscrow: db.prepare required");
  if (!ledger) throw new TypeError("createEscrow: ledger required");
  const custodianDid = opts && opts.custodianDid;
  const custodianSecretKey = opts && opts.custodianSecretKey;
  if (!custodianDid) throw new TypeError("createEscrow: custodianDid required");
  // 无 gate 时默认放行（非 multisig 流程）；P1 接 core-multisig。
  const proposalGate = (opts && opts.proposalGate) || (() => ({ releasable: true }));

  function _normHold(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      buyerDid: row.buyer_did,
      sellerDid: row.seller_did,
      amount: Number(row.amount),
      proposalId: row.proposal_id,
      status: row.status,
      fundEntryId: row.fund_entry_id,
      settleEntryId: row.settle_entry_id,
    };
  }

  function getHold(holdId) {
    return _normHold(db.prepare(`SELECT * FROM escrow_holds WHERE id = ?`).get(holdId));
  }

  /**
   * 买方押款入托管。fund = 买方对 buyer→custodian 转账的签名 {nonce, alg, sig}。
   */
  function openHold({ orderId, buyer, seller, amount, proposalId, fund }) {
    const r = ledger.transfer({ from: buyer, to: custodianDid, amount, nonce: fund.nonce, alg: fund.alg, sig: fund.sig });
    if (!r.ok) return { ok: false, reason: "fund_failed:" + r.reason };
    const id = _deps.newId();
    db.prepare(
      `INSERT INTO escrow_holds(id, order_id, buyer_did, seller_did, amount, proposal_id, status, fund_entry_id, created_at_ms)
       VALUES(?,?,?,?,?,?, 'held', ?, ?)`,
    ).run(id, orderId, buyer, seller, amount, proposalId == null ? null : proposalId, r.entryId, _deps.now());
    return { ok: true, holdId: id, fundEntryId: r.entryId };
  }

  /** 经 multisig 门控放款给卖方。状态闸防 double-settle。 */
  function release(holdId) {
    const hold = getHold(holdId);
    if (!hold) return { ok: false, reason: "hold_not_found" };
    if (hold.status !== "held") return { ok: false, reason: "hold_state_" + hold.status };
    const gate = proposalGate(hold.proposalId);
    if (!gate || !gate.releasable) return { ok: false, reason: "proposal_not_releasable" + (gate && gate.reason ? ":" + gate.reason : "") };
    const r = ledger.signAndTransfer({ from: custodianDid, to: hold.sellerDid, amount: hold.amount, secretKey: custodianSecretKey });
    if (!r.ok) return { ok: false, reason: "settle_failed:" + r.reason };
    db.prepare(`UPDATE escrow_holds SET status='released', settle_entry_id=?, settled_at_ms=? WHERE id=?`).run(r.entryId, _deps.now(), holdId);
    return { ok: true, entryId: r.entryId };
  }

  /** 退款给买方（交付失败/超时/争议判退）。状态闸防重复。 */
  function refund(holdId) {
    const hold = getHold(holdId);
    if (!hold) return { ok: false, reason: "hold_not_found" };
    if (hold.status !== "held") return { ok: false, reason: "hold_state_" + hold.status };
    const r = ledger.signAndTransfer({ from: custodianDid, to: hold.buyerDid, amount: hold.amount, secretKey: custodianSecretKey });
    if (!r.ok) return { ok: false, reason: "refund_failed:" + r.reason };
    db.prepare(`UPDATE escrow_holds SET status='refunded', settle_entry_id=?, settled_at_ms=? WHERE id=?`).run(r.entryId, _deps.now(), holdId);
    return { ok: true, entryId: r.entryId };
  }

  return { custodianDid, getHold, openHold, release, refund };
}

module.exports = { createEscrow, _deps };
