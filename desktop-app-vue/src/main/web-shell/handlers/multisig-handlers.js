/**
 * `multisig.*` + `marketplace.consume` + `crosschain.bridge.consume` WS handlers.
 *
 * #21 B.2 (削 cc subprocess 冷启) + #21 B.5 Layer 1 PR2 (crosschain outbound)
 *   + #21 B.1 PR1 (web-shell private key signing seam).
 *
 * Replaces `ws.execute('cc …')` subprocess invocations with in-process calls
 * into `@chainlesschain/core-multisig` v0.1.0. asar:true 后子进程冷启
 * 6-10s → in-process <100ms (SQLite open ~20ms + query)。
 *
 * 设计参考 `mtc-status-handlers.js`（同样的 ws.execute → in-process 改造模式，
 * 2026-05-07 v5.0.3.39 落地）。
 *
 * Topics shipped:
 *   multisig.list             store.listProposals({state?, domain?, limit?})
 *   multisig.show             mgr.get(proposalId)
 *   multisig.policy.show      store.getPolicy(domain)
 *   multisig.cancel           mgr.cancel(proposalId, reason?)
 *   multisig.finalize         mgr.finalize(proposalId)
 *   multisig.sweep            mgr.expireStale()
 *   multisig.sign             #21 B.1 PR1 — sign via MultisigSigner middleware
 *   marketplace.consume       domain-gated finalize for marketplace.purchase
 *   crosschain.bridge.consume domain-gated finalize for crosschain.bridge.outbound (#21 B.5 PR2)
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

const { createMultisigSigner } = require("../../ukey/multisig-signer");

const MULTISIG_RUNTIME_REL =
  "../../../../../packages/cli/src/lib/multisig-runtime.js";

/** Mirrors `MULTISIG_DOMAIN` const in packages/cli/src/commands/marketplace.js. */
const MULTISIG_PURCHASE_DOMAIN = "marketplace.purchase";

/** Mirrors `MULTISIG_BRIDGE_OUTBOUND_DOMAIN` in packages/cli/src/commands/crosschain.js (#21 B.5). */
const MULTISIG_BRIDGE_OUTBOUND_DOMAIN = "crosschain.bridge.outbound";

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

  // #21 B.1 PR1 — lazy-built MultisigSigner so tests can inject a custom
  // signer via options.signerFactory; production path reuses the same
  // runtime factory so the underlying SQLite handle is consistent.
  let _cachedSigner = null;
  function _signer() {
    if (_cachedSigner) {
      return _cachedSigner;
    }
    if (typeof options.signerFactory === "function") {
      _cachedSigner = options.signerFactory();
    } else {
      _cachedSigner = createMultisigSigner({ runtimeFactory: factory });
    }
    return _cachedSigner;
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

    "multisig.sign": async (msg = {}) => {
      // #21 B.1 PR1 — accepts {proposalId, signerDid, alg?, source, params}.
      // Renderer-driven sign delegates to MultisigSigner middleware which
      // owns key-source dispatch (hex / path / ukey / unified). Returns
      // the same shape as mgr.sign(...) for renderer code-path uniformity.
      if (!msg.proposalId || typeof msg.proposalId !== "string") {
        const e = new Error("multisig.sign: proposalId required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      if (!msg.signerDid || typeof msg.signerDid !== "string") {
        const e = new Error("multisig.sign: signerDid required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      if (!msg.source || typeof msg.source !== "string") {
        const e = new Error("multisig.sign: source required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      try {
        return await _signer().signProposal({
          proposalId: msg.proposalId,
          signerDid: msg.signerDid,
          alg: msg.alg,
          source: msg.source,
          params: msg.params || {},
        });
      } catch (err) {
        // Domain errors (INVALID_KEY, UKEY_NOT_WIRED, etc.) surface as
        // {accepted:false} so the renderer can render a reason without a
        // raw throw breaking the WS round-trip.
        if (
          err &&
          (err.code === "INVALID_KEY" ||
            err.code === "INVALID_KEY_PATH" ||
            err.code === "KEY_PATH_NOT_FOUND" ||
            err.code === "KEY_PATH_NOT_FILE" ||
            err.code === "UKEY_NOT_WIRED" ||
            err.code === "UKEY_NOT_IMPLEMENTED" ||
            err.code === "UNIFIED_NOT_IMPLEMENTED" ||
            err.code === "INVALID_SOURCE")
        ) {
          return {
            accepted: false,
            reachedThreshold: false,
            reason: err.code,
            detail: err.message,
          };
        }
        throw err;
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

    "crosschain.bridge.consume": async (msg = {}) => {
      if (!msg.proposalId || typeof msg.proposalId !== "string") {
        const e = new Error("crosschain.bridge.consume: proposalId required");
        e.code = "INVALID_ARGS";
        throw e;
      }
      const { mgr, close } = await _open();
      try {
        const got = mgr.get(msg.proposalId);
        if (!got) {
          return { status: "error", reason: "proposal_not_found" };
        }
        if (got.proposal.domain !== MULTISIG_BRIDGE_OUTBOUND_DOMAIN) {
          return {
            status: "error",
            reason: "wrong_domain",
            expected: MULTISIG_BRIDGE_OUTBOUND_DOMAIN,
            actual: got.proposal.domain,
          };
        }
        if (got.proposal.state !== "reached") {
          return {
            status: "error",
            reason: `proposal_state_${got.proposal.state}`,
          };
        }
        const payload = _safeParseJcs(got.proposal.payloadJcs);
        const finalizeRes = mgr.finalize(msg.proposalId);
        if (!finalizeRes.ok) {
          return { status: "error", reason: finalizeRes.reason };
        }
        // NOTE: actual `cc_bridges` SQLite insert happens via the CLI
        // `cc crosschain bridge-consume <proposalId>` invocation (web-shell
        // does not own the crosschain DB handle). Caller renders the payload
        // and prompts the user to run that command, or wires their own
        // bridge executor. Mirrors marketplace.consume's stub semantics.
        return { status: "consumed", proposalId: msg.proposalId, payload };
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
  MULTISIG_BRIDGE_OUTBOUND_DOMAIN,
};
