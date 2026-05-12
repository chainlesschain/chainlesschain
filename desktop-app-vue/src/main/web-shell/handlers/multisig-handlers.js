/**
 * `multisig.*` + `marketplace.consume` WS handlers — #21 B.6 (削 cc subprocess 冷启).
 *
 * Replaces 7 `ws.execute('cc multisig …')` / `ws.execute('cc marketplace consume …')`
 * subprocess invocations from `packages/web-panel/src/views/Multisig.vue` with
 * in-process calls into `@chainlesschain/core-multisig` v0.1.0. asar:true 后子
 * 进程冷启 6-10s → in-process <100ms (SQLite open ~20ms + query)。
 *
 * 设计参考 `mtc-status-handlers.js`（同样的 ws.execute → in-process 改造模式，
 * 2026-05-07 v5.0.3.39 落地）。
 *
 * Topics shipped:
 *   multisig.list           store.listProposals({state?, domain?, limit?})
 *   multisig.show           mgr.get(proposalId)
 *   multisig.policy.show    store.getPolicy(domain)
 *   multisig.cancel         mgr.cancel(proposalId, reason?)
 *   multisig.finalize       mgr.finalize(proposalId)
 *   multisig.sweep          mgr.expireStale()
 *   marketplace.consume     domain-gated finalize for marketplace.purchase
 *
 * Returns shape matches what `ws.executeJson(…)` parsed from the CLI's `--json`
 * stdout — the renderer keeps the same response handling code paths.
 *
 * Each call opens a fresh multisig DB handle (SQLite open ~20ms, cheap) instead
 * of caching one across calls, so we don't have to manage lifecycle across the
 * web-shell lifetime (which would couple this handler to bootstrap teardown).
 */

const path = require("path");
const { pathToFileURL } = require("url");

const MULTISIG_RUNTIME_REL =
  "../../../../../packages/cli/src/lib/multisig-runtime.js";

/** Mirrors `MULTISIG_DOMAIN` const in packages/cli/src/commands/marketplace.js. */
const MULTISIG_PURCHASE_DOMAIN = "marketplace.purchase";

/**
 * @typedef {{
 *   openMultisigManager: (dbPath?: string, logPath?: string) => Promise<{ db, store, mgr, close }>,
 * }} MultisigRuntime
 */

let _cachedRuntime = null;
async function _loadRuntime() {
  if (_cachedRuntime) {
    return _cachedRuntime;
  }
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, MULTISIG_RUNTIME_REL),
  ).href;
  _cachedRuntime = await import(moduleUrl);
  return _cachedRuntime;
}

/**
 * Shape a stored proposal for `multisig.list` — matches CLI's `--json` output.
 */
function shapeProposalForList(p) {
  return {
    id: p.id,
    domain: p.domain,
    state: p.state,
    m: p.thresholdM,
    n: Array.isArray(p.memberSet) ? p.memberSet.length : null,
    initiatorDid: p.initiatorDid,
    createdAtMs: p.createdAtMs,
    expiresAtMs: p.expiresAtMs,
  };
}

/**
 * Shape a `mgr.get(id)` result for `multisig.show` — matches CLI's `--json`
 * output (payloadHash hex, payload parsed, sig bytes not raw).
 */
function shapeProposalDetail(got) {
  return {
    proposal: {
      ...got.proposal,
      payloadHash: Buffer.isBuffer(got.proposal.payloadHash)
        ? got.proposal.payloadHash.toString("hex")
        : got.proposal.payloadHash,
      payload: _safeParseJcs(got.proposal.payloadJcs),
    },
    signatures: (got.signatures || []).map((s) => ({
      signerDid: s.signerDid,
      alg: s.alg,
      signedAtMs: s.signedAtMs,
      sigBytes: s.sig ? s.sig.length : 0,
    })),
  };
}

function _safeParseJcs(jcs) {
  if (typeof jcs !== "string" || !jcs) {
    return null;
  }
  try {
    return JSON.parse(jcs);
  } catch (_err) {
    return null;
  }
}

