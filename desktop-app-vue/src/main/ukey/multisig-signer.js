/**
 * MultisigSigner — middleware between multisig proposals and key sources.
 *
 * #21 B.1 Layer 1 PR1 (2026-05-15).
 *
 * Renderer-facing service that signs a multisig proposal on behalf of a
 * specific signer DID without exposing raw private key material to the
 * renderer. Mirrors the existing `cc multisig sign --signer <did> --key <hex|path>`
 * CLI flow but routes through a key source abstraction so:
 *
 *   - source = 'hex'      → caller supplies hex secret directly (back-compat
 *                           CLI semantics; renderer should NEVER pass this)
 *   - source = 'path'     → caller supplies a file path containing hex
 *   - source = 'ukey'     → delegates to ukey-ipc / U-Key hardware (PR2 will
 *                           ship the full PIN flow; PR1 ships the seam)
 *   - source = 'unified'  → query unified-key-manager by signer DID (PR3 —
 *                           requires DID↔key mapping table column first)
 *
 * PR1 fully implements 'hex' + 'path'.
 * PR2a (2026-05-15) wires 'ukey' via core-multisig.signWithExternal — caller
 * provides `ukeySigner(canonicalBytes, alg) → Promise<Buffer>` callback;
 * secretKey never crosses the IPC boundary. PR2b ships PIN/Biometric prompt
 * + SignProposalModal.vue.
 * PR3 (2026-05-15) wires 'unified' via UnifiedKeyManager.findKeyForDid(did) —
 * when the bound entry has source==='ukey', signing delegates to the same
 * ukeySigner callback used by source='ukey'. Software-stored secrets remain
 * out of scope (no encrypted secret store today).
 *
 * Lives next to unified-key-manager so future PR3 can inject that manager
 * via factory rather than reaching across the main process tree.
 *
 * @module ukey/multisig-signer
 * @version 0.1.0 (#21 B.1 PR1)
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const MULTISIG_RUNTIME_REL =
  "../../../../../packages/cli/src/lib/multisig-runtime.js";

/** Whitelisted sources keep typo-safety on the renderer wire. */
const KEY_SOURCES = Object.freeze({
  HEX: "hex",
  PATH: "path",
  UKEY: "ukey",
  UNIFIED: "unified",
});

/**
 * Convert a hex string to a Buffer. Throws on non-hex input — the CLI does
 * the same so behavior matches `cc multisig sign`.
 */
function _hexToSecret(hex) {
  if (typeof hex !== "string" || !hex) {
    const e = new Error("hex secret required");
    e.code = "INVALID_KEY";
    throw e;
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    const e = new Error("hex secret malformed");
    e.code = "INVALID_KEY";
    throw e;
  }
  return Buffer.from(hex, "hex");
}

/**
 * Resolve a file path to a Buffer of hex bytes. Refuses to read paths that
 * do not exist or are not regular files (no symlink dereference into
 * surprises).
 */
function _pathToSecret(p) {
  if (typeof p !== "string" || !p) {
    const e = new Error("key path required");
    e.code = "INVALID_KEY_PATH";
    throw e;
  }
  if (!fs.existsSync(p)) {
    const e = new Error(`key file does not exist: ${p}`);
    e.code = "KEY_PATH_NOT_FOUND";
    throw e;
  }
  const stat = fs.statSync(p);
  if (!stat.isFile()) {
    const e = new Error(`key path is not a regular file: ${p}`);
    e.code = "KEY_PATH_NOT_FILE";
    throw e;
  }
  const raw = fs.readFileSync(p, "utf-8").trim();
  return _hexToSecret(raw);
}

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
 * Build a MultisigSigner instance.
 *
 * `options.runtimeFactory` overrides the multisig-runtime import — tests
 * inject a fake openMultisigManager so they can run without SQLite. The
 * production path leaves this unset.
 *
 * `options.ukeySigner` is reserved for PR2: a `(input, alg) => Promise<Buffer>`
 * function that delegates to U-Key hardware via the existing `ukey:sign`
 * IPC channel. PR1 throws when source='ukey'; PR2 wires the real callback.
 *
 * @param {object} [options]
 * @param {() => Promise<{ openMultisigManager: Function }>} [options.runtimeFactory]
 * @param {(input: Buffer, alg: string) => Promise<Buffer>} [options.ukeySigner]
 * @returns {{ signProposal: Function, KEY_SOURCES: object }}
 */
