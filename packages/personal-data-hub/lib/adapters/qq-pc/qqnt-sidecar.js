"use strict";

/**
 * QQ NT collection bridge — invokes the forensics-bridge Python sidecar's
 * `qq_nt.collect` method (skip 1024-byte preamble + SQLCipher-4 decrypt with
 * the qq-win-db-key passphrase + parse c2c/group protobuf message bodies) and
 * returns the decrypted, readable messages to the node adapter.
 *
 * The key is the QQ NT passphrase (a 16-char ASCII string like "5{sww#,6aq=)8=A@"
 * extracted by qq-win-db-key). Pass it as opts.passphrase. Decryption + protobuf
 * text extraction run in Python (cryptography), sidestepping the host-node
 * bs3mc ABI problem (node never opens the encrypted DB).
 *
 * Resolution (overridable for tests / packaging):
 *   - python exe:  opts.pythonExe → env CC_PDH_PYTHON → "python" / "python3"
 *   - bridge dir:  opts.bridgeDir → env CC_PDH_BRIDGE_DIR → sibling package
 */

const path = require("node:path");
const { existsSync } = require("node:fs");

function resolveBridgeDir(explicit) {
  if (explicit) return explicit;
  if (process.env.CC_PDH_BRIDGE_DIR) return process.env.CC_PDH_BRIDGE_DIR;
  // lib/adapters/qq-pc → up to packages/, then sibling bridge package.
  return path.resolve(__dirname, "../../../../personal-data-hub-bridge");
}

function pythonCandidates(explicit) {
  const list = [];
  if (explicit) list.push(explicit);
  if (process.env.CC_PDH_PYTHON) list.push(process.env.CC_PDH_PYTHON);
  list.push(process.platform === "win32" ? "python" : "python3");
  list.push(process.platform === "win32" ? "python3" : "python");
  return [...new Set(list)];
}

/**
 * @param {object} [opts]
 * @param {string} [opts.passphrase]  QQ NT key (ASCII passphrase from qq-win-db-key)
 * @param {string} [opts.key]         alternatively a hex key
 * @param {string} [opts.dbPath]      nt_msg.db path (sidecar auto-discovers if omitted)
 * @param {number} [opts.limit]
 * @param {string} [opts.pythonExe]
 * @param {string} [opts.bridgeDir]
 * @param {number} [opts.timeoutMs]
 * @param {(msg:object)=>void} [opts.onProgress]
 * @param {object} [opts._supervisorFactory]  test seam
 * @returns {Promise<{account:string,messageCount:number,c2c:number,group:number,messages:object[]}>}
 */
async function collectQqNt(opts = {}) {
  const bridgeDir = resolveBridgeDir(opts.bridgeDir);
  const makeSupervisor =
    opts._supervisorFactory ||
    ((command, cwd) => {
      // eslint-disable-next-line global-require
      const { SidecarSupervisor } = require("../../sidecar");
      return new SidecarSupervisor({
        command,
        cwd,
        defaultTimeoutMs: opts.timeoutMs || 120_000,
        healthCheckIntervalMs: 0,
      });
    });

  if (!opts._supervisorFactory && !existsSync(bridgeDir)) {
    const e = new Error(
      `qq-pc: forensics-bridge not found at ${bridgeDir} (set CC_PDH_BRIDGE_DIR)`,
    );
    e.code = "BRIDGE_NOT_FOUND";
    throw e;
  }

  const params = {};
  if (Number.isInteger(opts.limit) && opts.limit > 0) params.limit = opts.limit;
  if (opts.passphrase) params.passphrase = opts.passphrase;
  else if (opts.key) params.key = opts.key;
  if (opts.dbPath) params.db_path = opts.dbPath;

  let lastErr = null;
  for (const py of pythonCandidates(opts.pythonExe)) {
    const sup = makeSupervisor([py, "-m", "forensics_bridge.ipc_server"], bridgeDir);
    try {
      await sup.start({ readyTimeoutMs: opts.readyTimeoutMs || 15_000 });
      const result = await sup.invoke("qq_nt.collect", params, {
        timeoutMs: opts.timeoutMs || 120_000,
        onProgress: opts.onProgress,
      });
      try { await sup.stop(); } catch (_e) { /* best-effort */ }
      return result;
    } catch (err) {
      lastErr = err;
      try { await sup.stop(); } catch (_e) { /* best-effort */ }
      const msg = (err && err.message) || "";
      // Real QQ-side failures (key/db) surface immediately; sidecar-availability
      // problems (missing python / cryptography / spawn death) → try next python.
      const isDataError = /KEY_REQUIRED|KEY_VERIFY|APP_NOT|DB_TOO|BAD_LAYOUT/i.test(msg);
      if (isDataError) throw err;
    }
  }
  const e = new Error(
    `qq-pc: could not run forensics-bridge sidecar (tried ${pythonCandidates(opts.pythonExe).join(", ")}). ` +
      `Install Python 3.11+ with 'cryptography', or set CC_PDH_PYTHON. Last error: ${lastErr && lastErr.message}`,
  );
  e.code = "SIDECAR_UNAVAILABLE";
  throw e;
}

module.exports = { collectQqNt, _internals: { resolveBridgeDir, pythonCandidates } };
