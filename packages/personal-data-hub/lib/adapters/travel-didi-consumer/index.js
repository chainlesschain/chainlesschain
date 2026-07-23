/**
 * §12.1 Phase 13+ — 滴滴出行 consumer app (com.sdu.didi.psnger) ride adapter.
 * Device-discovered gap (2026-06-15): distinct from travel-didi (滴滴企业版,
 * com.didi.es.psngr). Same ride→car TravelRecord shape, so it REUSES
 * travel-didi's order mapping helpers; only NAME + the consumer order-centre
 * endpoint differ.
 *
 * JSON file import is supported. No endpoint is selected by default; custom
 * live collection requires a caller-supplied ordersUrl and fetchFn captured
 * from an authorized session. sensitivity:"medium" (ride start/end addresses).
 */

"use strict";

const fs = require("node:fs");
const { normalizeTravelRecord } = require("../travel-base");
const { CookieAuth } = require("../shopping-base");
const { orderToRecord, extractOrders, parseRecords } = require("../travel-didi");

const NAME = "travel-didi-consumer";
const VERSION = "0.2.0";

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;

class DidiConsumerAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._dataPath = opts.dataPath || null;
    this._cookieAuth =
      opts.account && opts.account.cookies ? new CookieAuth({ platform: "didi", cookies: opts.account.cookies }) : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider = typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0 ? opts.ordersUrl : null;
    this._liveConfigured = Boolean(this._ordersUrl && typeof opts.fetchFn === "function");

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "import:json",
      "sync:snapshot",
      ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
      "parse:didi-rides",
    ];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: ["didi:orderId / fromAddress / toAddress / departTime / arriveTime / fare / carType"],
      sensitivity: "medium",
      legalGate: false,
    };
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    const filePath = (ctx && ctx.inputPath) || ctx.dataPath || this._dataPath;
    if (filePath) {
      try {
        this._deps.fs.accessSync(filePath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return { ok: false, reason: "INPUT_PATH_UNREADABLE", message: `not readable at ${filePath}: ${err.message}` };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth && !this._liveConfigured) {
      return {
        ok: false,
        reason: "EXPLICIT_ENDPOINT_REQUIRED",
        message: "travel-didi-consumer: live collection requires a captured ordersUrl and fetchFn; JSON import is ready",
      };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      return { ok: true, account: (this.account && this.account.phone) || null, mode: "cookie", unverified: true };
    }
    return { ok: false, reason: "NO_FILE", message: "Select an exported Didi trip JSON file" };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok ? { ok: true, lastChecked: Date.now(), unverified: true } : { ok: false, reason: r.reason, error: r.error };
    }
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (dataPath) {
      if (!this._deps.fs.existsSync(dataPath)) return;
      const text = this._deps.fs.readFileSync(dataPath, "utf-8");
      let records;
      try {
        records = parseRecords(text);
      } catch (err) {
        throw new Error(`DidiConsumerAdapter: parse failed: ${err.message}`);
      }
      for (const r of records) {
        // re-stamp vendor so dedup IDs don't collide with the enterprise adapter
        yield { adapter: NAME, originalId: r.recordId, capturedAt: r.bookedAt || r.departureMs || Date.now(), payload: { record: r } };
      }
      return;
    }
    if (this._cookieAuth && this._liveConfigured) {
      yield* this._syncViaCookie(opts);
      return;
    }
    if (this._cookieAuth) {
      throw new Error("travel-didi-consumer.sync: explicit ordersUrl and fetchFn required for custom live collection");
    }
    throw new Error("travel-didi-consumer.sync: inputPath or dataPath is required");
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const sinceMs = opts.sinceWatermark != null ? parseInt(String(opts.sinceWatermark), 10) || 0 : Date.now() - 365 * 24 * 3600_000;
    const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : DEFAULT_PAGE_SIZE;
    const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : DEFAULT_MAX_PAGES;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    let emitted = 0;
    let pageIndex = 1;
    while (pageIndex <= maxPages) {
      const query = { pageIndex, pageSize, ts: Date.now() };
      let sign = null;
      if (this._signProvider) sign = await this._signProvider({ url: this._ordersUrl, query, cookies });
      const resp = await this._fetchFn({ url: this._ordersUrl, cookies, query, sign });
      const rides = extractOrders(resp);
      if (!rides.length) break;
      let pageHasNew = false;
      let reachedWatermark = false;
      for (const raw of rides) {
        const rec = orderToRecord(raw, { capturedVia: "cookie-api" });
        if (!rec) continue;
        const ts = rec.departureMs || rec.bookedAt || null;
        if (ts && ts < sinceMs) {
          reachedWatermark = true;
          break;
        }
        pageHasNew = true;
        if (emitted >= limit) return;
        yield { adapter: NAME, originalId: rec.recordId, capturedAt: ts || Date.now(), payload: { record: rec } };
        emitted += 1;
      }
      if (reachedWatermark || !pageHasNew || rides.length < pageSize) break;
      pageIndex += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("DidiConsumerAdapter.normalize: raw.payload.record missing");
    }
    return normalizeTravelRecord(raw.payload.record, { adapterName: NAME, adapterVersion: VERSION });
  }
}

async function defaultFetch(_opts) {
  throw new Error("travel-didi-consumer: no fetchFn configured for cookie-api mode");
}

module.exports = { DidiConsumerAdapter, NAME, VERSION };
