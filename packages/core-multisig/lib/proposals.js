"use strict";

/**
 * v1.2 m-of-n Phase 1c — Proposal orchestration: propose / accumulate / cancel / expire。
 *
 * 设计文档 §3 流程：
 *   1. initiator 调 propose(...) → 生成 proposalId + 立即用 initiator key 签首签
 *   2. 其它 signer 收到 (out-of-band, e.g. WS) → 调 sign(proposalId, signerKey)
 *   3. 每次 sign 后调用 _checkThreshold：达到 M 把 state 'pending' → 'reached'
 *   4. caller 取 finalize(proposalId)（外部业务侧执行操作后）→ state 'consumed'
 *   5. 任一 signer 可 cancel(proposalId, reason) → state 'cancelled'
 *   6. 后台 sweeper 调 expireStale(now) → expired
 *
 * 状态机：
 *   pending → reached → consumed
 *      ↓        ↓
 *   cancelled (anytime before consumed)
 *      ↓
 *   expired (pending only, sweeper)
 *
 * 不变量：consumed / cancelled / expired 是 terminal — 不可再回退或转移到其它 state。
 */

const crypto = require("crypto");
const {
  canonicalizeForSigning,
  computePayloadHash,
  signRaw,
  verifyOne,
  verifyThreshold,
} = require("./signing.js");
const { normalizePolicy } = require("./policy.js");

const TERMINAL_STATES = new Set(["consumed", "cancelled", "expired"]);

/** 生成 proposal id — ULID 风格短串。 */
function _newProposalId() {
  return (
    "msp_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(8).toString("hex")
  );
}

/**
 * 从 proposal 快照重建用于签名/校验的 signing core（sign / signAsync /
 * _checkReached 三处共用）。payloadJcs 是 propose() 入库的 JCS 字符串；若存储
 * 损坏导致非法 JSON，抛出带 proposal id 的明确错误，而不是裸 SyntaxError
 * （后者无上下文、难以定位是哪个 proposal 的哪条字段坏了）。
 */
function _rebuildSigningCore(proposal) {
  let payload;
  try {
    payload = JSON.parse(proposal.payloadJcs);
  } catch (err) {
    throw new Error(
      `multisig proposal ${proposal.id} has corrupted payloadJcs (invalid JSON): ${err.message}`,
    );
  }
  return {
    domain: proposal.domain,
    payload,
    nonce: proposal.nonce,
    expiresAtMs: proposal.expiresAtMs,
    m: proposal.thresholdM,
    members: proposal.memberSet,
  };
}

/** 生成 nonce — timestamp + random，防回放。 */
function _newNonce() {
  return (
    Date.now().toString(16).padStart(12, "0") + crypto.randomBytes(8).toString("hex")
  );
}

/**
 * @typedef {import('./store.js').StoredProposal} StoredProposal
 */

/**
 * 创建 proposals manager。store + 可选 governanceLog 注入。
 *
 * @param {object} store          - createStore(...) 返回值
 * @param {object} [options]
 * @param {(event:object)=>void} [options.logEvent]  - 状态转移 callback；governance.log
 *                                                       适配函数（appendEvent.bind）
 * @param {()=>number} [options.now]                 - 测试可注入 fake clock
 */
