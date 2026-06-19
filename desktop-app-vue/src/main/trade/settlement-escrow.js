"use strict";

/**
 * 桌面 ↔ core-settlement 集成 adapter（P1 wiring）。
 *
 * 把 @chainlesschain/core-settlement 的「联邦签名转账日志账本 + 托管人 escrow（multisig
 * 门控）」桥接到桌面：复用桌面 DID 的 Ed25519 密钥签转账、复用桌面 db、把 release/refund
 * 门控接到 core-multisig 的提案状态。
 *
 * 设计参考：docs/design/去中心化交易_知识资产加密交付与AI撮合_v1.md §3.2 / §8.2 / §6。
 *
 * ── 依赖注入（不硬 require core-settlement）──────────────────────────────────
 * core-settlement 作为 `settlement` 注入：① 现在即可独立单测（从 root 解析注入）；
 * ② live 接线时由 trade-initializer 传 require("@chainlesschain/core-settlement")，
 * 那一步再把它加进 desktop package.json 的 file: dep。本模块本身零硬依赖。
 *
 * ── 关键互操作：桌面 nacl DID 密钥 → core-settlement(noble) ──────────────────
 * 桌面 DID 用 tweetnacl：secretKey 64 字节 = seed(32) + pub(32)。core-settlement 用
 * core-mtc/@noble：secretKey = 32 字节 seed。两者都是标准 Ed25519，**同一 seed 派生同一
 * 公钥**（已实测匹配）。故桥 = 取 nacl secret 的前 32 字节 seed。
 */

const ed25519Signer = require("@chainlesschain/core-mtc/signers/ed25519");

/**
 * 把桌面 DID 身份转成 core-settlement member（含可签名的 32B seed）。
 *
 * @param {object} identity  桌面 didManager.getCurrentIdentity() 解密后的身份：
 *   { did, public_key_sign:base64(32B), private_key_ref: JSON {sign: base64(64B nacl secret)} }
 * @returns {{did:string, alg:string, pubkeyJwk:object, secretKey:Buffer}}
 */
function naclIdentityToMember(identity) {
  if (!identity || !identity.did) {
    throw new TypeError("naclIdentityToMember: identity.did required");
  }
  const pkRef =
    typeof identity.private_key_ref === "string"
      ? JSON.parse(identity.private_key_ref)
      : identity.private_key_ref;
  if (!pkRef || !pkRef.sign) {
    throw new TypeError("naclIdentityToMember: private_key_ref.sign required");
  }
  const naclSecret = Buffer.from(pkRef.sign, "base64"); // 64B = seed(32)+pub(32)
  if (naclSecret.length !== 64) {
    throw new RangeError(
      `expected 64-byte nacl secret, got ${naclSecret.length}`,
    );
  }
  const seed = naclSecret.subarray(0, 32); // = core-mtc/noble 的 32B secretKey
  const pub = Buffer.from(identity.public_key_sign, "base64");
  return {
    did: identity.did,
    alg: ed25519Signer.ALG,
    pubkeyJwk: ed25519Signer.makeJwk(pub),
    secretKey: Buffer.from(seed),
  };
}

/** 仅公钥（验签/注册他人 member 用，无私钥）。pub 接受 base64 或 Buffer。 */
function naclPublicToMember(did, publicKeySign) {
  const pub = Buffer.isBuffer(publicKeySign)
    ? publicKeySign
    : Buffer.from(publicKeySign, "base64");
  return { did, alg: ed25519Signer.ALG, pubkeyJwk: ed25519Signer.makeJwk(pub) };
}

/**
 * 创建桌面结算 escrow facade。
 *
 * @param {object} opts
 * @param {object} opts.settlement   注入的 @chainlesschain/core-settlement 模块
 * @param {object} opts.db           桌面 db 句柄（this.database.db）
 * @param {string} opts.ledgerId     联邦账本 id
 * @param {object} opts.genesis      genesis member（含 secretKey，签发 grant）
 * @param {object} opts.custodian    托管人 member（含 secretKey，签 release/refund 转账）
 * @param {(proposalId:string)=>{releasable:boolean,reason?:string}} [opts.proposalGate]
 *        放款门控；live 接 core-multisig 提案状态（state ∈ reached|consumed → releasable）
 */
