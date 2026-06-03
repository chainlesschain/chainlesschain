"use strict";

/**
 * v1.2 m-of-n Phase 1a — SQLite schema for multisig_proposals + multisig_signatures
 *                        + multisig_policies。
 *
 * 设计文档 §4：
 *   - multisig_proposals(id, domain, payload_jcs, payload_hash, nonce,
 *     expires_at_ms, threshold_m, member_set, state, initiator_did,
 *     created_at_ms, updated_at_ms)
 *   - multisig_signatures(proposal_id, signer_did, sig, alg, signed_at_ms)
 *   - multisig_policies(domain, policy_json, updated_at_ms)
 *
 * idempotent: 用 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS。
 * 兼容 better-sqlite3 + sql.js (Database.exec signature 都接 SQL string)。
 */

const DDL = `
CREATE TABLE IF NOT EXISTS multisig_proposals (
    id              TEXT    PRIMARY KEY,
    domain          TEXT    NOT NULL,
    payload_jcs     TEXT    NOT NULL,
    payload_hash    BLOB    NOT NULL,
    nonce           TEXT    NOT NULL,
    expires_at_ms   INTEGER NOT NULL,
    threshold_m     INTEGER NOT NULL,
    member_set      TEXT    NOT NULL,
    state           TEXT    NOT NULL CHECK(state IN ('pending', 'reached', 'consumed', 'cancelled', 'expired')),
    initiator_did   TEXT    NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS multisig_signatures (
    proposal_id     TEXT    NOT NULL,
    signer_did      TEXT    NOT NULL,
    sig             BLOB    NOT NULL,
    alg             TEXT    NOT NULL,
    signed_at_ms    INTEGER NOT NULL,
    PRIMARY KEY (proposal_id, signer_did),
    FOREIGN KEY (proposal_id) REFERENCES multisig_proposals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS multisig_policies (
    domain          TEXT    PRIMARY KEY,
    policy_json     TEXT    NOT NULL,
    updated_at_ms   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_multisig_state ON multisig_proposals(state, expires_at_ms);
CREATE INDEX IF NOT EXISTS idx_multisig_domain ON multisig_proposals(domain, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_multisig_sigs_proposal ON multisig_signatures(proposal_id);
`;

/**
 * 在传入的 SQLite-like DB 上跑 DDL。兼容 better-sqlite3 (`db.exec`) 与 sql.js
 * (`db.exec`) — 两者都接受多语句 SQL string。
 */
function applySchema(db) {
  if (!db || typeof db.exec !== "function") {
    throw new TypeError("applySchema: db.exec is required (better-sqlite3 or sql.js)");
  }
  db.exec(DDL);
}

module.exports = { DDL, applySchema };
