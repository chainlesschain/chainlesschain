"use strict";

/**
 * Phase 6a (2026-05-25) — Xhs (Xiaohongshu) X-S / X-T / X-S-Common
 * provider using Electron WebContentsView.
 *
 * Node port of `android-app/.../pdh/social/xiaohongshu/XhsSignBridge.kt`.
 * Replaces the in-process best-effort `computeXsXt` (~60% GET / <30%
 * POST) with bridge-based signing using xhs's own `_webmsxyw` /
 * `xhs.sign` globals → ~100% hit rate.
 *
 * **Why a bridge for Xhs**:
 *  - xhs.js rotates the signing global name every 6-8 weeks (verified
 *    against archived bundles): observed `_webmsxyw`, `webmsxyw`,
 *    `xhs.sign`, and `_b8` at different times.
 *  - The real algorithm has a multi-stage XOR-with-rotating-key step
 *    after MD5 that uses runtime state we can't reproduce in Node.
 *
 * Output: xhs's signing function returns
 *   `{X-s: "XYW_...", X-t: <ms>, X-s-common: "..."}`
 * We ship every header xhs gives us (X-s-common required by some POST
 * endpoints).
 *
 * URL form: X-s/X-t are HEADERS only — `signUrl` returns null (this
 * bridge uses `signedHeaders`).
 */

const { ElectronWebSignBridge } = require("./electron-web-sign-bridge");

class XhsSignBridge extends ElectronWebSignBridge {
  constructor(opts = {}) {
    super(opts);
  }

  get homepageUrl() {
    return "https://www.xiaohongshu.com/explore";
  }

  get cookieDomain() {
    return ".xiaohongshu.com";
  }

  /**
   * xhs.js bootstraps its signer via an async XHR to
   * /api/sns/web/v1/login/session-init after did-finish-load. That XHR
   * sets a session secret used in the X-S computation. 2500ms gives
   * the XHR time on a typical 4G connection; verified in archived
   * xhs.js init traces.
   */
  get postLoadDelayMs() {
    return 2500;
  }

  /**
   * Build the JS that probes 4 candidate signing globals (rotation
   * history-driven). Returns `JSON.stringify(headers)` so we can
   * decode in [signedHeaders], or null on every candidate failing.
   *
   * @param {string} _rawUrl  unused — Xhs passes path+body via purpose
   * @param {string} purpose  "<pathWithQuery>|<bodyJsonOrEmpty>"
   */
  buildSignScript(_rawUrl, purpose) {
    const pipe = purpose.indexOf("|");
    const pathWithQuery = pipe >= 0 ? purpose.substring(0, pipe) : purpose;
    const body = pipe >= 0 ? purpose.substring(pipe + 1) : "";
    const pathJs = JSON.stringify(pathWithQuery);
    const bodyJs = JSON.stringify(body);
    return `
      (function() {
        try {
          // Candidate 1: _webmsxyw (most common, 2024-2026 builds)
          if (typeof window._webmsxyw === 'function') {
            var r = window._webmsxyw(${pathJs}, ${bodyJs});
            if (r && typeof r === 'object') return JSON.stringify(r);
            if (typeof r === 'string') return r;
          }
          // Candidate 2: bare webmsxyw (no underscore — early-2025 rotation)
          if (typeof window.webmsxyw === 'function') {
            var r2 = window.webmsxyw(${pathJs}, ${bodyJs});
            if (r2 && typeof r2 === 'object') return JSON.stringify(r2);
            if (typeof r2 === 'string') return r2;
          }
          // Candidate 3: xhs.sign namespace (2023 era, sometimes restored)
          if (window.xhs && typeof window.xhs.sign === 'function') {
            var r3 = window.xhs.sign(${pathJs}, ${bodyJs});
            if (r3 && typeof r3 === 'object') return JSON.stringify(r3);
            if (typeof r3 === 'string') return r3;
          }
          // Candidate 4: _b8.xs (obfuscated build artifact, fallback)
          if (window._b8 && typeof window._b8.xs === 'function') {
            var r4 = window._b8.xs(${pathJs}, ${bodyJs});
            if (r4 && typeof r4 === 'object') return JSON.stringify(r4);
            if (typeof r4 === 'string') return r4;
          }
          return null;
        } catch (e) {
          return null;
        }
      })();
    `.trim();
  }

  /**
   * URL is unchanged — Xhs uses headers only. Always returns null.
   * `signedHeaders` is the actual implementation.
   */
  async signUrl(_rawUrl, _purpose) {
    return null;
  }

  /**
   * Return {X-s, X-t, X-s-common} from the WebContentsView's xhs.js, or
   * `{}` if signing failed (cold bridge / rotated globals / xhs JS error).
   *
   * @param {URL|string} rawUrl
   * @param {string} purpose  "<pathWithQuery>|<bodyJsonOrEmpty>"
   * @returns {Promise<{[name: string]: string}>}
   */
  async signedHeaders(rawUrl, purpose) {
    const result = await this._eval(rawUrl, purpose);
    if (!result) {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      // Some xhs builds return a raw string instead of an object — we
      // can't recover headers from a single string, treat as failure.
      return {};
    }
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const out = {};
    // Pick known xhs header keys + variants (X-s vs X-S — both seen)
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (v == null) {
        continue;
      }
      const normalizedKey = normalizeXhsHeader(k);
      if (normalizedKey) {
        out[normalizedKey] = String(v);
      }
    }
    return out;
  }
}

/**
 * Normalize xhs's returned header key to the canonical case we send on
 * the wire. xhs.js sometimes returns `X-s` (lowercase s) — we send
 * `X-s` verbatim (matching what xhs's own front-end does).
 */
function normalizeXhsHeader(key) {
  const lower = String(key).toLowerCase();
  if (lower === "x-s") {
    return "X-s";
  }
  if (lower === "x-t") {
    return "X-t";
  }
  if (lower === "x-s-common") {
    return "X-s-common";
  }
  // Unknown header — let it through verbatim (defensive)
  return key;
}

module.exports = {
  XhsSignBridge,
  // Exposed for unit testing
  _internals: {
    normalizeXhsHeader,
  },
};
