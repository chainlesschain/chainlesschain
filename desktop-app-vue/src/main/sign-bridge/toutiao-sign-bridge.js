"use strict";

/**
 * Phase 6c (2026-05-25) — Toutiao `_signature` provider using Electron
 * WebContentsView.
 *
 * Node port of `android-app/.../pdh/social/toutiao/ToutiaoSignBridge.kt`.
 * Unlike Xhs (header signing), Toutiao mutates the URL by appending
 * `?_signature=<value>` — `signUrl` is the entrypoint, `signedHeaders`
 * stays as the base no-op.
 *
 * **Function-name rotation**: ByteDance attaches the signer to one of a
 * rotating set of globals; we probe in order. Verified 2026-05-24 against
 * live www.toutiao.com:
 *   1. `window.byted_acrawler.sign({url, aid, platform})` — current as of
 *      2026-05. Returns either a bare string OR `{_signature: "..."}`.
 *   2. `window._0x32d839(url)` — older naked-string variant, still seen on
 *      some user-agents.
 *   3. `window.acrawler.sign(url)` — initial public name, last-resort.
 *
 * **Output decode**: JS may return a bare base64-ish string (raw sig
 * value) OR an object `{_signature: "..."}`. We normalize to a URL with
 * `?_signature=<value>` query parameter appended.
 *
 * **Why URL mutation, not headers**: Toutiao's `_signature` is part of
 * the URL signature (encoded into query — server validates request URL
 * matches signature). Cannot be moved to headers without breaking the
 * validation.
 */

const { ElectronWebSignBridge } = require("./electron-web-sign-bridge");

class ToutiaoSignBridge extends ElectronWebSignBridge {
  constructor(opts = {}) {
    super(opts);
  }

  get homepageUrl() {
    return "https://www.toutiao.com/";
  }

  get cookieDomain() {
    // Leading dot enables matching for www.toutiao.com / sf.toutiao.com /
    // www.ixigua.com etc. (Toutiao's acrawler is shared across the family).
    return ".toutiao.com";
  }

  /**
   * acrawler.js finishes init via setTimeout chain after did-finish-load.
   * Android measurements (Xiaomi 24115RA8EC) showed 1100-1800ms; Electron
   * desktop is similar. 2500ms gives a safety margin without sacrificing
   * UX.
   */
  get postLoadDelayMs() {
    return 2500;
  }

  /**
   * Build JS probing 3 candidate globals (rotation history). All return
   * either a bare string (the sig value) OR an object containing
   * `_signature` field. We JSON.stringify objects so the bridge's eval
   * returns a string we can parse in [signUrl].
   *
   * @param {string} rawUrl  full URL string to sign
   * @param {string} _purpose  ignored — Toutiao signs the whole URL
   */
  buildSignScript(rawUrl, _purpose) {
    const urlJs = JSON.stringify(rawUrl);
    const argsJs = JSON.stringify({
      url: rawUrl,
      aid: AID_TOUTIAO_WEB,
      platform: "PC",
    });
    return `
      (function() {
        try {
          // Candidate 1: byted_acrawler.sign({url, aid, platform}) — 2026-05 current
          if (window.byted_acrawler && typeof window.byted_acrawler.sign === 'function') {
            var r = window.byted_acrawler.sign(${argsJs});
            if (typeof r === 'string') return r;
            if (r && typeof r === 'object' && r._signature) return r._signature;
            if (r && typeof r === 'object') return JSON.stringify(r);
          }
          // Candidate 2: _0x32d839(url) — older obfuscated name
          if (typeof window._0x32d839 === 'function') {
            return window._0x32d839(${urlJs});
          }
          // Candidate 3: acrawler.sign(url) — initial public name
          if (window.acrawler && typeof window.acrawler.sign === 'function') {
            return window.acrawler.sign(${urlJs});
          }
          return null;
        } catch (e) {
          return null;
        }
      })();
    `.trim();
  }

  /**
   * Sign the URL by appending `?_signature=<value>` (or `&_signature=...`
   * if existing query). Returns null on bridge cold / rotation / JS error.
   *
   * @param {URL|string} rawUrl
   * @param {string} purpose  passed through to [buildSignScript] (unused)
   * @returns {Promise<URL|null>}
   */
  async signUrl(rawUrl, purpose) {
    const urlStr = String(rawUrl);
    const result = await this._eval(urlStr, purpose);
    if (!result) {
      return null;
    }
    // Decode: either a bare string sig OR a JSON-encoded object.
    let signature = null;
    const trimmed = result.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && parsed._signature) {
          signature = String(parsed._signature);
        }
      } catch {
        // Fall through — treat the whole string as the sig value.
      }
    }
    if (!signature) {
      // Treat as bare sig value. Filter obvious junk (empty / 'null' /
      // whitespace) so we don't append garbage to the URL.
      if (
        trimmed === "null" ||
        trimmed === "undefined" ||
        trimmed.length === 0
      ) {
        return null;
      }
      signature = trimmed;
    }
    // Append/replace _signature query param. URL handles encoding.
    const url = new URL(urlStr);
    url.searchParams.set("_signature", signature);
    return url;
  }

  /**
   * Toutiao signs URLs only — headers stay unchanged. Returns `{}`.
   */
  async signedHeaders(_rawUrl, _purpose) {
    return {};
  }

  /**
   * Phase 6e — return JSON-stringified candidate presence map for the
   * 3 known Toutiao signing globals.
   */
  get probeScript() {
    return `JSON.stringify({
      'byted_acrawler.sign': !!(window.byted_acrawler && typeof window.byted_acrawler.sign === 'function'),
      _0x32d839: typeof window._0x32d839 === 'function',
      'acrawler.sign': !!(window.acrawler && typeof window.acrawler.sign === 'function')
    });`;
  }
}

/** Toutiao web client id (Douyin web = 2906). */
const AID_TOUTIAO_WEB = "24";

module.exports = {
  ToutiaoSignBridge,
  // Exposed for unit testing
  _internals: {
    AID_TOUTIAO_WEB,
  },
};
