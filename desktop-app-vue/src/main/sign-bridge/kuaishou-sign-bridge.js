"use strict";

/**
 * Phase 6d (2026-05-25) — Kuaishou `__NS_sig3` provider using Electron
 * WebContentsView.
 *
 * Node port of `android-app/.../pdh/social/kuaishou/KuaishouSignBridge.kt`.
 *
 * **Unique vs Xhs/Toutiao** — Kuaishou returns BOTH a URL mutation AND
 * extra headers per single sign call:
 *   - `__NS_sig3` → appended as URL query param
 *   - `kpf` / `kpn` → request headers (kpf=PC_WEB, kpn=KUAISHOU_VISION)
 *
 * The api-client calls signUrl(url, purpose) then signedHeaders(url,
 * purpose) sequentially — bridge caches the kpf/kpn from the most
 * recent signUrl(rawUrl) so signedHeaders(sameRawUrl) returns them.
 *
 * **GraphQL POST not REST GET** — `purpose` carries `<queryName>|<bodyJson>`
 * so the JS signer can mix both into the hash input. Body MUST match the
 * actual POST body bytes for the server-side validation to succeed.
 *
 * **Function-name rotation** — 4 candidate globals probed in order:
 *   1. `window.__APP__.encryptParams({url, operationName, body})` — kuaishou
 *      web client app-level helper, current as of 2026-05.
 *   2. `window.NS.sign(...)` — NS namespace, observed in early-2026.
 *   3. `window.GraphQL.fetch.sign(...)` — GraphQL wrapper, older.
 *   4. `window.__SIGN__(...)` — bare global, occasional fallback.
 *
 * postLoadDelayMs=3000 (heavier than acrawler.js — NS_sig3 init does an
 * extra session-secret roundtrip).
 */

const { ElectronWebSignBridge } = require("./electron-web-sign-bridge");

class KuaishouSignBridge extends ElectronWebSignBridge {
  constructor(opts = {}) {
    super(opts);
    // Cache the per-rawUrl headers from the most recent signUrl call so
    // sequential `signUrl` → `signedHeaders` can return them without
    // re-running the JS. api-client uses this pattern verbatim.
    this._lastRawUrl = null;
    this._lastHeaders = {};
  }

  get homepageUrl() {
    return "https://www.kuaishou.com/new-reco";
  }

  get cookieDomain() {
    return ".kuaishou.com";
  }

  /**
   * NS_sig3 init = anti-bot SDK loads + an async XHR fetches a per-session
   * salt. Heavier than acrawler.js — 3000ms gives safety margin.
   */
  get postLoadDelayMs() {
    return 3000;
  }

  /**
   * Build JS probing 4 candidate signers. All accept the same args object
   * (url, operationName, body) and return either a bare string OR object
   * `{__NS_sig3: "...", kpf: "...", kpn: "..."}`.
   *
   * @param {string} rawUrl   full URL with operationName already in query
   * @param {string} purpose  `<queryName>|<bodyJson>`
   */
  buildSignScript(rawUrl, purpose) {
    const pipe = purpose.indexOf("|");
    const queryName = pipe >= 0 ? purpose.substring(0, pipe) : purpose;
    const body = pipe >= 0 ? purpose.substring(pipe + 1) : "{}";
    const argsJs = JSON.stringify({
      url: rawUrl,
      operationName: queryName,
      body,
    });
    return `
      (function() {
        try {
          // Candidate 1: __APP__.encryptParams (2026-05 current)
          if (window.__APP__ && typeof window.__APP__.encryptParams === 'function') {
            var r = window.__APP__.encryptParams(${argsJs});
            if (typeof r === 'string') return r;
            if (r && typeof r === 'object') return JSON.stringify(r);
          }
          // Candidate 2: NS namespace sign
          if (window.NS && typeof window.NS.sign === 'function') {
            var r2 = window.NS.sign(${argsJs});
            return (typeof r2 === 'string') ? r2 : JSON.stringify(r2);
          }
          // Candidate 3: GraphQL fetch wrapper
          if (window.GraphQL && window.GraphQL.fetch &&
              typeof window.GraphQL.fetch.sign === 'function') {
            var r3 = window.GraphQL.fetch.sign(${argsJs});
            return (typeof r3 === 'string') ? r3 : JSON.stringify(r3);
          }
          // Candidate 4: bare __SIGN__ fallback
          if (typeof window.__SIGN__ === 'function') {
            return JSON.stringify(window.__SIGN__(${argsJs}));
          }
          return null;
        } catch (e) {
          return null;
        }
      })();
    `.trim();
  }

  /**
   * Sign the URL by appending `?__NS_sig3=<value>`. Side-effect: caches
   * the kpf/kpn headers from the same sign call so a subsequent
   * `signedHeaders(rawUrl)` can return them without re-eval.
   *
   * @param {URL|string} rawUrl
   * @param {string} purpose  `<queryName>|<bodyJson>`
   * @returns {Promise<URL|null>}
   */
  async signUrl(rawUrl, purpose) {
    const urlStr = String(rawUrl);
    const result = await this._eval(urlStr, purpose);
    if (!result) {
      this._lastRawUrl = urlStr;
      this._lastHeaders = {};
      return null;
    }
    let sigValue = null;
    let kpf = "PC_WEB";
    let kpn = "KUAISHOU_VISION";
    const trimmed = result.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          sigValue = parsed.__NS_sig3 || parsed.NS_sig3 || parsed.sig3 || null;
          if (typeof parsed.kpf === "string" && parsed.kpf) {
            kpf = parsed.kpf;
          }
          if (typeof parsed.kpn === "string" && parsed.kpn) {
            kpn = parsed.kpn;
          }
        }
      } catch {
        // Fall through to treat whole result as bare sig.
      }
    }
    if (!sigValue) {
      // Treat as bare sig value. Filter obvious junk.
      if (
        trimmed === "null" ||
        trimmed === "undefined" ||
        trimmed.length === 0
      ) {
        this._lastRawUrl = urlStr;
        this._lastHeaders = {};
        return null;
      }
      sigValue = trimmed;
    }
    const url = new URL(urlStr);
    url.searchParams.set("__NS_sig3", sigValue);
    this._lastRawUrl = urlStr;
    this._lastHeaders = { kpf, kpn };
    return url;
  }

  /**
   * Return the kpf/kpn headers cached by the most recent signUrl call
   * for this rawUrl. Returns `{}` if the urls don't match — api-client
   * is expected to call signUrl then immediately signedHeaders for the
   * same URL.
   *
   * @param {URL|string} rawUrl
   * @returns {Promise<{[name: string]: string}>}
   */
  async signedHeaders(rawUrl, _purpose) {
    if (String(rawUrl) === this._lastRawUrl) {
      return { ...this._lastHeaders };
    }
    return {};
  }
}

/** GraphQL operation names — purpose prefix when calling sign. */
const OP_FEED_RECOMMEND = "visionFeedRecommend";
const OP_PROFILE_PHOTOS = "visionProfilePhotoList";
const OP_SEARCH_PHOTO = "visionSearchPhoto";

module.exports = {
  KuaishouSignBridge,
  // Exposed for unit testing
  _internals: {
    OP_FEED_RECOMMEND,
    OP_PROFILE_PHOTOS,
    OP_SEARCH_PHOTO,
  },
};
