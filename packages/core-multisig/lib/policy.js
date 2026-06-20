"use strict";

/**
 * v1.2 m-of-n Phase 1a — Policy types.
 *
 * 设计文档 docs/design/MofN_多签_应用扩展_v1.md §2-3：每个 domain 配一份策略，
 * 决定参与签名者集合 + threshold M + 允许算法。
 *
 * @typedef {Object} MultiSigMember
 * @property {string} did        - did:cc:xxx 标识，verify 时按此查 pubkey
 * @property {string} alg        - "Ed25519" | "SLH-DSA-SHA2-128F"
 * @property {Object} pubkeyJwk  - JWK 公钥（结构与 core-mtc/signers/*.js 一致）
 *
 * @typedef {Object} MultiSigPolicy
 * @property {string}            domain        - "marketplace.purchase" | "did.rotate" | ...
 * @property {number}            m             - threshold (≥1)
 * @property {number}            n             - members.length (推导出来一致)
 * @property {MultiSigMember[]}  members       - 参与方完整集合
 * @property {string[]}          algorithms    - 允许的 alg 白名单（subset 仅用于
 *                                                额外硬约束；通常 = members 提供的 algs union）
 * @property {number}            defaultExpiryMs - 提案默认过期窗口（毫秒），默认 24h
 * @property {boolean}           requirePqc    - 强制至少 1 个 SLH-DSA 签名（PQC 过渡期）
 */

const { jcs } = require("@chainlesschain/core-mtc/jcs");

const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

const SUPPORTED_ALGS = Object.freeze(["Ed25519", "SLH-DSA-SHA2-128F"]);

/**
 * 校验 policy 形状 — fail-fast 防 misconfigured policy 落库。
 *
 * @param {MultiSigPolicy} policy
 * @throws {TypeError|RangeError} 形状非法
 */
function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") {
    throw new TypeError("validatePolicy: policy must be an object");
  }
  if (typeof policy.domain !== "string" || policy.domain.length === 0) {
    throw new TypeError("validatePolicy: domain must be non-empty string");
  }
  if (!Number.isInteger(policy.m) || policy.m < 1) {
    throw new RangeError(`validatePolicy: m must be integer ≥1 (got ${policy.m})`);
  }
  if (!Array.isArray(policy.members) || policy.members.length === 0) {
    throw new TypeError("validatePolicy: members must be non-empty array");
  }
  if (!Number.isInteger(policy.n) || policy.n !== policy.members.length) {
    throw new RangeError(
      `validatePolicy: n must equal members.length (n=${policy.n}, members.length=${policy.members.length})`,
    );
  }
  if (policy.m > policy.n) {
    throw new RangeError(
      `validatePolicy: m must be ≤ n (m=${policy.m}, n=${policy.n})`,
    );
  }
  const seenDids = new Set();
  // Track distinct keys too, not just dids: an M-of-N policy is only really
  // M-of-N if its members hold M DISTINCT keys. validatePolicy already rejects
  // duplicate dids; without the matching pubkey check, two member slots sharing
  // one key (copy-paste config, or a member-add flow that doesn't check key
  // uniqueness) silently degrade the threshold — a single key holder fills two
  // slots and reaches a 2-of-N alone. Fingerprint = canonical JWK bytes.
  const seenKeys = new Set();
  for (const member of policy.members) {
    if (!member || typeof member.did !== "string" || member.did.length === 0) {
      throw new TypeError("validatePolicy: each member must have non-empty did");
    }
    if (seenDids.has(member.did)) {
      throw new RangeError(`validatePolicy: duplicate member did "${member.did}"`);
    }
    seenDids.add(member.did);
    if (!SUPPORTED_ALGS.includes(member.alg)) {
      throw new RangeError(
        `validatePolicy: member ${member.did} alg "${member.alg}" not in ${SUPPORTED_ALGS.join("/")}`,
      );
    }
    if (!member.pubkeyJwk || typeof member.pubkeyJwk !== "object") {
      throw new TypeError(`validatePolicy: member ${member.did} missing pubkeyJwk`);
    }
    const keyFp = jcs(member.pubkeyJwk).toString("base64url");
    if (seenKeys.has(keyFp)) {
      throw new RangeError(
        `validatePolicy: duplicate member public key (member ${member.did} reuses another member's key) — M-of-N requires distinct keys per member`,
      );
    }
    seenKeys.add(keyFp);
  }
  if (policy.algorithms != null) {
    if (!Array.isArray(policy.algorithms)) {
      throw new TypeError("validatePolicy: algorithms must be array if provided");
    }
    for (const alg of policy.algorithms) {
      if (!SUPPORTED_ALGS.includes(alg)) {
        throw new RangeError(
          `validatePolicy: algorithms entry "${alg}" not in ${SUPPORTED_ALGS.join("/")}`,
        );
      }
    }
  }
  if (policy.requirePqc === true) {
    const hasPqc = policy.members.some((m) => m.alg === "SLH-DSA-SHA2-128F");
    if (!hasPqc) {
      throw new RangeError(
        "validatePolicy: requirePqc=true but no member has SLH-DSA-SHA2-128F",
      );
    }
  }
  if (policy.defaultExpiryMs != null) {
    if (!Number.isInteger(policy.defaultExpiryMs) || policy.defaultExpiryMs <= 0) {
      throw new RangeError(
        `validatePolicy: defaultExpiryMs must be positive integer (got ${policy.defaultExpiryMs})`,
      );
    }
  }
}

/**
 * 用默认值补齐 policy（不修改入参；返回新对象）。
 */
function normalizePolicy(policy) {
  validatePolicy(policy);
  return {
    ...policy,
    algorithms:
      policy.algorithms ??
      Array.from(new Set(policy.members.map((m) => m.alg))),
    defaultExpiryMs: policy.defaultExpiryMs ?? DEFAULT_EXPIRY_MS,
    requirePqc: policy.requirePqc === true,
  };
}

module.exports = {
  DEFAULT_EXPIRY_MS,
  SUPPORTED_ALGS,
  validatePolicy,
  normalizePolicy,
};
