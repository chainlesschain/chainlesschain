/**
 * CookieAuthSession — minimal cookie jar + WebView-ingested cookie blob.
 *
 * Phase 10.1 skeleton: this is the place where the parent hub will hand a
 * vendor adapter the cookie blob captured from Electron's webContents.session
 * cookie store. Vendor sub-adapters call `applyTo(headers)` to inject cookies
 * into an outbound fetch.
 *
 * The blob is the raw output of `session.cookies.get({ url })`, i.e. an array
 * of `{ name, value, domain, path, secure, httpOnly, expirationDate? }`.
 * We don't try to be a full RFC 6265 jar — for these vendors the page that
 * issued the cookie and the page we POST back to are always same-origin, so
 * a flat `name=value;` header is enough.
 *
 * Phase 10.2+ will replace this with `tough-cookie` if multi-domain expiry
 * tracking turns out to be required (Coze uses two domains).
 */

"use strict";

class CookieAuthSession {
  /**
   * @param {object} opts
   * @param {string} opts.vendor                   matches a SUPPORTED_VENDORS entry
   * @param {Array<{name:string,value:string,domain?:string,path?:string,expirationDate?:number}>} opts.cookies
   * @param {number} [opts.capturedAt]             unix ms when cookies were captured
   */
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("CookieAuthSession: opts required");
    }
    if (typeof opts.vendor !== "string" || opts.vendor.length === 0) {
      throw new Error("CookieAuthSession: opts.vendor required");
    }
    if (!Array.isArray(opts.cookies)) {
      throw new Error("CookieAuthSession: opts.cookies must be an array");
    }
    this.vendor = opts.vendor;
    this.cookies = opts.cookies.slice();
    this.capturedAt = typeof opts.capturedAt === "number" ? opts.capturedAt : Date.now();
  }

  /**
   * @returns {boolean} true if any cookie carries an explicit expiry that has passed.
   */
  isExpired(nowMs = Date.now()) {
    if (this.cookies.length === 0) return true;
    let sawExpiry = false;
    for (const c of this.cookies) {
      if (typeof c.expirationDate === "number") {
        sawExpiry = true;
        if (c.expirationDate * 1000 <= nowMs) return true;
      }
    }
    return sawExpiry ? false : false; // session-only cookies — caller revalidates via validateCookie()
  }

  /**
   * Returns a Cookie header value: "name1=value1; name2=value2; ...".
   * Filters by optional domain match (suffix) — vendors with multi-domain
   * cookies (coze) call applyTo per host.
   */
  toHeaderValue(matchDomain) {
    const filtered = matchDomain
      ? this.cookies.filter((c) => {
          if (!c.domain) return true;
          const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
          return matchDomain === d || matchDomain.endsWith("." + d);
        })
      : this.cookies;
    return filtered.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /**
   * Mutates `headers` in place: sets `Cookie` from `toHeaderValue(matchDomain)`.
   */
  applyTo(headers, matchDomain) {
    headers.Cookie = this.toHeaderValue(matchDomain);
    return headers;
  }

  /**
   * Get a single cookie value by name. Returns undefined if not present.
   * Used by vendors that need to compute auth tokens from cookie components
   * (e.g. mtop-style sign from `_m_h5_tk`).
   */
  get(name) {
    const c = this.cookies.find((c) => c.name === name);
    return c ? c.value : undefined;
  }

  /**
   * Serialize for vault persistence. Cookie values themselves still need to
   * be encrypted at the vault layer — this method only flattens for storage.
   */
  toJSON() {
    return {
      vendor: this.vendor,
      capturedAt: this.capturedAt,
      cookies: this.cookies,
    };
  }

  static fromJSON(json) {
    return new CookieAuthSession(json);
  }
}

module.exports = { CookieAuthSession };
