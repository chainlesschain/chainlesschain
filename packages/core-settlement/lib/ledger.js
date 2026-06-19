"use strict";

/**
 * P1 结算核 — 联邦签名转账日志账本（§8.2 决策落地）。
 *
 * 核心性质：账本不存「可写余额表」，存「只追加的签名转账日志」。
 *  - 余额 = fold(日志)：balanceOf = Σ(到账) − Σ(出账)
 *  - 每笔 transfer 由付款方签名；mint（grant）只由 genesis 签名 → 节点无有效
 *    签名伪造不了转账、也凭空印不了钱（修正 v1.3「节点=央行」漏洞）。
 *  - 全局哈希链（entry_hash = sha256(canonical || prev_hash)）→ 重排/插入可检测。
 *  - 守恒：Σ 全体余额 == totalMinted（mint 是唯一增发源，由 genesis 规则约束）。
 *
 * DB 无关：接受 better-sqlite3(-multiple-ciphers) 或 sql.js（同 prepare/run/get/all）。
 */

const crypto = require("crypto");
const { canonicalizeEntry, signEntry, verifyEntry } = require("./signing.js");

const _deps = {
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  newNonce: () => crypto.randomBytes(12).toString("hex"),
};

function entryHash(canonicalBuf, prevHashHex) {
  const h = crypto.createHash("sha256").update(canonicalBuf);
  if (prevHashHex) h.update(Buffer.from(prevHashHex, "hex"));
  return h.digest("hex");
}

/**
 * @param {object} db   - SQLite-like handle（applySchema 已跑过）
 * @param {{ledgerId:string, genesisDid:string}} opts
 */
