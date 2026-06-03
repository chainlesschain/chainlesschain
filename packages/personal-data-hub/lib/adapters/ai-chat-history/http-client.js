/**
 * HTTP client wrapper used by AI-chat vendor sub-adapters.
 *
 * Three responsibilities:
 *
 *   1. Inject cookies from a CookieAuthSession (per request, per domain).
 *   2. Apply per-vendor `rateLimits` — at least minIntervalMs between calls
 *      and at most perMinute calls in any rolling 60s window. Vendor wiring
 *      shares one HttpClient instance so all its endpoints obey the same gate.
 *   3. Retry on 5xx / network-timeout with bounded exponential backoff.
 *
 * The actual network call is delegated to `opts.fetch` (defaults to global
 * fetch in Node 22+). Tests inject a stub that records requests + returns
 * canned responses, so the whole vendor wiring is verifiable without real
 * cookies / live servers.
 *
 * No external dependency — same pattern as `lib/llm-client.js`.
 */

"use strict";

const DEFAULT_RATE_LIMITS = Object.freeze({
  perMinute: 30,
  minIntervalMs: 1500,
});

class RateLimitedError extends Error {
  constructor(retryAfterMs, vendor) {
    super(`rate limited (vendor=${vendor || "?"}, retryAfterMs=${retryAfterMs})`);
    this.code = "RATE_LIMITED";
    this.retryAfterMs = retryAfterMs;
    this.vendor = vendor;
  }
}

class CookieExpiredError extends Error {
  constructor(vendor, hint) {
    super(`cookie expired or invalid (vendor=${vendor})${hint ? ": " + hint : ""}`);
    this.code = "COOKIE_EXPIRED";
    this.vendor = vendor;
  }
}

class HttpClient {
  /**
   * @param {object} opts
   * @param {string} opts.vendor          Vendor name (for error messages + logs).
   * @param {object} [opts.rateLimits]    { perMinute, minIntervalMs } — defaults to DEFAULT_RATE_LIMITS.
   * @param {function} [opts.fetch]       Fetch impl override. Defaults to global fetch.
   * @param {function} [opts.sleep]       Sleep impl override (test seam). Defaults to setTimeout.
   * @param {function} [opts.now]         Clock override (test seam). Defaults to Date.now.
   * @param {number}   [opts.maxRetries]  Max retries on 5xx / timeout. Default 3.
   * @param {number}   [opts.baseBackoffMs] Initial retry backoff. Default 500.
   * @param {object}   [opts.logger]
   */
  constructor(opts = {}) {
    if (typeof opts.vendor !== "string" || opts.vendor.length === 0) {
      throw new Error("HttpClient: opts.vendor required");
    }
    this.vendor = opts.vendor;
    this.rateLimits = {
      ...DEFAULT_RATE_LIMITS,
      ...(opts.rateLimits || {}),
    };
    this._fetch = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!this._fetch) {
      throw new Error("HttpClient: no fetch available. Node 22+ required, or pass opts.fetch.");
    }
    this._sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this._now = opts.now || (() => Date.now());
    this._maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : 3;
    this._baseBackoffMs = Number.isFinite(opts.baseBackoffMs) ? opts.baseBackoffMs : 500;
    this._logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };

    // Sliding window of recent request timestamps for perMinute enforcement.
    this._recent = [];
    this._lastCallAt = 0;
  }

  /**
   * Make one rate-limited + cookie-injected request. Throws CookieExpiredError
   * on 401/403, RateLimitedError on 429 after exhausting retries, generic
   * Error on other failures.
   *
   * @param {string} url
   * @param {object} [reqInit]
   * @param {CookieAuthSession} [reqInit.session]   Cookies to inject. Must match opts.vendor.
   * @param {string} [reqInit.matchDomain]          Cookie domain filter.
   */
  async request(url, reqInit = {}) {
    await this._enforceRateLimit();

    const headers = { ...(reqInit.headers || {}) };
    if (reqInit.session) {
      if (reqInit.session.vendor !== this.vendor) {
        throw new Error(
          `HttpClient(${this.vendor}): session vendor "${reqInit.session.vendor}" mismatch`,
        );
      }
      reqInit.session.applyTo(headers, reqInit.matchDomain);
    }

    const fetchInit = {
      method: reqInit.method || "GET",
      headers,
      ...(reqInit.body !== undefined ? { body: reqInit.body } : {}),
      ...(reqInit.signal ? { signal: reqInit.signal } : {}),
    };

    let lastErr;
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      let resp;
      try {
        resp = await this._fetch(url, fetchInit);
      } catch (err) {
        lastErr = err;
        if (attempt < this._maxRetries) {
          await this._sleep(this._backoffMs(attempt));
          continue;
        }
        throw err;
      }

      if (resp.status === 401 || resp.status === 403) {
        throw new CookieExpiredError(this.vendor, `HTTP ${resp.status}`);
      }
      if (resp.status === 429) {
        const retryHdr = resp.headers && typeof resp.headers.get === "function"
          ? resp.headers.get("retry-after")
          : null;
        const retryAfterMs = retryHdr ? (Number(retryHdr) * 1000 || this._backoffMs(attempt)) : this._backoffMs(attempt);
        if (attempt < this._maxRetries) {
          this._logger.warn(`[${this.vendor}] 429 retry-after=${retryAfterMs}ms attempt=${attempt}`);
          await this._sleep(retryAfterMs);
          continue;
        }
        throw new RateLimitedError(retryAfterMs, this.vendor);
      }
      if (resp.status >= 500 && resp.status < 600) {
        lastErr = new Error(`HTTP ${resp.status}`);
        if (attempt < this._maxRetries) {
          await this._sleep(this._backoffMs(attempt));
          continue;
        }
        throw lastErr;
      }
      return resp;
    }
    throw lastErr || new Error("HttpClient: exhausted retries");
  }

  /**
   * GET shorthand that decodes JSON.
   */
  async getJson(url, reqInit = {}) {
    const resp = await this.request(url, reqInit);
    if (!resp.ok) {
      throw new Error(`HttpClient(${this.vendor}) GET ${url} → HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async postJson(url, body, reqInit = {}) {
    const headers = { "content-type": "application/json", ...(reqInit.headers || {}) };
    const resp = await this.request(url, { ...reqInit, method: "POST", headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      throw new Error(`HttpClient(${this.vendor}) POST ${url} → HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async _enforceRateLimit() {
    const now = this._now();

    // perMinute window
    if (this.rateLimits.perMinute > 0) {
      const cutoff = now - 60_000;
      this._recent = this._recent.filter((t) => t >= cutoff);
      if (this._recent.length >= this.rateLimits.perMinute) {
        const wait = this._recent[0] + 60_000 - now;
        if (wait > 0) await this._sleep(wait);
      }
    }

    // minIntervalMs between consecutive calls
    if (this.rateLimits.minIntervalMs > 0 && this._lastCallAt > 0) {
      const since = now - this._lastCallAt;
      if (since < this.rateLimits.minIntervalMs) {
        await this._sleep(this.rateLimits.minIntervalMs - since);
      }
    }

    const tick = this._now();
    this._recent.push(tick);
    this._lastCallAt = tick;
  }

  _backoffMs(attempt) {
    // 500 → 1000 → 2000 → 4000 (capped at 4 attempts) + ±20% jitter
    const base = this._baseBackoffMs * Math.pow(2, attempt);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(base + jitter));
  }
}

module.exports = {
  HttpClient,
  RateLimitedError,
  CookieExpiredError,
  DEFAULT_RATE_LIMITS,
};
