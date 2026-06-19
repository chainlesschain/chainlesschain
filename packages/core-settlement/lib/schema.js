"use strict";

/**
 * P1 结算核 — SQLite schema。兼容 better-sqlite3(-multiple-ciphers) + sql.js
 * （`db.exec` 都接多语句 SQL string），与 core-multisig 同款 DB 无关风格。
 *
 * 三表：
 *  - settlement_members : did → 公钥（验转账签名用；did↔pubkey 绑定由 DID 层建立）
 *  - ledger_entries     : 只追加签名转账日志（余额 = fold(log)，无可写余额表）
 *  - escrow_holds       : 托管人持有（buyer→custodian 锁定，consume 时 →seller）
 */

const DDL = `
CREATE TABLE IF NOT EXISTS settlement_members (
  did        TEXT PRIMARY KEY,
  alg        TEXT NOT NULL,
  pubkey_jwk TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      TEXT UNIQUE NOT NULL,
  ledger_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,          -- 'mint' | 'transfer'
  from_did      TEXT,                   -- NULL for mint
  to_did        TEXT NOT NULL,
  amount        INTEGER NOT NULL,       -- credits, integer > 0
  nonce         TEXT NOT NULL,
  prev_hash     TEXT,                   -- 前一条 entry_hash（全局哈希链）
  entry_hash    TEXT NOT NULL,          -- sha256(canonical || prev_hash)
  signer_did    TEXT NOT NULL,          -- transfer=from / mint=genesis
  alg           TEXT NOT NULL,
  sig           BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_from ON ledger_entries(from_did);
CREATE INDEX IF NOT EXISTS idx_ledger_to   ON ledger_entries(to_did);
-- 同一账本内同一签名者 nonce 唯一 → 防重放（transfer 与 mint 都覆盖）。
-- 含 ledger_id：跨账本同 nonce 不是重放（签名 core 含 ledgerId），不应误拦。
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_signer_nonce ON ledger_entries(ledger_id, signer_did, nonce);

CREATE TABLE IF NOT EXISTS escrow_holds (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL,
  buyer_did      TEXT NOT NULL,
  seller_did     TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  proposal_id    TEXT,                  -- settlement_ref → multisig 提案
  status         TEXT NOT NULL DEFAULT 'held',  -- held | released | refunded
  fund_entry_id  TEXT,                  -- buyer→custodian 的 ledger 条目
  settle_entry_id TEXT,                 -- custodian→seller/buyer 的 ledger 条目
  created_at_ms  INTEGER NOT NULL,
  settled_at_ms  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_holds_status ON escrow_holds(status);
CREATE INDEX IF NOT EXISTS idx_holds_proposal ON escrow_holds(proposal_id);
`;

function applySchema(db) {
  if (!db || typeof db.exec !== "function") {
    throw new TypeError("applySchema: db.exec is required (better-sqlite3 or sql.js)");
  }
  db.exec(DDL);
}

module.exports = { DDL, applySchema };