function createLedger(db, opts) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("createLedger: db.prepare is required");
  }
  const ledgerId = opts && opts.ledgerId;
  const genesisDid = opts && opts.genesisDid;
  if (!ledgerId) throw new TypeError("createLedger: ledgerId required");
  if (!genesisDid) throw new TypeError("createLedger: genesisDid required");

  function registerMember({ did, alg, pubkeyJwk }) {
    db.prepare(
      `INSERT OR REPLACE INTO settlement_members(did, alg, pubkey_jwk) VALUES(?,?,?)`,
    ).run(did, alg, JSON.stringify(pubkeyJwk));
  }

  function getMember(did) {
    const row = db
      .prepare(`SELECT did, alg, pubkey_jwk FROM settlement_members WHERE did = ?`)
      .get(did);
    if (!row) return null;
    return { did: row.did, alg: row.alg, pubkeyJwk: JSON.parse(row.pubkey_jwk) };
  }

  // 所有读/链查询都按 ledger_id 隔离：一个 DB 可托管多个联邦账本（schema 每条
  // 都带 ledger_id），balanceOf/totalMinted/head/verifyChain/nonceUsed 必须只看
  // 本账本的条目，否则多账本共享 DB 时余额会串、哈希链会交织。
  function head() {
    const row = db
      .prepare(`SELECT entry_hash FROM ledger_entries WHERE ledger_id = ? ORDER BY seq DESC LIMIT 1`)
      .get(ledgerId);
    return row ? row.entry_hash : null;
  }

  function balanceOf(did) {
    const inc = Number(
      db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE ledger_id = ? AND to_did = ?`).get(ledgerId, did).s,
    );
    const dec = Number(
      db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE ledger_id = ? AND from_did = ?`).get(ledgerId, did).s,
    );
    return inc - dec;
  }

  function totalMinted() {
    return Number(
      db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE ledger_id = ? AND kind = 'mint'`).get(ledgerId).s,
    );
  }

  // nonce 唯一性按 (ledger_id, signer_did) 作用域：同一签名者在不同账本复用同一
  // nonce 不是重放（签名 core 含 ledgerId → 字节不同），故不应跨账本误拦。
  function nonceUsed(signerDid, nonce) {
    return !!db
      .prepare(`SELECT 1 FROM ledger_entries WHERE ledger_id = ? AND signer_did = ? AND nonce = ? LIMIT 1`)
      .get(ledgerId, signerDid, nonce);
  }

  function _append({ kind, from, to, amount, nonce, alg, sig, signerDid }) {
    const core = { ledgerId, kind, from: from == null ? null : from, to, amount, nonce };
    const prev = head();
    const eh = entryHash(canonicalizeEntry(core), prev);
    const id = _deps.newId();
    db.prepare(
      `INSERT INTO ledger_entries(entry_id, ledger_id, kind, from_did, to_did, amount, nonce, prev_hash, entry_hash, signer_did, alg, sig, created_at_ms)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, ledgerId, kind, from == null ? null : from, to, amount, nonce, prev, eh, signerDid, alg, sig, _deps.now());
    return { entryId: id, entryHash: eh };
  }

  /** mint（grant）— 仅 genesis 可，外部已签 sig 由 genesis 公钥验。 */
  function mint({ to, amount, nonce, sig }) {
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "invalid_amount" };
    const gm = getMember(genesisDid);
    if (!gm) return { ok: false, reason: "genesis_not_registered" };
    if (nonceUsed(genesisDid, nonce)) return { ok: false, reason: "nonce_reused" };
    const core = { ledgerId, kind: "mint", from: null, to, amount, nonce };
    if (!verifyEntry(core, sig, gm.pubkeyJwk)) return { ok: false, reason: "bad_genesis_sig" };
    return { ok: true, ..._append({ kind: "mint", from: null, to, amount, nonce, alg: gm.alg, sig, signerDid: genesisDid }) };
  }

  /** transfer — 外部已签（付款方），验签 + nonce + 余额 后追加。 */
  function transfer({ from, to, amount, nonce, alg, sig }) {
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "invalid_amount" };
    if (from === to) return { ok: false, reason: "self_transfer" };
    const fm = getMember(from);
    if (!fm) return { ok: false, reason: "unknown_payer" };
    if (alg && fm.alg !== alg) return { ok: false, reason: "alg_mismatch" };
    if (nonceUsed(from, nonce)) return { ok: false, reason: "nonce_reused" };
    const core = { ledgerId, kind: "transfer", from, to, amount, nonce };
    if (!verifyEntry(core, sig, fm.pubkeyJwk)) return { ok: false, reason: "bad_sig" };
    if (balanceOf(from) < amount) return { ok: false, reason: "insufficient_funds" };
    return { ok: true, ..._append({ kind: "transfer", from, to, amount, nonce, alg: fm.alg, sig, signerDid: from }) };
  }

  /** 便利：本地持密钥者（custodian / 测试）签名并转账。 */
  function signAndTransfer({ from, to, amount, secretKey, nonce }) {
    const m = getMember(from);
    if (!m) return { ok: false, reason: "unknown_payer" };
    const n = nonce || _deps.newNonce();
    const core = { ledgerId, kind: "transfer", from, to, amount, nonce: n };
    const sig = signEntry(core, secretKey);
    return transfer({ from, to, amount, nonce: n, alg: m.alg, sig });
  }

  /** 便利：genesis 签名并 mint。 */
  function signAndMint({ to, amount, secretKey, nonce }) {
    const n = nonce || _deps.newNonce();
    const core = { ledgerId, kind: "mint", from: null, to, amount, nonce: n };
    const sig = signEntry(core, secretKey);
    return mint({ to, amount, nonce: n, sig });
  }

  /**
   * 全链复算 = 完整再校验「写入路径强制的每条不变量」，不只是哈希+签名。这样即使
   * 有节点/成员合谋绕过 mint()/transfer() 直接 INSERT well-formed 行，再验也能识破
   * （支撑设计「节点伪造不了转账、印不了钱」的核心安全声明）：
   *   1) 哈希链续接 + entry_hash 自洽（重排/插入/改值可检测）
   *   2) 金额必须正整数（防注入 amount<=0 / 非整数 偷钱）
   *   3) 授权规则：mint 必由 genesis 签且无 from；transfer 的 signer 必等于 from、
   *      不可自转（防越权增发 / 冒名转账）
   *   4) 签名对（signer 注册公钥验 core）
   *   5) 经济守恒：按 seq 折叠余额，任一时刻 from 余额不足即拦（防注入透支花钱）
   */
  function verifyChain() {
    const rows = db.prepare(`SELECT * FROM ledger_entries WHERE ledger_id = ? ORDER BY seq ASC`).all(ledgerId);
    let prev = null;
    const bal = new Map();
    const get = (d) => bal.get(d) || 0;
    for (const row of rows) {
      const from = row.from_did == null ? null : row.from_did;
      const amount = Number(row.amount);
      const core = { ledgerId: row.ledger_id, kind: row.kind, from, to: row.to_did, amount, nonce: row.nonce };
      // 1) 链接续 + 哈希自洽
      if ((row.prev_hash || null) !== (prev || null)) return { ok: false, reason: "chain_break", at: row.entry_id };
      if (entryHash(canonicalizeEntry(core), prev) !== row.entry_hash) return { ok: false, reason: "hash_mismatch", at: row.entry_id };
      // 2) 金额正整数
      if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "invalid_amount", at: row.entry_id };
      // 3) 授权规则
      if (core.kind === "mint") {
        if (from !== null) return { ok: false, reason: "mint_has_from", at: row.entry_id };
        if (row.signer_did !== genesisDid) return { ok: false, reason: "mint_not_by_genesis", at: row.entry_id };
      } else if (core.kind === "transfer") {
        if (from == null) return { ok: false, reason: "transfer_missing_from", at: row.entry_id };
        if (from === core.to) return { ok: false, reason: "self_transfer", at: row.entry_id };
        if (row.signer_did !== from) return { ok: false, reason: "transfer_signer_mismatch", at: row.entry_id };
      } else {
        return { ok: false, reason: "unknown_kind", at: row.entry_id };
      }
      // 4) 签名对
      const member = getMember(row.signer_did);
      if (!member || !verifyEntry(core, row.sig, member.pubkeyJwk)) return { ok: false, reason: "bad_sig", at: row.entry_id };
      // 5) 经济守恒：余额折叠（mint 增发到 to；transfer 必须 from 余额充足）
      if (core.kind === "transfer") {
        if (get(from) < amount) return { ok: false, reason: "insufficient_funds", at: row.entry_id };
        bal.set(from, get(from) - amount);
      }
      bal.set(core.to, get(core.to) + amount);
      prev = row.entry_hash;
    }
    return { ok: true, count: rows.length };
  }

  return {
    ledgerId,
    genesisDid,
    registerMember,
    getMember,
    mint,
    transfer,
    signAndTransfer,
    signAndMint,
    balanceOf,
    totalMinted,
    head,
    verifyChain,
  };
}

module.exports = { createLedger, _deps };
