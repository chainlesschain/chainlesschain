"use strict";

/**
 * v1.2 m-of-n Phase 1b — canonicalization + sign + verify。
 *
 * 设计文档 §3.2-3.3：
 *   - JCS (RFC 8785) 规范化 payload，与 MTC publisher_signature 规则对称
 *   - 签名前剥离 sigs 字段（_stripSigsForSigning），producer + verifier 同步
 *   - dispatcher by alg: Ed25519 (core-mtc/signers/ed25519) / SLH-DSA-SHA2-128F
 *   - 与 MTC 的 _stripSigsForPublisher 不复用同一函数 — MTC 那个剥的是 landmark
 *     特定 publisher_signature 字段，本场景剥的是 proposal sigs 数组（更通用）。
 *
 * 域分隔：sign 前 prefix "MULTISIG:" 防与 MTC tree-head / 其它协议签名混用回放。
 */

const crypto = require("crypto");
const { jcs } = require("@chainlesschain/core-mtc/jcs");
const ed25519Signer = require("@chainlesschain/core-mtc/signers/ed25519");
const slhDsaSigner = require("@chainlesschain/core-mtc/signers/slh-dsa");

const DOMAIN_PREFIX = Buffer.from("MULTISIG:", "utf-8");

/**
 * 计算用于签名的 canonical bytes：
 *   signing_input = DOMAIN_PREFIX || JCS({domain, payload, nonce, expiresAtMs, m, members})
 *
 * 不包含 sigs 数组（producer + verifier 喂同样的 payloadCore），符合
 * "strip sigs for signing" 设计。
 *
 * @param {{domain: string, payload: any, nonce: string, expiresAtMs: number, m: number, members: Array<{did:string, alg:string, pubkeyJwk:object}>}} input
 * @returns {Buffer}
 */
function canonicalizeForSigning(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("canonicalizeForSigning: input must be object");
  }
  const core = {
    domain: input.domain,
    payload: input.payload,
    nonce: input.nonce,
    expiresAtMs: input.expiresAtMs,
    m: input.m,
    // members 也进 canonical hash — 防签后 member 被改：
    members: input.members.map((m) => ({
      did: m.did,
      alg: m.alg,
      pubkeyJwk: m.pubkeyJwk,
    })),
  };
  return Buffer.concat([DOMAIN_PREFIX, jcs(core)]);
}

/**
 * 计算 payload_hash = sha256(canonicalizeForSigning(input))，用 SQLite payload_hash 列。
 */
function computePayloadHash(input) {
  return crypto.createHash("sha256").update(canonicalizeForSigning(input)).digest();
}

/**
 * 签名单个 signer。
 *
 * @param {Buffer} signingInput  - canonicalizeForSigning(...) 输出
 * @param {Buffer} secretKey
 * @param {string} alg           - "Ed25519" | "SLH-DSA-SHA2-128F"
 * @returns {Buffer}             - signature bytes
 */
function signRaw(signingInput, secretKey, alg) {
  switch (alg) {
    case ed25519Signer.ALG:
      return ed25519Signer.signRaw(signingInput, secretKey);
    case slhDsaSigner.ALG:
      return slhDsaSigner.signRaw(signingInput, secretKey);
    default:
      throw new RangeError(`signRaw: unsupported alg "${alg}"`);
  }
}

/**
 * 单签验证。
 *
 * @param {Buffer} signingInput
 * @param {Buffer} sig
 * @param {string} alg
 * @param {object} pubkeyJwk     - member.pubkeyJwk
 * @returns {boolean}
 */
function verifyOne(signingInput, sig, alg, pubkeyJwk) {
  switch (alg) {
    case ed25519Signer.ALG: {
      const pk = ed25519Signer.jwkToPublicKey(pubkeyJwk);
      if (!pk) return false;
      // 借 makeVerifier 的内部 verify 路径，但跳过 pubkey_id Map 查找：
      // 直接调 @noble/curves/ed25519.verify 走更直白。
      const { ed25519 } = require("@noble/curves/ed25519.js");
      if (!Buffer.isBuffer(sig) || sig.length !== 64) return false;
      try {
        return ed25519.verify(sig, signingInput, pk);
      } catch (_err) {
        return false;
      }
    }
    case slhDsaSigner.ALG: {
      const pk = slhDsaSigner.jwkToPublicKey(pubkeyJwk);
      if (!pk) return false;
      const { slh_dsa_sha2_128f } = require("@noble/post-quantum/slh-dsa.js");
      if (!Buffer.isBuffer(sig) || sig.length !== slhDsaSigner.SIGNATURE_LEN) {
        return false;
      }
      try {
        return slh_dsa_sha2_128f.verify(sig, signingInput, pk);
      } catch (_err) {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Threshold verify：返回 m 个有效签名是否达到。
 *
 * @param {Buffer} signingInput
 * @param {Array<{signerDid:string, sig:Buffer, alg:string}>} sigs
 * @param {{ m: number, members: Array<{did:string, alg:string, pubkeyJwk:object}>, requirePqc?: boolean }} policy
 * @returns {{ reached: boolean, validCount: number, validSigners: string[], pqcSatisfied: boolean }}
 */
function verifyThreshold(signingInput, sigs, policy) {
  const memberByDid = new Map(policy.members.map((m) => [m.did, m]));
  const validSigners = new Set();
  let pqcSig = false;
  for (const entry of sigs) {
    if (!entry || typeof entry !== "object") continue;
    const member = memberByDid.get(entry.signerDid);
    if (!member) continue; // unknown signer — reject silently
    if (member.alg !== entry.alg) continue; // alg mismatch
    if (validSigners.has(entry.signerDid)) continue; // dedupe — count each signer once
    const ok = verifyOne(signingInput, entry.sig, entry.alg, member.pubkeyJwk);
    if (ok) {
      validSigners.add(entry.signerDid);
      if (entry.alg === slhDsaSigner.ALG) pqcSig = true;
    }
  }
  const reached = validSigners.size >= policy.m && (!policy.requirePqc || pqcSig);
  return {
    reached,
    validCount: validSigners.size,
    validSigners: Array.from(validSigners).sort(), // 排序防重排攻击
    pqcSatisfied: pqcSig,
  };
}

module.exports = {
  DOMAIN_PREFIX,
  canonicalizeForSigning,
  computePayloadHash,
  signRaw,
  verifyOne,
  verifyThreshold,
};