function createMultisigSigner(options = {}) {
  const factory = options.runtimeFactory ?? _loadRuntime;
  const ukeySigner = options.ukeySigner ?? null;
  // #21 B.1 PR3 — optional UnifiedKeyManager for source='unified' DID routing.
  // When null, source='unified' throws UNIFIED_NOT_WIRED.
  const unifiedKeyManager = options.unifiedKeyManager ?? null;

  /**
   * Sign a pending multisig proposal on behalf of `signerDid`.
   *
   * Source-dispatch table:
   *   source='hex'      → params.secretKeyHex (string, [0-9a-fA-F]+)
   *   source='path'     → params.keyPath      (string, regular file w/ hex)
   *   source='ukey'     → PR2 — requires ukeySigner wired
   *   source='unified'  → PR3 — requires DID↔key index
   *
   * Returns the same shape as `mgr.sign(...)`:
   *   { accepted: boolean, reachedThreshold: boolean, reason?: string }
   *
   * Errors are converted to `{accepted: false, reason: ...}` for caller
   * consistency; only unrecoverable plumbing errors (factory failure,
   * INVALID_KEY) throw.
   *
   * @param {{ proposalId: string, signerDid: string, alg?: string,
   *           source: string, params?: object }} input
   */
  async function signProposal(input = {}) {
    if (!input.proposalId || typeof input.proposalId !== "string") {
      const e = new Error("signProposal: proposalId required");
      e.code = "INVALID_ARGS";
      throw e;
    }
    if (!input.signerDid || typeof input.signerDid !== "string") {
      const e = new Error("signProposal: signerDid required");
      e.code = "INVALID_ARGS";
      throw e;
    }
    const alg = input.alg || "Ed25519";
    const source = input.source || KEY_SOURCES.HEX;
    const params = input.params || {};

    const runtime = await factory();
    const { mgr, close } = await runtime.openMultisigManager();
    try {
      // PR2a — ukey source goes through mgr.signWithExternal which does
      // NOT take a secretKey; the callback is the boundary. hex/path still
      // resolve to a Buffer and go through mgr.sign synchronously.
      if (source === KEY_SOURCES.UKEY) {
        if (!ukeySigner) {
          const e = new Error(
            "ukey source not wired — pass options.ukeySigner (PR2b)",
          );
          e.code = "UKEY_NOT_WIRED";
          throw e;
        }
        return await mgr.signWithExternal({
          proposalId: input.proposalId,
          signer: { did: input.signerDid, alg },
          signCallback: ukeySigner,
        });
      }

      // PR3 — unified source: look up DID via UnifiedKeyManager, then
      // delegate to the appropriate key path. Today only entry.source==='ukey'
      // is wired (delegates to ukeySigner); software-stored secrets would
      // need an encrypted secret store which doesn't exist yet.
      if (source === KEY_SOURCES.UNIFIED) {
        if (!unifiedKeyManager) {
          const e = new Error(
            "unified source not wired — pass options.unifiedKeyManager (PR3)",
          );
          e.code = "UNIFIED_NOT_WIRED";
          throw e;
        }
        const entry = await unifiedKeyManager.findKeyForDid(input.signerDid);
        if (!entry) {
          const e = new Error(
            `unified-key-manager has no entry for DID: ${input.signerDid}`,
          );
          e.code = "UNIFIED_DID_NOT_FOUND";
          throw e;
        }
        // entry.source values: 'ukey' / 'simkey' / 'tee' / 'software'.
        // Only 'ukey' is wired in PR3 (delegates to existing ukeySigner).
        if (entry.source === "ukey") {
          if (!ukeySigner) {
            const e = new Error(
              "unified DID routed to ukey but ukeySigner not wired",
            );
            e.code = "UKEY_NOT_WIRED";
            throw e;
          }
          return await mgr.signWithExternal({
            proposalId: input.proposalId,
            signer: { did: input.signerDid, alg },
            signCallback: ukeySigner,
          });
        }
        const e = new Error(
          `unified-key-manager entry source='${entry.source}' not yet wired (PR3+: needs encrypted secret store)`,
        );
        e.code = "UNIFIED_SOURCE_NOT_IMPLEMENTED";
        throw e;
      }

      let secretKey;
      switch (source) {
        case KEY_SOURCES.HEX:
          secretKey = _hexToSecret(params.secretKeyHex);
          break;
        case KEY_SOURCES.PATH:
          secretKey = _pathToSecret(params.keyPath);
          break;
        default: {
          const e = new Error(`unknown key source: ${source}`);
          e.code = "INVALID_SOURCE";
          throw e;
        }
      }

      const result = mgr.sign({
        proposalId: input.proposalId,
        signer: { did: input.signerDid, alg, secretKey },
      });
      return result;
    } finally {
      close();
    }
  }

  return { signProposal, KEY_SOURCES };
}

