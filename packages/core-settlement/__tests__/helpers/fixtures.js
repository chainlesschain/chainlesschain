"use strict";

const ed25519Signer = require("@chainlesschain/core-mtc/signers/ed25519");

/** 生成一个 Ed25519 成员（did + 公钥 jwk + 私钥）。 */
function makeMember(did) {
  const kp = ed25519Signer.generateKeyPair();
  return {
    did,
    alg: ed25519Signer.ALG,
    pubkeyJwk: ed25519Signer.makeJwk(kp.publicKey),
    secretKey: kp.secretKey,
  };
}

module.exports = { makeMember };
