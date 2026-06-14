/**
 * §12.1 Phase 13+ ⭐⭐⭐ — 数字人民币 (DCEP / e-CNY, cn.gov.pbc.dcep) adapter,
 * "DCEP 交易". BEST-EFFORT SCAFFOLD (user-requested).
 *
 * ⚠️ MAXIMALLY SENSITIVE (central-bank digital-currency wallet, real-name +
 * strong-auth). The DCEP app has NO documented public API; the cookie-api
 * endpoint below is a FABRICATED placeholder (overridable via opts.listUrl,
 * NOT field-verified — FAMILY-23 playbook) and cannot authenticate without the
 * app's real login. **snapshot mode is the reliable path**; cookie path
 * surfaces auth.unverified=true. Gated sensitivity:"high" + legalGate:true.
 *
 * One record kind: 钱包交易 (wallet transactions):
 *   { txId, time, amount, direction(pay付款/receive收款), counterparty, walletType(子钱包) }
 *   → EVENT(PAYMENT).
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "transaction", "id": "tx-<id>", "txId": "...", "time": <s|ms>,
 *         "amount": 12.5, "direction": "pay", "counterparty": "某商户",
 *         "walletType": "中国银行子钱包" }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "finance-dcep";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_TX = "transaction";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_TX]);
const DCEP_LIST_URL = "https://dcep.pbc.gov.cn/api/v1/wallet/transactions";
const PAGE_SIZE = 30;

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v >= 1e9 ? v * 1000 : v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n >= 1e9 ? n * 1000 : n;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function toAmount(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,，¥\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normDirection(raw) {
  const d = String(raw.direction || raw.type || raw.dcFlag || "").toLowerCase();
  if (/receive|收款|收入|入账|贷|\+/.test(d)) return "receive";
  if (/pay|付款|支出|出账|借|-/.test(d)) return "pay";
  const amt = toAmount(raw.amount);
  if (Number.isFinite(amt)) return amt < 0 ? "pay" : "receive";
  return "pay";
}

function mapTx(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.txId || raw.tx_id || raw.id || raw.serialNo || raw.orderNo;
  if (id == null) return null;
  const amt = toAmount(raw.amount != null ? raw.amount : raw.amt);
  return {
    txId: String(id),
    timeMs: parseTime(raw.time || raw.tradeTime || raw.trade_time || raw.date),
    amount: amt != null ? Math.abs(amt) : null,
    direction: normDirection(raw),
    counterparty: raw.counterparty || raw.merchant || raw.payee || raw.oppName || null,
    walletType: raw.walletType || raw.wallet_type || raw.subWallet || raw.bank || null,
  };
}

function extractList(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.records)) return d.records;
  }
  return [];
}

function stableOriginalId(id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `dcep:transaction:${safe}`;
}

class DcepAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies ? new CookieAuth({ platform: "dcep", cookies: opts.account.cookies }) : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider = typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._listUrl = typeof opts.listUrl === "string" && opts.listUrl.length > 0 ? opts.listUrl : DCEP_LIST_URL;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:snapshot", "sync:cookie-api", "parse:dcep-transaction"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 5, perDay: 60 };
    this.dataDisclosure = {
      fields: ["dcep:transaction (time / amount / direction / counterparty / walletType)"],
      sensitivity: "high",
      legalGate: true,
      defaultInclude: { transaction: true },
    };
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      try {
        this._deps.fs.accessSync(ctx.inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return { ok: false, reason: "INPUT_PATH_UNREADABLE", message: `snapshot not readable at ${ctx.inputPath}: ${err.message}` };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      return { ok: true, account: (this.account && this.account.userId) || null, mode: "cookie", unverified: true };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message: "finance-dcep.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode, best-effort/unverified)",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok ? { ok: true, lastChecked: Date.now(), unverified: true } : { ok: false, reason: r.reason, error: r.error };
    }
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (this._cookieAuth) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error("finance-dcep.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)");
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`finance-dcep.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`);
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0 ? Math.floor(snapshot.snapshottedAt) : Date.now();
    const account = snapshot.account && typeof snapshot.account === "object" ? snapshot.account : null;
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object") continue;
      if (!VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;
      const rec = mapTx(ev);
      if (!rec) continue;
      const capturedAt = parseTime(ev.capturedAt) || rec.timeMs || fallbackCapturedAt;
      yield {
        adapter: NAME,
        kind: KIND_TX,
        originalId: stableOriginalId(rec.txId),
        capturedAt,
        payload: { record: rec, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const include = opts.include || {};
    if (include[KIND_TX] === false) return;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 12;

    let emitted = 0;
    let page = 1;
    while (page <= maxPages) {
      const query = { page, size: PAGE_SIZE };
      let sign = null;
      if (this._signProvider) sign = await this._signProvider({ url: this._listUrl, query, cookies });
      const resp = await this._fetchFn({ url: this._listUrl, cookies, query, sign });
      const items = extractList(resp);
      if (!items.length) break;
      for (const it of items) {
        const rec = mapTx(it);
        if (!rec) continue;
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_TX,
          originalId: stableOriginalId(rec.txId),
          capturedAt: rec.timeMs || Date.now(),
          payload: { record: rec, cookie: true },
        };
        emitted += 1;
      }
      if (items.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("DcepAdapter.normalize: payload.record missing");
    }
    const rec = raw.payload.record;
    const ingestedAt = Date.now();
    const occurredAt = rec.timeMs || raw.capturedAt || ingestedAt;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt || occurredAt,
      capturedBy: CAPTURED_BY.API,
    };
    const arrow = rec.direction === "receive" ? "收款" : "付款";
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.PAYMENT,
          occurredAt,
          actor: "person-self",
          content: {
            title: `数字人民币${arrow}${rec.counterparty ? `: ${rec.counterparty}` : ""}`.slice(0, 80),
            text: rec.counterparty || "数字人民币交易",
          },
          ingestedAt,
          source,
          extra: {
            platform: "dcep",
            kind: KIND_TX,
            amount: rec.amount,
            direction: rec.direction,
            counterparty: rec.counterparty || null,
            walletType: rec.walletType || null,
          },
        },
      ],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

async function defaultFetch(_opts) {
  throw new Error("finance-dcep: no fetchFn configured for cookie-api mode");
}

module.exports = {
  DcepAdapter,
  mapTx,
  extractList,
  normDirection,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