function createSettlementEscrow(opts) {
  const { settlement, db, ledgerId, genesis, custodian, proposalGate } =
    opts || {};
  if (!settlement || typeof settlement.createLedger !== "function") {
    throw new TypeError(
      "createSettlementEscrow: settlement (core-settlement) required",
    );
  }
  if (!db) {
    throw new TypeError("createSettlementEscrow: db required");
  }
  if (!genesis || !genesis.secretKey) {
    throw new TypeError(
      "createSettlementEscrow: genesis member with secretKey required",
    );
  }
  if (!custodian || !custodian.secretKey) {
    throw new TypeError(
      "createSettlementEscrow: custodian member with secretKey required",
    );
  }

  settlement.applySchema(db);
  const ledger = settlement.createLedger(db, {
    ledgerId,
    genesisDid: genesis.did,
  });
  // 注册 genesis + custodian（公钥入 member 册，供验签）
  ledger.registerMember({
    did: genesis.did,
    alg: genesis.alg,
    pubkeyJwk: genesis.pubkeyJwk,
  });
  ledger.registerMember({
    did: custodian.did,
    alg: custodian.alg,
    pubkeyJwk: custodian.pubkeyJwk,
  });
  const escrow = settlement.createEscrow(db, ledger, {
    custodianDid: custodian.did,
    custodianSecretKey: custodian.secretKey,
    proposalGate, // 不传 → core-settlement 默认放行；live 必传 multisig gate
  });

  return {
    ledger,
    escrow,
    /** 注册成员公钥（买/卖方加入账本，验签用）。 */
    registerMember(member) {
      ledger.registerMember({
        did: member.did,
        alg: member.alg,
        pubkeyJwk: member.pubkeyJwk,
      });
    },
    /** 发放 credits（grant，仅 genesis 可）。 */
    grant({ to, amount, nonce }) {
      return ledger.signAndMint({
        to,
        amount,
        secretKey: genesis.secretKey,
        nonce,
      });
    },
    balanceOf: (did) => ledger.balanceOf(did),
    /**
     * 为一笔交易开托管。买方押款 buyer→custodian。
     *  - 多方真实场景：传 fund = 买方设备签好的 {nonce, alg, sig}
     *  - 本地/测试场景：传 buyerSecretKey 由本地签名
     */
    openHoldForTransaction({
      transactionId,
      buyer,
      seller,
      amount,
      proposalId,
      fund,
      buyerSecretKey,
      nonce,
    }) {
      let f = fund;
      if (!f) {
        if (!buyerSecretKey) {
          throw new TypeError(
            "openHoldForTransaction: fund 或 buyerSecretKey 必传其一",
          );
        }
        const n =
          nonce ||
          (settlement.canonicalizeEntry &&
            require("crypto").randomBytes(12).toString("hex"));
        const core = {
          ledgerId,
          kind: "transfer",
          from: buyer,
          to: custodian.did,
          amount,
          nonce: n,
        };
        f = {
          nonce: n,
          alg: ed25519Signer.ALG,
          sig: settlement.signEntry(core, buyerSecretKey),
        };
      }
      return escrow.openHold({
        orderId: transactionId,
        buyer,
        seller,
        amount,
        proposalId,
        fund: f,
      });
    },
    /** 经 multisig 门控放款给卖方。 */
    release: (holdId) => escrow.release(holdId),
    /** 退款给买方。 */
    refund: (holdId) => escrow.refund(holdId),
    getHold: (holdId) => escrow.getHold(holdId),
  };
}

module.exports = {
  createSettlementEscrow,
  naclIdentityToMember,
  naclPublicToMember,
};
