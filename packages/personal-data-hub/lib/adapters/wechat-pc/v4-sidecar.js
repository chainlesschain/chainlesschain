"use strict";

/**
 * WeChat 4.x collection bridge — invokes the forensics-bridge Python sidecar's
 * `wechat_v4.collect` method (memory key extraction + SQLCipher-4 decryption +
 * Msg_<md5> parsing) and returns the decrypted messages to the node adapter.
 *
 * Why a sidecar: WeChat 4.0 DBs are SQLCipher-4 encrypted with a key cached in
 * Weixin.exe process memory. Recovering it needs ReadProcessMemory (Windows)
 * and AES/PBKDF2 — done in Python (`cryptography`), which also sidesteps the
 * host-node bs3mc ABI problem (the node side never opens the encrypted DB).
 *
 * Resolution (all overridable for tests / packaging):
 *   - python exe:  opts.pythonExe → env CC_PDH_PYTHON → "python" / "python3"
 *   - bridge dir:  opts.bridgeDir → env CC_PDH_BRIDGE_DIR → sibling package
 *
 * Returns the sidecar result `{ account, messageCount, dbs, messages }`.
 * Throws a typed Error (code on .code) the adapter maps to a sync failure.
 */

const path = require("node:path");
const { existsSync } = require("node:fs");

function resolveBridgeDir(explicit) {
  if (explicit) return explicit;
  if (process.env.CC_PDH_BRIDGE_DIR) return process.env.CC_PDH_BRIDGE_DIR;
  // lib/adapters/wechat-pc → up to packages/, then sibling bridge package.
  return path.resolve(__dirname, "../../../../personal-data-hub-bridge");
}

function pythonCandidates(explicit) {
  const list = [];
  if (explicit) list.push(explicit);
  if (process.env.CC_PDH_PYTHON) list.push(process.env.CC_PDH_PYTHON);
  // Windows commonly ships `python`; *nix `python3`. Try both.
  list.push(process.platform === "win32" ? "python" : "python3");
  list.push(process.platform === "win32" ? "python3" : "python");
  return [...new Set(list)];
}

/**
 * @param {object} [opts]
 * @param {number} [opts.limit]        max messages
 * @param {string} [opts.key]          pre-extracted 64-hex key (skips memory scan)
 * @param {string} [opts.pythonExe]
 * @param {string} [opts.bridgeDir]
 * @param {number} [opts.timeoutMs]    collect timeout (default 120s)
 * @param {(msg:object)=>void} [opts.onProgress]
 * @param {object} [opts._supervisorFactory]  test seam → returns a SidecarSupervisor-like
 * @returns {Promise<{account:string,messageCount:number,dbs:object[],messages:object[]}>}
 */
async function collectWeChatV4(opts = {}) {
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
      `wechat-pc v4: forensics-bridge not found at ${bridgeDir} (set CC_PDH_BRIDGE_DIR)`,
    );
    e.code = "BRIDGE_NOT_FOUND";
    throw e;
  }

  const params = {};
  if (Number.isInteger(opts.limit) && opts.limit > 0) params.limit = opts.limit;
  if (opts.key) params.key = opts.key;

  let lastErr = null;
  for (const py of pythonCandidates(opts.pythonExe)) {
    const command = [py, "-m", "forensics_bridge.ipc_server"];
    const sup = makeSupervisor(command, bridgeDir);
    try {
      await sup.start({ readyTimeoutMs: opts.readyTimeoutMs || 15_000 });
      const result = await sup.invoke("wechat_v4.collect", params, {
        timeoutMs: opts.timeoutMs || 120_000,
        onProgress: opts.onProgress,
      });
      try { await sup.stop(); } catch (_e) { /* best-effort */ }
      return result;
    } catch (err) {
      lastErr = err;
      try { await sup.stop(); } catch (_e) { /* best-effort */ }
      const msg = (err && err.message) || "";
      // Real WeChat-side failures (key/app/db) must surface immediately — the
      // sidecar ran fine, the data just isn't there. Everything else (python
      // missing, wrong python without `cryptography`, import errors, spawn
      // death, handshake timeout) → try the next python candidate.
      const isDataError = /KEY_NOT_FOUND|KEY_VERIFY|APP_NOT|DB_NOT|APP_NOT_RUNNING|EXTRACT_PERMISSION/i.test(msg);
      if (isDataError) throw err;
      // otherwise fall through to the next candidate
    }
  }
  const e = new Error(
    `wechat-pc v4: could not run forensics-bridge sidecar (tried ${pythonCandidates(opts.pythonExe).join(", ")}). ` +
      `Install Python 3.11+ with the 'cryptography' package, or set CC_PDH_PYTHON. Last error: ${lastErr && lastErr.message}`,
  );
  e.code = "SIDECAR_UNAVAILABLE";
  throw e;
}

module.exports = { collectWeChatV4, _internals: { resolveBridgeDir, pythonCandidates } };
