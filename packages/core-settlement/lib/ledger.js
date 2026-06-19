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

  function head() {
    const row = db
      .prepare(`SELECT entry_hash FROM ledger_entries ORDER BY seq DESC LIMIT 1`)
      .get();
    return row ? row.entry_hash : null;
  }

  function balanceOf(did) {
    const inc = Number(
      db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE to_did = ?`).get(did).s,
    );
    const dec = Number(
      db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE from_did = ?`).get(did).s,
    );
    return inc - dec;
  }

  function totalMinted() {
    return Number(
      db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE kind = 'mint'`).get().s,
    );
  }

  function nonceUsed(signerDid, nonce) {
    return !!db
      .prepare(`SELECT 1 FROM ledger_entries WHERE signer_did = ? AND nonce = ? LIMIT 1`)
      .get(signerDid, nonce);
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

  /** 全链复算：链接续 + entry_hash + 每条签名都对 → 篡改可检测。 */
  function verifyChain() {
    const rows = db.prepare(`SELECT * FROM ledger_entries ORDER BY seq ASC`).all();
    let prev = null;
    for (const row of rows) {
      const core = {
        ledgerId: row.ledger_id,
        kind: row.kind,
        from: row.from_did == null ? null : row.from_did,
        to: row.to_did,
        amount: Number(row.amount),
        nonce: row.nonce,
      };
      if ((row.prev_hash || null) !== (prev || null)) return { ok: false, reason: "chain_break", at: row.entry_id };
      if (entryHash(canonicalizeEntry(core), prev) !== row.entry_hash) return { ok: false, reason: "hash_mismatch", at: row.entry_id };
      const member = getMember(row.signer_did);
      if (!member || !verifyEntry(core, row.sig, member.pubkeyJwk)) return { ok: false, reason: "bad_sig", at: row.entry_id };
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
