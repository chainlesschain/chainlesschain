/**
 * `llm.apiKeyHelper` (gap-analysis 2026-07-11 P0 "依赖安装与凭据"): fetch the
 * LLM API key from an external command instead of storing it in plaintext
 * config.json. Point it at your OS credential store, e.g.:
 *
 *   Windows :  "powershell -NoProfile -Command \"...CredentialManager...\""
 *   macOS   :  "security find-generic-password -s cc-llm -w"
 *   Linux   :  "secret-tool lookup service cc-llm"
 *
 * Resolution precedence stays: --api-key > CC_API_KEY > config llm.apiKey >
 * llm.apiKeyHelper. The helper's stdout (trimmed) is the key; a failing or
 * empty helper resolves null so the run fails with the provider's own
 * missing-key error (never a silent fallback — see the no-silent-substitution
 * rule). Cached per process (5 min) so multi-call runs don't re-spawn it.
 */

import { execSync } from "node:child_process";

const TTL_MS = 5 * 60 * 1000;
const _cache = new Map(); // helper command → { key, at }
let _warnedFailure = false;

/**
 * @param {string} helperCmd  shell command printing the key on stdout
 * @param {{exec?:Function, now?:()=>number, writeErr?:(s:string)=>void}} [opts]
 * @returns {string|null}
 */
export function resolveApiKeyFromHelper(helperCmd, opts = {}) {
  const cmd = typeof helperCmd === "string" ? helperCmd.trim() : "";
  if (!cmd) return null;
  const now = opts.now || Date.now;
  const hit = _cache.get(cmd);
  if (hit && now() - hit.at < TTL_MS) return hit.key;
  const exec = opts.exec || execSync;
  try {
    const out = exec(cmd, {
      encoding: "utf-8",
      timeout: 10000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const key = String(out || "").trim();
    if (!key) return null;
    _cache.set(cmd, { key, at: now() });
    return key;
  } catch (err) {
    // Warn once per process, then stay quiet — the provider's missing-key
    // error is the actionable surface.
    if (!_warnedFailure) {
      _warnedFailure = true;
      const writeErr = opts.writeErr || ((s) => process.stderr.write(s));
      writeErr(`[api-key-helper] llm.apiKeyHelper failed: ${err.message}\n`);
    }
    return null;
  }
}

/** Test seam: drop the per-process cache + warn-once latch. */
export function clearApiKeyHelperCache() {
  _cache.clear();
  _warnedFailure = false;
}
