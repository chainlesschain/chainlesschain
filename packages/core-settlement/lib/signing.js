"use strict";

/**
 * P1 结算核 — 转账日志条目的签名/验签。
 *
 * 设计文档 §8.2：联邦账本是「只追加的签名转账日志」——每笔由付款方签名，
 * 节点只托管+排序，无有效签名伪造不了转账/增发。本模块提供条目的 canonical
 * 字节、Ed25519 签名与验签（复用 core-mtc 的 ed25519 signer + JCS，与
 * core-multisig 同源）。
 *
 * 域分隔：签名前 prefix "SETTLE:" 防与 MULTISIG / MTC 等其它协议签名跨用回放。
 * canonical core 含 ledgerId — 把每笔转账绑定到具体联邦账本，防跨账本重放。
 */

const { jcs } = require("@chainlesschain/core-mtc/jcs");
const ed25519Signer = require("@chainlesschain/core-mtc/signers/ed25519");

const DOMAIN_PREFIX = Buffer.from("SETTLE:", "utf-8");
const ALG = ed25519Signer.ALG;

/**
 * 条目签名输入 = DOMAIN_PREFIX || JCS({ledgerId, kind, from, to, amount, nonce})。
 * sig 不入 core（producer + verifier 喂同样 core）。
 * @param {{ledgerId:string, kind:"mint"|"transfer", from:(string|null), to:string, amount:number, nonce:string}} core
 * @returns {Buffer}
 */
function canonicalizeEntry(core) {
  if (!core || typeof core !== "object") {
    throw new TypeError("canonicalizeEntry: core must be object");
  }
  const c = {
    ledgerId: core.ledgerId,
    kind: core.kind,
    from: core.from == null ? null : core.from,
    to: core.to,
    amount: core.amount,
    nonce: core.nonce,
  };
  return Buffer.concat([DOMAIN_PREFIX, jcs(c)]);
}

/**
 * 用付款方（或 genesis）的 Ed25519 私钥签条目。
 * @returns {Buffer} signature
 */
function signEntry(core, secretKey) {
  return ed25519Signer.signRaw(canonicalizeEntry(core), secretKey);
}

/**
 * 验条目签名。sig 接受 Buffer / Uint8Array（sql.js BLOB 读出是 Uint8Array）。
 * @returns {boolean}
 */
function verifyEntry(core, sig, pubkeyJwk) {
  const pk = ed25519Signer.jwkToPublicKey(pubkeyJwk);
  if (!pk) return false;
  const s = Buffer.isBuffer(sig) ? sig : Buffer.from(sig || []);
  if (s.length !== 64) return false;
  // 复用 core-mtc 已声明的 ed25519 验签（makeVerifier 内部即 ed25519.verify），不直接
  // require("@noble/curves")——该包未在 core-settlement 声明，仅靠 monorepo hoisting
  // 碰巧能用，独立发布安装会 Cannot find module。
  const id = ed25519Signer.pubkeyId(pk);
  const verify = ed25519Signer.makeVerifier(new Map([[id, pk]]));
  return verify(canonicalizeEntry(core), { alg: ALG, pubkey_id: id, sig: s.toString("base64url") });
}

module.exports = { DOMAIN_PREFIX, ALG, canonicalizeEntry, signEntry, verifyEntry };
