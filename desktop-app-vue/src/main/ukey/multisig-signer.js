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
 * PR1 fully implements 'hex' + 'path'. 'ukey' wired but throws
 * NOT_IMPLEMENTED until PR2 lands the PIN-confirmation contract. 'unified'
 * throws NOT_IMPLEMENTED until PR3 lands the DID↔key index.
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
      let secretKey;
      let usedUkey = false;
      switch (source) {
        case KEY_SOURCES.HEX:
          secretKey = _hexToSecret(params.secretKeyHex);
          break;
        case KEY_SOURCES.PATH:
          secretKey = _pathToSecret(params.keyPath);
          break;
        case KEY_SOURCES.UKEY:
          if (!ukeySigner) {
            const e = new Error(
              "ukey source not wired — pass options.ukeySigner (PR2)",
            );
            e.code = "UKEY_NOT_WIRED";
            throw e;
          }
          // PR2 wire — placeholder seam. We don't have core-multisig API
          // for "signCallback" yet, so PR1 only documents the path.
          usedUkey = true;
          break;
        case KEY_SOURCES.UNIFIED: {
          const e = new Error(
            "unified-key-manager DID↔key lookup not yet implemented (PR3)",
          );
          e.code = "UNIFIED_NOT_IMPLEMENTED";
          throw e;
        }
        default: {
          const e = new Error(`unknown key source: ${source}`);
          e.code = "INVALID_SOURCE";
          throw e;
        }
      }

      if (usedUkey) {
        // PR2 will implement this branch by submitting the canonical
        // signing input to the U-Key hardware and inserting the returned
        // signature through a future core-multisig.signWithExternal API.
        const e = new Error("ukey signing path not landed in PR1");
        e.code = "UKEY_NOT_IMPLEMENTED";
        throw e;
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

module.exports = {
  createMultisigSigner,
  KEY_SOURCES,
  // Exported for unit tests + reuse from CLI plumbing.
  _hexToSecret,
  _pathToSecret,
};
