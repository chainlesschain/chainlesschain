"use strict";

/**
 * 测试 fixture：生成 N 个 Ed25519 keypair + policy。SLH-DSA 单独 helper（慢，
 * 个别测试用）。
 */

const ed25519Signer = require("@chainlesschain/core-mtc/signers/ed25519");
const slhDsaSigner = require("@chainlesschain/core-mtc/signers/slh-dsa");

function makeEd25519Member(idx) {
  const kp = ed25519Signer.generateKeyPair();
  return {
    did: `did:cc:test-${idx}`,
    alg: ed25519Signer.ALG,
    pubkeyJwk: ed25519Signer.makeJwk(kp.publicKey),
    _secretKey: kp.secretKey,
  };
}

function makeSlhDsaMember(idx) {
  const kp = slhDsaSigner.generateKeyPair();
  return {
    did: `did:cc:test-pqc-${idx}`,
    alg: slhDsaSigner.ALG,
    pubkeyJwk: slhDsaSigner.makeJwk(kp.publicKey),
    _secretKey: kp.secretKey,
  };
}

function makePolicy({ m, n, domain = "test.domain", requirePqc = false, withPqc = false }) {
  const members = [];
  for (let i = 0; i < n; i++) {
    if (withPqc && i === 0) {
      members.push(makeSlhDsaMember(i));
    } else {
      members.push(makeEd25519Member(i));
    }
  }
  return {
    domain,
    m,
    n,
    members: members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk })),
    requirePqc,
    _secretKeys: Object.fromEntries(members.map((m) => [m.did, m._secretKey])),
  };
}

module.exports = { makeEd25519Member, makeSlhDsaMember, makePolicy };