function createProposalsManager(store, options = {}) {
  if (!store || typeof store.insertProposal !== "function") {
    throw new TypeError("createProposalsManager: store is required");
  }
  const logEvent = typeof options.logEvent === "function" ? options.logEvent : () => {};
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  /**
   * 发起提案 + 用 initiator key 签首签。
   *
   * @param {{domain:string, payload:any, policy:object, initiator:{did:string, alg:string, secretKey:Buffer}}} input
   * @returns {{proposal: StoredProposal, sig: Buffer, reachedThreshold: boolean}}
   */
  function propose(input) {
    const policy = normalizePolicy(input.policy);
    const initiator = input.initiator;
    if (!initiator || typeof initiator.did !== "string") {
      throw new TypeError("propose: initiator.did is required");
    }
    const member = policy.members.find((m) => m.did === initiator.did);
    if (!member) {
      throw new RangeError(
        `propose: initiator ${initiator.did} is not in policy.members`,
      );
    }
    if (member.alg !== initiator.alg) {
      throw new RangeError(
        `propose: initiator alg "${initiator.alg}" doesn't match policy member alg "${member.alg}"`,
      );
    }
    const id = _newProposalId();
    const nonce = _newNonce();
    const createdAtMs = now();
    const expiresAtMs = createdAtMs + policy.defaultExpiryMs;

    const signingCore = {
      domain: input.domain,
      payload: input.payload,
      nonce,
      expiresAtMs,
      m: policy.m,
      members: policy.members,
    };
    const signingInput = canonicalizeForSigning(signingCore);
    const payloadHash = computePayloadHash(signingCore);
    const sig = signRaw(signingInput, initiator.secretKey, initiator.alg);

    const proposal = {
      id,
      domain: input.domain,
      // 仅存 raw payload 的 JSON — 验证时重建完整 signingCore，sigs 不入此列。
      payloadJcs: JSON.stringify(input.payload),
      payloadHash,
      nonce,
      expiresAtMs,
      thresholdM: policy.m,
      memberSet: policy.members,
      // Snapshot requirePqc so the PQC-signature requirement is enforced at
      // threshold time (verifyThreshold). Snapshotting (not re-reading the
      // live policy) prevents weakening it by mutating the policy after the
      // proposal exists — mirrors why members/m are snapshotted + signed.
      requirePqc: policy.requirePqc === true,
      state: "pending",
      initiatorDid: initiator.did,
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
    store.insertProposal(proposal);
    store.insertSignature({
      proposalId: id,
      signerDid: initiator.did,
      sig,
      alg: initiator.alg,
      signedAtMs: createdAtMs,
    });
    logEvent({
      at: new Date(createdAtMs).toISOString(),
      type: "proposed",
      proposalId: id,
      domain: input.domain,
      initiator: initiator.did,
      m: policy.m,
      n: policy.n,
    });
    logEvent({
      at: new Date(createdAtMs).toISOString(),
      type: "signed",
      proposalId: id,
      signerDid: initiator.did,
      alg: initiator.alg,
    });
    // 1-of-1 立即 reached
    const reached = _checkReached(id);
    return { proposal, sig, reachedThreshold: reached };
  }

  /**
   * 已存在的 proposal 加签。验签通过 + 未重复 + state=pending 才接受。
   *
   * @param {{proposalId:string, signer:{did:string, alg:string, secretKey:Buffer}}} input
   * @returns {{accepted: boolean, reachedThreshold: boolean, reason?: string}}
   */
  function sign(input) {
    const proposal = store.getProposal(input.proposalId);
    if (!proposal) return { accepted: false, reachedThreshold: false, reason: "proposal_not_found" };
    if (proposal.state !== "pending") {
      return {
        accepted: false,
        reachedThreshold: proposal.state === "reached",
        reason: `proposal_state_${proposal.state}`,
      };
    }
    if (proposal.expiresAtMs <= now()) {
      // 标过期
      store.updateProposalState(proposal.id, "expired", now());
      logEvent({
        at: new Date(now()).toISOString(),
        type: "expired",
        proposalId: proposal.id,
      });
      return { accepted: false, reachedThreshold: false, reason: "expired" };
    }
    const member = proposal.memberSet.find((m) => m.did === input.signer.did);
    if (!member) return { accepted: false, reachedThreshold: false, reason: "not_a_member" };
    if (member.alg !== input.signer.alg) {
      return { accepted: false, reachedThreshold: false, reason: "alg_mismatch" };
    }
    if (store.hasSignature(proposal.id, input.signer.did)) {
      return { accepted: false, reachedThreshold: false, reason: "duplicate_signer" };
    }

    // 重建 signing input + 签
    const signingCore = _rebuildSigningCore(proposal);
    const signingInput = canonicalizeForSigning(signingCore);
    const sig = signRaw(signingInput, input.signer.secretKey, input.signer.alg);

    // 自验通过才入库（fail-fast 防 caller 误传 secretKey）
    const selfVerify = verifyOne(signingInput, sig, input.signer.alg, member.pubkeyJwk);
    if (!selfVerify) {
      return { accepted: false, reachedThreshold: false, reason: "sig_self_verify_failed" };
    }

    const signedAtMs = now();
    store.insertSignature({
      proposalId: proposal.id,
      signerDid: input.signer.did,
      sig,
      alg: input.signer.alg,
      signedAtMs,
    });
    logEvent({
      at: new Date(signedAtMs).toISOString(),
      type: "signed",
      proposalId: proposal.id,
      signerDid: input.signer.did,
      alg: input.signer.alg,
    });
    const reached = _checkReached(proposal.id);
    return { accepted: true, reachedThreshold: reached };
  }

  /**
   * #21 B.1 PR2a — 异步外部 signer 加签。同 sign() 检查，但调用方提供
   * `signCallback(canonicalBytes, alg) → Promise<Buffer>` 代替 secretKey。
   *
   * 设计动机：renderer 端、U-Key 硬件、TEE 内的私钥永远 **不离开** 那个边界 ——
   * caller 把 canonical bytes 通过 IPC/硬件接口送进去签，外部返回 sig bytes，
   * 我们这边做 self-verify + insertSignature。secretKey: Buffer 不出现在
   * 这个 API 的输入里。
   *
   * 与 sign() 区别：
   *   sign()              ← caller 持 secretKey Buffer（CLI / Node 集成）
   *   signWithExternal()  ← caller 持 signCallback（renderer / hardware / TEE）
   *
   * 校验 mirror sign()：proposal 状态 / 成员 / alg 匹配 / 未重复 / 自验通过 →
   * 入库 + log + _checkReached。差异：不可能拿到 secretKey 时 fail-fast 早些，
   * 只能在 self-verify 失败时拒收（callback 签错了或 alg 错了）。
   *
   * @param {{ proposalId: string,
   *           signer: { did: string, alg: string },
   *           signCallback: (canonicalBytes: Buffer, alg: string) => Promise<Buffer> }} input
   * @returns {Promise<{ accepted: boolean, reachedThreshold: boolean, reason?: string }>}
   */
  async function signWithExternal(input) {
    if (typeof input.signCallback !== "function") {
      return {
        accepted: false,
        reachedThreshold: false,
        reason: "missing_sign_callback",
      };
    }
    const proposal = store.getProposal(input.proposalId);
    if (!proposal) {
      return {
        accepted: false,
        reachedThreshold: false,
        reason: "proposal_not_found",
      };
    }
    if (proposal.state !== "pending") {
      return {
        accepted: false,
        reachedThreshold: proposal.state === "reached",
        reason: `proposal_state_${proposal.state}`,
      };
    }
    if (proposal.expiresAtMs <= now()) {
      store.updateProposalState(proposal.id, "expired", now());
      logEvent({
        at: new Date(now()).toISOString(),
        type: "expired",
        proposalId: proposal.id,
      });
      return { accepted: false, reachedThreshold: false, reason: "expired" };
    }
    const member = proposal.memberSet.find(
      (m) => m.did === input.signer.did,
    );
    if (!member) {
      return { accepted: false, reachedThreshold: false, reason: "not_a_member" };
    }
    if (member.alg !== input.signer.alg) {
      return { accepted: false, reachedThreshold: false, reason: "alg_mismatch" };
    }
    if (store.hasSignature(proposal.id, input.signer.did)) {
      return {
        accepted: false,
        reachedThreshold: false,
        reason: "duplicate_signer",
      };
    }

    const signingCore = _rebuildSigningCore(proposal);
    const signingInput = canonicalizeForSigning(signingCore);

    let sig;
    try {
      sig = await input.signCallback(signingInput, input.signer.alg);
    } catch (err) {
      return {
        accepted: false,
        reachedThreshold: false,
        reason: "sign_callback_failed",
        detail: err && err.message ? err.message : String(err),
      };
    }
    if (!Buffer.isBuffer(sig)) {
      return {
        accepted: false,
        reachedThreshold: false,
        reason: "sign_callback_returned_non_buffer",
      };
    }

    const selfVerify = verifyOne(
      signingInput,
      sig,
      input.signer.alg,
      member.pubkeyJwk,
    );
    if (!selfVerify) {
      return {
        accepted: false,
        reachedThreshold: false,
        reason: "sig_self_verify_failed",
      };
    }

    const signedAtMs = now();
    store.insertSignature({
      proposalId: proposal.id,
      signerDid: input.signer.did,
      sig,
      alg: input.signer.alg,
      signedAtMs,
    });
    logEvent({
      at: new Date(signedAtMs).toISOString(),
      type: "signed",
      proposalId: proposal.id,
      signerDid: input.signer.did,
      alg: input.signer.alg,
      external: true,
    });
    const reached = _checkReached(proposal.id);
    return { accepted: true, reachedThreshold: reached };
  }

  /**
   * 取消 proposal — 任一 signer 可调（业务侧应在调用前鉴权 signer 身份）。
   * consumed/expired 不允许 cancel。
   */
  function cancel(proposalId, reason) {
    const proposal = store.getProposal(proposalId);
    if (!proposal) return { ok: false, reason: "proposal_not_found" };
    if (TERMINAL_STATES.has(proposal.state) && proposal.state !== "reached") {
      return { ok: false, reason: `proposal_state_${proposal.state}` };
    }
    const nowMs = now();
    // CAS from the observed (non-terminal) state: a concurrent finalize() may
    // have consumed it between the read above and here — flip only if the state
    // is unchanged, so we never stamp 'cancelled' over 'consumed'. 0 rows = lost
    // the race (already consumed/cancelled/expired by another caller).
    const flipped = store.updateProposalState(
      proposalId,
      "cancelled",
      nowMs,
      proposal.state,
    );
    if (!flipped) {
      const fresh = store.getProposal(proposalId);
      return { ok: false, reason: `proposal_state_${fresh ? fresh.state : "unknown"}` };
    }
    logEvent({
      at: new Date(nowMs).toISOString(),
      type: "cancelled",
      proposalId,
      reason: typeof reason === "string" ? reason : null,
    });
    return { ok: true };
  }

  /**
   * 业务方完成操作后标 'reached' → 'consumed' (terminal)。防 double-consume。
   */
  function finalize(proposalId) {
    const proposal = store.getProposal(proposalId);
    if (!proposal) return { ok: false, reason: "proposal_not_found" };
    if (proposal.state !== "reached") {
      return { ok: false, reason: `proposal_state_${proposal.state}` };
    }
    const nowMs = now();
    // CAS reached→consumed. The outer state check is read outside any tx, so
    // two concurrent finalize() (multi-connection) could both observe 'reached'
    // and both consume → the approved privileged operation executes twice. Flip
    // only if STILL 'reached'; 0 rows = lost the race (already consumed/cancelled).
    const flipped = store.updateProposalState(
      proposalId,
      "consumed",
      nowMs,
      "reached",
    );
    if (!flipped) {
      const fresh = store.getProposal(proposalId);
      return { ok: false, reason: `proposal_state_${fresh ? fresh.state : "unknown"}` };
    }
    logEvent({
      at: new Date(nowMs).toISOString(),
      type: "consumed",
      proposalId,
    });
    return { ok: true };
  }

  /**
   * sweeper：把所有 expires_at < now 且 pending 的标 expired。
   */
  function expireStale() {
    const nowMs = now();
    const count = store.expireStale(nowMs);
    if (count > 0) {
      logEvent({
        at: new Date(nowMs).toISOString(),
        type: "expired_sweep",
        count,
      });
    }
    return count;
  }

  /**
   * 检查给定 proposal 是否达到 threshold；如达且仍 pending → 标 reached。
   * @returns {boolean} 是否 reached（包括之前已 reached）
   */
  function _checkReached(proposalId) {
    const proposal = store.getProposal(proposalId);
    if (!proposal) return false;
    if (proposal.state !== "pending") return proposal.state === "reached";

    const sigs = store.getSignatures(proposalId);
    const signingCore = _rebuildSigningCore(proposal);
    const signingInput = canonicalizeForSigning(signingCore);

    // 用 policy 蜕化形式（normalize 已做过；这里只重建必要字段）。
    // requirePqc 取自 proposal 快照 — 若 policy 要求 PQC，则 threshold 必须
    // 含 ≥1 个有效 SLH-DSA 签名才算 reached（verifyThreshold 内强制）。
    const policyForVerify = {
      m: proposal.thresholdM,
      members: proposal.memberSet,
      requirePqc: proposal.requirePqc === true,
    };
    const result = verifyThreshold(signingInput, sigs, policyForVerify);
    if (result.reached) {
      const nowMs = now();
      store.updateProposalState(proposalId, "reached", nowMs);
      logEvent({
        at: new Date(nowMs).toISOString(),
        type: "reached",
        proposalId,
        validSigners: result.validSigners,
      });
      return true;
    }
    return false;
  }

  /**
   * 给业务方读 proposal + 当前签名集合的 helper。
   */
  function get(proposalId) {
    const proposal = store.getProposal(proposalId);
    if (!proposal) return null;
    const sigs = store.getSignatures(proposalId);
    return { proposal, signatures: sigs };
  }

  return {
    propose,
    sign,
    signWithExternal,
    cancel,
    finalize,
    expireStale,
    get,
    // 内部测试钩子，外部业务不应依赖
    _checkReached,
  };
}

module.exports = { createProposalsManager, _newProposalId, _newNonce, TERMINAL_STATES };
