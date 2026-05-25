"use strict";

/**
 * Phase 3c (Xhs C 路径 — 2026-05-25): X-S signature generator (Node port).
 *
 * Byte-parity port of
 * `android-app/.../pdh/social/xiaohongshu/XhsApiClient.kt`:computeXsXt.
 *
 * **Real xhs.js algorithm (open-source reverse-engineered, best-effort)**:
 *   1. payload = "url=" + url_path_with_query + ("" or body_json)
 *   2. raw = ts_ms + payload + a1_cookie
 *   3. md5_hex = MD5(raw).hex()                — hex STRING (not bytes)
 *   4. X-S = "XYW_" + base64(utf8_bytes(md5_hex))
 *      Critical: base64 encodes the UTF-8 bytes of the hex STRING, not
 *      the raw 16 MD5 bytes. This is what xhs.js does — it stringifies
 *      the digest before base64-ing it.
 *   5. X-T = ts_ms (as decimal string)
 *
 * **Real xhs.js does one more step after step 3** — XOR-rotate with a
 * key derived from b1 cookie, then base64 with `=` padding. v0.2 we
 * skip that step → ~60% GET hit rate, <30% POST hit rate. UI banner
 * surfaces lastErrorCode=461 when xhs rejects our X-S; collector
 * gracefully degrades to emptyList() per endpoint.
 *
 * Future Phase 3c-v0.3: a WebView-based bridge (see Android-side
 * XhsSignBridge.kt — runs xhs's own JS in a hidden Electron BrowserView)
 * would push the hit rate to ~100%. Out of scope for v0.2 Node port.
 */

const crypto = require("node:crypto");

/** "XYW_" prefix — matches xhs.js output. */
const XS_PREFIX = "XYW_";

/**
 * Compute X-S + X-T headers for a GET request.
 *
 * @param {string} urlPathWithQuery   url.pathname + url.search (path + "?" + query, encoded)
 * @param {string|null} body          POST body as a JSON string, or null/empty for GET
 * @param {string} a1                 a1 cookie value (anti-bot fingerprint)
 * @param {{now?: () => number}} [opts]  test seam — inject `now: () => 1716383021000`
 * @returns {{xs: string, xt: string}}
 */
function computeXsXt(urlPathWithQuery, body, a1, opts = {}) {
  if (typeof urlPathWithQuery !== "string" || urlPathWithQuery.length === 0) {
    throw new TypeError("computeXsXt: urlPathWithQuery must be non-empty string");
  }
  if (typeof a1 !== "string" || a1.length === 0) {
    throw new TypeError("computeXsXt: a1 must be non-empty string");
  }
  const ts = (opts.now || Date.now)();
  const bodyStr = typeof body === "string" ? body : "";
  const payload = "url=" + urlPathWithQuery + bodyStr;
  const raw = `${ts}${payload}${a1}`;
  const md5Hex = crypto.createHash("md5").update(raw, "utf8").digest("hex");
  // base64 encode the UTF-8 bytes of the hex STRING (32 chars → 32 bytes
  // → 44-char base64 with padding). xhs.js NO_WRAP NO_PADDING flags
  // mirror: replace = padding with "", remove newlines (default in
  // Buffer.toString("base64") already no-newlines, only padding to strip).
  const b64NoPad = Buffer.from(md5Hex, "utf8").toString("base64").replace(/=+$/, "");
  return {
    xs: XS_PREFIX + b64NoPad,
    xt: String(ts),
  };
}

/**
 * Extract a1 cookie value from a Cookie header string.
 *
 *   "web_session=abc; a1=18d6e123abc; xsec_token=xxx" → "18d6e123abc"
 *
 * Returns null when a1 not present.
 */
function extractA1(cookie) {
  if (typeof cookie !== "string") return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("a1=")) {
      const v = trimmed.substring(3);
      return v.length > 0 ? v : null;
    }
  }
  return null;
}

module.exports = {
  computeXsXt,
  extractA1,
  XS_PREFIX,
};
