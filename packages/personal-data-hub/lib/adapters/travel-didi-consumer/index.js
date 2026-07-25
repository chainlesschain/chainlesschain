/**
 * §12.1 Phase 13+ — 滴滴出行 consumer app (com.sdu.didi.psnger) ride adapter.
 * Device-discovered gap (2026-06-15): distinct from travel-didi (滴滴企业版,
 * com.didi.es.psngr). Same ride→car TravelRecord shape, so it REUSES
 * travel-didi's order mapping helpers; only NAME + the consumer order-centre
 * endpoint differ.
 *
 * JSON file import is supported. No endpoint is selected by default. Custom
 * live collection accepts a one-shot cookie + accountId + sourceUrl from an
 * authorized session, while fetchFn remains constructor-injected by a trusted
 * gateway. sensitivity:"medium" (ride start/end addresses).
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  probeSnapshotFile,
  readBoundedSnapshot,
} = require("../../snapshot-file");
const { buildSourceUrl } = require("../../source-http");
const { SourcePageError, isExplicitFailure } = require("../../source-page");
const { normalizeTravelRecord } = require("../travel-base");
const {
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");
const {
  orderToRecord,
  extractOrders,
  hasOrderList,
  sourcePageState,
  parseRecords,
} = require("../travel-didi");

const NAME = "travel-didi-consumer";
const VERSION = "0.3.0";

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;
const ALLOWED_SOURCE_HOST_SUFFIXES = Object.freeze(["xiaojukeji.com"]);

class DidiConsumerAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "phone",
    ]);
    this._dataPath = opts.dataPath || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "didi", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : null;

    this.name = NAME;
    this.runtimeScopeIdentityKey = "phone";
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "import:json",
      "sync:snapshot",
      "sync:custom-cookie-api",
      "parse:didi-rides",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "didi:orderId / fromAddress / toAddress / departTime / arriveTime / fare / carType",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    const filePath = (ctx && ctx.inputPath) || ctx.dataPath || this._dataPath;
    if (filePath) {
      return probeSnapshotFile(this._deps.fs, filePath, {
        maxBytes: ctx.maxSnapshotBytes,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
      return {
        ok: false,
        reason: "NO_ACCOUNT_ID",
        message:
          "travel-didi-consumer cookie mode requires opts.accountId for an isolated watermark scope",
      };
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "didi",
      identityKey: "phone",
    });
    if (cookieAuth && !resolveOrdersUrl(this._ordersUrl, ctx)) {
      return {
        ok: false,
        reason: "EXPLICIT_ENDPOINT_REQUIRED",
        message:
          "travel-didi-consumer: live collection requires a captured HTTPS sourceUrl; JSON import is ready",
      };
    }
    if (cookieAuth) {
      try {
        validateOrdersUrl(resolveOrdersUrl(this._ordersUrl, ctx));
      } catch (error) {
        return {
          ok: false,
          reason: error.code || "INVALID_SOURCE_URL",
          error: error.message,
        };
      }
      if (this._fetchFn === defaultFetch) {
        return {
          ok: false,
          reason: "CUSTOM_FETCH_REQUIRED",
          message:
            "travel-didi-consumer cookie mode requires an explicitly configured fetchFn for an authorized session",
        };
      }
      const ok = await cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      return {
        ok: true,
        account: (account && (account.phone || account.userId)) || null,
        mode: "cookie",
        unverified: true,
      };
    }
    return {
      ok: false,
      reason: "NO_FILE",
      message: "Select an exported Didi trip JSON file",
    };
  }

  async healthCheck(opts = {}) {
    const result = await this.authenticate(opts);
    return result.ok
      ? {
          ok: true,
          lastChecked: Date.now(),
          ...(result.unverified ? { unverified: true } : {}),
        }
      : {
          ok: false,
          reason: result.reason,
          error: result.error || result.message,
          lastChecked: Date.now(),
        };
  }

  async *sync(opts = {}) {
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (dataPath) {
      const text = readBoundedSnapshot(this._deps.fs, dataPath, {
        maxBytes: opts.maxSnapshotBytes,
      });
      let records;
      try {
        records = parseRecords(text);
      } catch (err) {
        throw new Error(`DidiConsumerAdapter: parse failed: ${err.message}`);
      }
      for (const r of records) {
        // re-stamp vendor so dedup IDs don't collide with the enterprise adapter
        yield {
          adapter: NAME,
          originalId: r.recordId,
          capturedAt: r.bookedAt || r.departureMs || Date.now(),
          payload: { record: r },
        };
      }
      return;
    }
    if (this._cookieAuth || hasRuntimeCookie(opts)) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error(
      "travel-didi-consumer.sync: inputPath/dataPath or cookie + accountId + sourceUrl is required",
    );
  }

  async *_syncViaCookie(opts = {}) {
    if (hasRuntimeCookie(opts) && !hasRuntimeAccountId(opts)) {
      throw new Error(
        "travel-didi-consumer._syncViaCookie: opts.accountId required for transient cookie collection",
      );
    }
    const { cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "didi",
      identityKey: "phone",
    });
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const candidateOrdersUrl = resolveOrdersUrl(this._ordersUrl, opts);
    if (!candidateOrdersUrl) {
      throw new Error(
        "travel-didi-consumer._syncViaCookie: explicit opts.sourceUrl or constructor ordersUrl required",
      );
    }
    const ordersUrl = validateOrdersUrl(candidateOrdersUrl);
    if (this._fetchFn === defaultFetch) {
      throw new Error(
        "travel-didi-consumer._syncViaCookie: configured fetchFn required",
      );
    }
    const cookies = cookieAuth.toHeader();
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000;
    const pageSize = Number.isFinite(opts.pageSize)
      ? opts.pageSize
      : DEFAULT_PAGE_SIZE;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    let emitted = 0;
    let pageIndex = 1;
    let sourceItemsSeen = 0;
    let scanComplete = false;
    while (pageIndex <= maxPages) {
      const query = { pageIndex, pageSize, ts: Date.now() };
      let sign = null;
      if (this._signProvider)
        sign = await this._signProvider({
          url: ordersUrl,
          query,
          cookies,
          signal: opts.signal,
        });
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "orders",
          page: pageIndex - 1,
        });
      }
      const resp = await this._fetchFn({
        url: ordersUrl,
        cookies,
        query,
        sign,
        signal: opts.signal,
      });
      if (isExplicitFailure(resp)) {
        throw new SourcePageError(
          "SOURCE_PAGE_ERROR",
          "travel-didi-consumer: orders source returned an explicit error response",
        );
      }
      const rides = extractOrders(resp);
      const recognizedPage = hasOrderList(resp);
      if (!recognizedPage) {
        throw new SourcePageError(
          "SOURCE_PAGE_UNRECOGNIZED",
          "travel-didi-consumer: orders source response did not contain a recognized list",
        );
      }
      if (!rides.length) {
        const pageState = sourcePageState(resp, sourceItemsSeen);
        if (recognizedPage && pageState === "more") {
          pageIndex += 1;
          continue;
        }
        scanComplete = recognizedPage;
        break;
      }
      sourceItemsSeen += rides.length;
      const pageState = sourcePageState(resp, sourceItemsSeen);
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
        yield {
          adapter: NAME,
          originalId: rec.recordId,
          capturedAt: ts || Date.now(),
          payload: { record: rec },
        };
        emitted += 1;
      }
      if (reachedWatermark || (pageHasNew && pageState === "complete")) {
        scanComplete = true;
        break;
      }
      if (!pageHasNew) break;
      pageIndex += 1;
    }
    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error(
        "DidiConsumerAdapter.normalize: raw.payload.record missing",
      );
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

async function defaultFetch(_opts) {
  throw new Error(
    "travel-didi-consumer: no fetchFn configured for cookie-api mode",
  );
}

function resolveOrdersUrl(configuredUrl, opts = {}) {
  const value = opts.sourceUrl ?? opts.ordersUrl ?? configuredUrl;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function validateOrdersUrl(value) {
  const url = buildSourceUrl({ url: value });
  if (url.hash) {
    throw sourceUrlError(
      "travel-didi-consumer: source URL fragments are not allowed",
      "SOURCE_URL_FRAGMENT_NOT_ALLOWED",
    );
  }
  if (url.port && url.port !== "443") {
    throw sourceUrlError(
      "travel-didi-consumer: source URL must use the default HTTPS port",
      "SOURCE_URL_PORT_NOT_ALLOWED",
    );
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = ALLOWED_SOURCE_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (!allowed) {
    throw sourceUrlError(
      "travel-didi-consumer: source URL host is not an allowed Didi domain",
      "SOURCE_URL_HOST_NOT_ALLOWED",
    );
  }
  return url.href;
}

function hasRuntimeAccountId(opts = {}) {
  const value = opts.phone != null ? opts.phone : opts.accountId;
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function sourceUrlError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { DidiConsumerAdapter, NAME, VERSION };