/**
 * Build all 7 multisig + marketplace.consume topic handlers.
 *
 * Tests inject `runtimeFactory` to bypass the dynamic import; e2e leaves it
 * unset so the production path is exercised.
 *
 * @param {object} [options]
 * @param {() => Promise<MultisigRuntime>} [options.runtimeFactory]
 *   Returns a `multisig-runtime` shaped object. Defaults to dynamic-importing
 *   the CLI module.
 * @returns {Record<string, (msg: any) => Promise<any>>}
 */
function createMultisigHandlers(options = {}) {
  const factory = options.runtimeFactory ?? _loadRuntime;

  async function _open() {
    const runtime = await factory();
    return runtime.openMultisigManager();
  }

  return {
    "multisig.list": async (msg = {}) => {
      const { store, close } = await _open();
      try {
        const proposals = store.listProposals({
          state: msg.state,
          domain: msg.domain,
          limit: typeof msg.limit === "number" ? msg.limit : 50,
        });
        return proposals.map(shapeProposalForList);
      } finally {
        close();
      }
    },

    "multisig.show": async (msg = {}) => {
      if (!msg.proposalId || typeof msg.proposalId !== "string") {
        const e = new Error("multisig.show: proposalId required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      const { mgr, close } = await _open();
      try {
        const got = mgr.get(msg.proposalId);
        if (!got) {
          const e = new Error(`No proposal: ${msg.proposalId}`);
          e.code = "PROPOSAL_NOT_FOUND";
          throw e;
        }
        return shapeProposalDetail(got);
      } finally {
        close();
      }
    },

    "multisig.policy.show": async (msg = {}) => {
      if (!msg.domain || typeof msg.domain !== "string") {
        const e = new Error("multisig.policy.show: domain required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      const { store, close } = await _open();
      try {
        const policy = store.getPolicy(msg.domain);
        if (!policy) {
          const e = new Error(`No policy: ${msg.domain}`);
          e.code = "POLICY_NOT_FOUND";
          throw e;
        }
        return policy;
      } finally {
        close();
      }
    },

    "multisig.cancel": async (msg = {}) => {
      if (!msg.proposalId || typeof msg.proposalId !== "string") {
        const e = new Error("multisig.cancel: proposalId required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      const { mgr, close } = await _open();
      try {
        return mgr.cancel(msg.proposalId, msg.reason);
      } finally {
        close();
      }
    },

    "multisig.finalize": async (msg = {}) => {
      if (!msg.proposalId || typeof msg.proposalId !== "string") {
        const e = new Error("multisig.finalize: proposalId required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      const { mgr, close } = await _open();
      try {
        return mgr.finalize(msg.proposalId);
      } finally {
        close();
      }
    },

    "multisig.sweep": async () => {
      const { mgr, close } = await _open();
      try {
        return { expired: mgr.expireStale() };
      } finally {
        close();
      }
    },

    "marketplace.consume": async (msg = {}) => {
      if (!msg.proposalId || typeof msg.proposalId !== "string") {
        const e = new Error("marketplace.consume: proposalId required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      const { mgr, close } = await _open();
      try {
        const got = mgr.get(msg.proposalId);
        if (!got) {
          return { status: "error", reason: "proposal_not_found" };
        }
        if (got.proposal.domain !== MULTISIG_PURCHASE_DOMAIN) {
          return {
            status: "error",
            reason: "wrong_domain",
            expected: MULTISIG_PURCHASE_DOMAIN,
            actual: got.proposal.domain,
          };
        }
        if (got.proposal.state !== "reached") {
          return {
            status: "error",
            reason: `proposal_state_${got.proposal.state}`,
          };
        }
        const order = _safeParseJcs(got.proposal.payloadJcs);
        const finalizeRes = mgr.finalize(msg.proposalId);
        if (!finalizeRes.ok) {
          return { status: "error", reason: finalizeRes.reason };
        }
        return { status: "consumed", proposalId: msg.proposalId, order };
      } finally {
        close();
      }
    },
  };
}

module.exports = {
  createMultisigHandlers,
  shapeProposalForList,
  shapeProposalDetail,
  MULTISIG_PURCHASE_DOMAIN,
};
