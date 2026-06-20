"use strict";

/**
 * v1.2 m-of-n Phase 1c — SQLite store wrapper。
 *
 * 抽象出读/写接口让 proposals.js 走 store 而不直接抓 DB；测试可注 in-memory store
 * 实现绕开 sql.js / better-sqlite3。
 *
 * 实际 SQL 直接构造，PRAGMA foreign_keys 由 caller 启用（避免 store 与 DB lifecycle
 * 耦合）。
 *
 * Compat: 接受 better-sqlite3 (sync `prepare(...).run(...)`) 或 sql.js 同 API。
 */

/**
 * @typedef {Object} StoredProposal
 * @property {string} id
 * @property {string} domain
 * @property {string} payloadJcs
 * @property {Buffer} payloadHash
 * @property {string} nonce
 * @property {number} expiresAtMs
 * @property {number} thresholdM
 * @property {Array}  memberSet
 * @property {boolean} requirePqc      - snapshot of policy.requirePqc (≥1 PQC sig required to reach)
 * @property {string} state            - 'pending' | 'reached' | 'consumed' | 'cancelled' | 'expired'
 * @property {string} initiatorDid
 * @property {number} createdAtMs
 * @property {number} updatedAtMs
 *
 * @typedef {Object} StoredSignature
 * @property {string} proposalId
 * @property {string} signerDid
 * @property {Buffer} sig
 * @property {string} alg
 * @property {number} signedAtMs
 */

/**
 * 把 SQLite row 转回 native 类型（JSON parse memberSet，确保 payloadHash 是 Buffer）。
 */
function _rowToProposal(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    payloadJcs: row.payload_jcs,
    payloadHash: Buffer.isBuffer(row.payload_hash)
      ? row.payload_hash
      : Buffer.from(row.payload_hash),
    nonce: row.nonce,
    expiresAtMs: Number(row.expires_at_ms),
    thresholdM: Number(row.threshold_m),
    memberSet: JSON.parse(row.member_set),
    requirePqc: Boolean(row.require_pqc),
    state: row.state,
    initiatorDid: row.initiator_did,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function _rowToSignature(row) {
  return {
    proposalId: row.proposal_id,
    signerDid: row.signer_did,
    sig: Buffer.isBuffer(row.sig) ? row.sig : Buffer.from(row.sig),
    alg: row.alg,
    signedAtMs: Number(row.signed_at_ms),
  };
}

/**
 * @param {object} db  - better-sqlite3 Database (or sql.js Database adapted with same API)
 */
function createStore(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("createStore: db.prepare is required");
  }

  return {
    insertProposal(p) {
      db.prepare(
        `INSERT INTO multisig_proposals
         (id, domain, payload_jcs, payload_hash, nonce, expires_at_ms,
          threshold_m, member_set, require_pqc, state, initiator_did, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.id,
        p.domain,
        p.payloadJcs,
        p.payloadHash,
        p.nonce,
        p.expiresAtMs,
        p.thresholdM,
        JSON.stringify(p.memberSet),
        p.requirePqc ? 1 : 0,
        p.state,
        p.initiatorDid,
        p.createdAtMs,
        p.updatedAtMs,
      );
    },

    getProposal(id) {
      const row = db.prepare(`SELECT * FROM multisig_proposals WHERE id = ?`).get(id);
      return _rowToProposal(row);
    },

    /**
     * @param {object} filter - { state?: string, domain?: string, limit?: number }
     */
    listProposals(filter = {}) {
      const wheres = [];
      const params = [];
      if (filter.state) {
        wheres.push("state = ?");
        params.push(filter.state);
      }
      if (filter.domain) {
        wheres.push("domain = ?");
        params.push(filter.domain);
      }
      const whereSql = wheres.length > 0 ? "WHERE " + wheres.join(" AND ") : "";
      const limit = Number.isInteger(filter.limit) ? filter.limit : 100;
      const rows = db
        .prepare(
          `SELECT * FROM multisig_proposals ${whereSql} ORDER BY created_at_ms DESC LIMIT ${limit}`,
        )
        .all(...params);
      return rows.map(_rowToProposal);
    },

    updateProposalState(id, state, nowMs) {
      const stmt = db.prepare(
        `UPDATE multisig_proposals SET state = ?, updated_at_ms = ? WHERE id = ?`,
      );
      const result = stmt.run(state, nowMs, id);
      return result.changes > 0;
    },

    insertSignature(s) {
      db.prepare(
        `INSERT INTO multisig_signatures
         (proposal_id, signer_did, sig, alg, signed_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(s.proposalId, s.signerDid, s.sig, s.alg, s.signedAtMs);
    },

    getSignatures(proposalId) {
      const rows = db
        .prepare(
          `SELECT * FROM multisig_signatures WHERE proposal_id = ? ORDER BY signer_did ASC`,
        )
        .all(proposalId);
      return rows.map(_rowToSignature);
    },

    hasSignature(proposalId, signerDid) {
      const row = db
        .prepare(
          `SELECT 1 FROM multisig_signatures WHERE proposal_id = ? AND signer_did = ?`,
        )
        .get(proposalId, signerDid);
      return !!row;
    },

    setPolicy(domain, policyJson, nowMs) {
      db.prepare(
        `INSERT INTO multisig_policies (domain, policy_json, updated_at_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET
           policy_json = excluded.policy_json,
           updated_at_ms = excluded.updated_at_ms`,
      ).run(domain, policyJson, nowMs);
    },

    getPolicy(domain) {
      const row = db
        .prepare(`SELECT policy_json FROM multisig_policies WHERE domain = ?`)
        .get(domain);
      if (!row) return null;
      return JSON.parse(row.policy_json);
    },

    listPolicies() {
      const rows = db.prepare(`SELECT * FROM multisig_policies`).all();
      return rows.map((r) => ({
        domain: r.domain,
        policy: JSON.parse(r.policy_json),
        updatedAtMs: Number(r.updated_at_ms),
      }));
    },

    /** sweeper：把 expires_at_ms < now 且 state='pending' 的标 'expired'，返条数 */
    expireStale(nowMs) {
      const stmt = db.prepare(
        `UPDATE multisig_proposals
         SET state = 'expired', updated_at_ms = ?
         WHERE state = 'pending' AND expires_at_ms < ?`,
      );
      const result = stmt.run(nowMs, nowMs);
      return result.changes;
    },
  };
}

module.exports = { createStore, _rowToProposal, _rowToSignature };