/**
 * #21 B.1 PR2b — adapt main-process `ukeyManager.sign(data)` into the
 * `signCallback(bytes, alg) → Promise<Buffer>` shape required by
 * `core-multisig.signWithExternal` / `MultisigSigner.source='ukey'`.
 *
 * Driver return shapes vary (Windows hardware vs simulation vs
 * cross-platform adapter). This wrapper normalises:
 *
 *   - Direct Buffer            → return as-is
 *   - { signature: Buffer }    → return result.signature
 *   - { signature: hex string }→ Buffer.from(hex, 'hex')
 *   - { signature: base64 }    → Buffer.from(base64, 'base64')  (fallback)
 *   - { success: false, ... }  → throw with reason+message
 *   - { sig: ... }             → same lookup as signature
 *   - anything else            → throw 'unexpected_ukey_result'
 *
 * The `alg` argument is forwarded to the driver via the data envelope
 * (driver-specific) when the driver exposes a sig-with-alg API; today's
 * adapters ignore alg, so the wrapper just passes the bytes through.
 *
 * Throws on any failure so `mgr.signWithExternal` catches it and returns
 * `{accepted: false, reason: 'sign_callback_failed', detail: <message>}`.
 *
 * @param {object} ukeyManager - main-process UKey singleton (sign(data)→Result)
 * @returns {(bytes: Buffer, alg: string) => Promise<Buffer>}
 */
function buildUkeyManagerSigner(ukeyManager) {
  if (!ukeyManager || typeof ukeyManager.sign !== "function") {
    throw new TypeError(
      "buildUkeyManagerSigner: ukeyManager.sign(data) function required",
    );
  }
  return async function ukeySign(bytes /* , alg */) {
    const result = await ukeyManager.sign(bytes);
    // Driver might return Buffer directly (no envelope).
    if (Buffer.isBuffer(result)) {
      return result;
    }
    if (!result || typeof result !== "object") {
      const e = new Error(
        `unexpected_ukey_result: ${typeof result}=${String(result).slice(0, 80)}`,
      );
      e.code = "UKEY_BAD_RESULT";
      throw e;
    }
    if (result.success === false) {
      const e = new Error(
        result.message || result.reason || "ukey_sign_failed",
      );
      e.code = result.reason || "UKEY_SIGN_FAILED";
      throw e;
    }
    const sig = result.signature ?? result.sig ?? result.data;
    if (Buffer.isBuffer(sig)) {
      return sig;
    }
    if (typeof sig === "string") {
      // Heuristic: lowercase hex only (drivers conventionally emit lowercase).
      // Uppercase chars / '+' / '/' / '=' fall to base64. Empty length odd → fail.
      if (/^[0-9a-f]+$/.test(sig) && sig.length % 2 === 0 && sig.length >= 2) {
        return Buffer.from(sig, "hex");
      }
      return Buffer.from(sig, "base64");
    }
    const e = new Error(
      `unexpected_ukey_result: no signature field (keys: ${Object.keys(result).join(",")})`,
    );
    e.code = "UKEY_BAD_RESULT";
    throw e;
  };
}

module.exports = {
  createMultisigSigner,
  buildUkeyManagerSigner,
  KEY_SOURCES,
  // Exported for unit tests + reuse from CLI plumbing.
  _hexToSecret,
  _pathToSecret,
};
