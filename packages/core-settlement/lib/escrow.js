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

  // 原子性：每个写操作都做「转账 + 状态写」两步，必须同生共死，否则部分失败会留下
  // 危险中间态——例如 release 已把货款转给卖方但 status 没翻 'released'，重试就**重复
  // 放款**（double-settle）。用 SAVEPOINT 包裹（better-sqlite3 与 sql.js 都支持完整
  // SQLite SQL，可嵌套在调用方事务内）：抛错则 ROLLBACK TO 把转账一并撤回，可安全重试。
  function _atomic(label, fn) {
    db.exec(`SAVEPOINT ${label}`);
    try {
      const out = fn();
      db.exec(`RELEASE ${label}`);
      return out;
    } catch (e) {
      try {
        db.exec(`ROLLBACK TO ${label}`);
        db.exec(`RELEASE ${label}`);
      } catch (_e) {
        /* best-effort：清理失败也不掩盖原始错误 */
      }
      return { ok: false, reason: "tx_failed:" + (e && e.message ? e.message : "error") };
    }
  }

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
    return _atomic("cc_escrow_open", () => {
      const r = ledger.transfer({ from: buyer, to: custodianDid, amount, nonce: fund.nonce, alg: fund.alg, sig: fund.sig });
      if (!r.ok) return { ok: false, reason: "fund_failed:" + r.reason };
      const id = _deps.newId();
      db.prepare(
        `INSERT INTO escrow_holds(id, order_id, buyer_did, seller_did, amount, proposal_id, status, fund_entry_id, created_at_ms)
         VALUES(?,?,?,?,?,?, 'held', ?, ?)`,
      ).run(id, orderId, buyer, seller, amount, proposalId == null ? null : proposalId, r.entryId, _deps.now());
      return { ok: true, holdId: id, fundEntryId: r.entryId };
    });
  }

  /** 经 multisig 门控放款给卖方。状态闸防 double-settle。 */
  function release(holdId) {
    const hold = getHold(holdId);
    if (!hold) return { ok: false, reason: "hold_not_found" };
    if (hold.status !== "held") return { ok: false, reason: "hold_state_" + hold.status };
    const gate = proposalGate(hold.proposalId);
    if (!gate || !gate.releasable) return { ok: false, reason: "proposal_not_releasable" + (gate && gate.reason ? ":" + gate.reason : "") };
    return _atomic("cc_escrow_release", () => {
      const r = ledger.signAndTransfer({ from: custodianDid, to: hold.sellerDid, amount: hold.amount, secretKey: custodianSecretKey });
      if (!r.ok) return { ok: false, reason: "settle_failed:" + r.reason };
      // 条件 UPDATE = 状态闸的 CAS：仅当行仍是 'held' 才翻 'released'。上面那次
      // hold.status 检查发生在事务外（getHold），多连接下两个 release/refund 可能
      // 都读到 'held' 各自放款 → double-settle；且当 custodian 为多笔 hold 共持
      // 资金时，ledger 的余额检查挡不住（第二次放款会盗用其它 hold 的押款）。
      // 若 0 行被改 = 竞态输家：抛错让 _atomic ROLLBACK TO 把本次转账一并撤回。
      const upd = db.prepare(`UPDATE escrow_holds SET status='released', settle_entry_id=?, settled_at_ms=? WHERE id=? AND status='held'`).run(r.entryId, _deps.now(), holdId);
      if (upd.changes !== 1) throw new Error("hold_no_longer_held");
      return { ok: true, entryId: r.entryId };
    });
  }

  /** 退款给买方（交付失败/超时/争议判退）。状态闸防重复。 */
  function refund(holdId) {
    const hold = getHold(holdId);
    if (!hold) return { ok: false, reason: "hold_not_found" };
    if (hold.status !== "held") return { ok: false, reason: "hold_state_" + hold.status };
    return _atomic("cc_escrow_refund", () => {
      const r = ledger.signAndTransfer({ from: custodianDid, to: hold.buyerDid, amount: hold.amount, secretKey: custodianSecretKey });
      if (!r.ok) return { ok: false, reason: "refund_failed:" + r.reason };
      // 同 release：条件 UPDATE 把状态闸做成 CAS，防多连接 TOCTOU 重复结算（见上）。
      const upd = db.prepare(`UPDATE escrow_holds SET status='refunded', settle_entry_id=?, settled_at_ms=? WHERE id=? AND status='held'`).run(r.entryId, _deps.now(), holdId);
      if (upd.changes !== 1) throw new Error("hold_no_longer_held");
      return { ok: true, entryId: r.entryId };
    });
  }

  return { custodianDid, getHold, openHold, release, refund };
}

module.exports = { createEscrow, _deps };
