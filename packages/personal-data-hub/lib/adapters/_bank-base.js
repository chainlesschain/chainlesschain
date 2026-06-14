/**
 * _bank-base — shared infrastructure for personal-banking adapters (民生 /
 * 中行 / 交行 / ...), §12.1 Phase 13+ "交易明细 + 信用卡".
 *
 * ⚠️ MAXIMALLY SENSITIVE (real-name banking, strong-auth + 可能人脸).
 * BEST-EFFORT SCAFFOLDS: mobile-bank apps have NO documented public API and
 * sit behind real-name SSO; the cookie-api endpoints supplied by each wrapper
 * are FABRICATED placeholders (overridable, NOT field-verified — FAMILY-23
 * playbook) and cannot authenticate without the bank's real login. **snapshot
 * mode is the reliable path** (the app / a manual 交易明细 + 账单 export
 * produces a JSON); the cookie path is a seam only, surfaces
 * `auth.unverified=true`. Every bank adapter is gated sensitivity:"high" +
 * legalGate:true — the registry REQUIRES explicit legal/consent confirmation
 * before any collection runs.
 *
 * Two record kinds, uniform across banks:
 *   - "transaction" 交易明细: { txId, time, amount, direction(debit支出/credit收入),
 *     counterparty(对方户名), summary(摘要), balance, channel } → EVENT(PAYMENT).
 *   - "card"        信用卡账单: { billId, billMonth(YYYY-MM), statementAmount,
 *     minPayment, dueDate, status } → EVENT(OTHER).
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "transaction", "id": "tx-<id>", "txId": "...", "time": <s|ms>,
 *         "amount": 123.45, "direction": "debit", "counterparty": "...",
 *         "summary": "...", "balance": 9999.0, "channel": "手机银行" },
 *       { "kind": "card", "id": "card-<id>", "billId": "...", "billMonth": "2025-03",
 *         "statementAmount": 3210.0, "minPayment": 321.0, "dueDate": <s|ms>,
 *         "status": "已出账" }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../constants");

const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_TRANSACTION = "transaction";
const KIND_CARD = "card";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_TRANSACTION, KIND_CARD]);
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

// Normalize a raw direction hint → "debit" (支出) | "credit" (收入).
function normDirection(raw) {
  const d = raw.direction || raw.dcFlag || raw.dc_flag || raw.flag || raw.type;
  const s = String(d == null ? "" : d).toLowerCase();
  if (/credit|收入|入账|贷|^c$|^cr$|\+/.test(s)) return "credit";
  if (/debit|支出|出账|借|^d$|^dr$|-/.test(s)) return "debit";
  // fall back to amount sign
  const amt = toAmount(raw.amount != null ? raw.amount : raw.tranAmount);
  if (Number.isFinite(amt)) return amt < 0 ? "debit" : "credit";
  return "debit";
}

function mapTransaction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.txId || raw.tx_id || raw.id || raw.serialNo || raw.tranSeq || raw.seq;
  if (id == null) return null;
  const amt = toAmount(raw.amount != null ? raw.amount : raw.tranAmount != null ? raw.tranAmount : raw.amt);
  return {
    txId: String(id),
    timeMs: parseTime(raw.time || raw.tranTime || raw.tran_time || raw.date || raw.transactionTime),
    amount: amt != null ? Math.abs(amt) : null,
    direction: normDirection(raw),
    counterparty: raw.counterparty || raw.counterParty || raw.payee || raw.oppName || raw.merchant || null,
    summary: raw.summary || raw.abstract || raw.remark || raw.desc || raw.tranType || "交易",
    balance: toAmount(raw.balance != null ? raw.balance : raw.bal),
    channel: raw.channel || raw.chnl || null,
  };
}

function mapCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.billId || raw.bill_id || raw.id || raw.statementId || raw.billMonth || raw.bill_month;
  if (id == null) return null;
  return {
    billId: String(id),
    billMonth: raw.billMonth || raw.bill_month || raw.month || raw.period || null,
    statementAmount: toAmount(raw.statementAmount != null ? raw.statementAmount : raw.amount != null ? raw.amount : raw.totalAmount),
    minPayment: toAmount(raw.minPayment != null ? raw.minPayment : raw.minRepay),
    dueMs: parseTime(raw.dueDate || raw.due_date || raw.repayDate),
    status: raw.status || raw.statusName || raw.state || null,
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
    if (Array.isArray(d.result)) return d.result;
    if (Array.isArray(d.details)) return d.details;
  }
  return [];
}

function billMonthToMs(billMonth) {
  if (billMonth == null) return null;
  const m = String(billMonth).match(/^(\d{4})[-/]?(\d{1,2})/);
  if (m) {
    const t = Date.parse(`${m[1]}-${String(m[2]).padStart(2, "0")}-01T00:00:00Z`);
    return Number.isFinite(t) ? t : null;
  }
  return parseTime(billMonth);
}

/**
 * Build a bank adapter class.
 * @param {object} cfg
 * @param {string} cfg.NAME        e.g. "bank-cmbc"
 * @param {string} cfg.VERSION
 * @param {string} cfg.platform    e.g. "cmbc"
 * @param {string} cfg.defaultTxUrl   best-effort transaction-list endpoint
 * @param {string} cfg.defaultCardUrl best-effort credit-card-bill endpoint
 */
function createBankAdapter(cfg) {
  const { NAME, VERSION, platform, defaultTxUrl, defaultCardUrl } = cfg;
  const { CookieAuth } = require("./shopping-base");

  function stableOriginalId(kind, id) {
    const safe =
      (typeof id === "string" && id.length > 0 && id) ||
      (typeof id === "number" && Number.isFinite(id) && String(id)) ||
      `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${platform}:${kind}:${safe}`;
  }

  class BankAdapter {
    constructor(opts = {}) {
      this.account = opts.account || null;
      this._cookieAuth =
        opts.account && opts.account.cookies
          ? new CookieAuth({ platform, cookies: opts.account.cookies })
          : null;
      this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
      this._signProvider = typeof opts.signProvider === "function" ? opts.signProvider : null;
      this._urls = {
        transaction: opts.transactionUrl || opts.listUrl || defaultTxUrl,
        card: opts.cardUrl || defaultCardUrl,
      };

      this.name = NAME;
      this.version = VERSION;
      this.capabilities = ["sync:snapshot", "sync:cookie-api", `parse:${platform}-transaction`, `parse:${platform}-card`];
      this.extractMode = "web-api";
      this.rateLimits = { perMinute: 5, perDay: 60 };
      this.dataDisclosure = {
        fields: [
          `${platform}:transaction (time / amount / direction / counterparty / balance)`,
          `${platform}:card (billMonth / statementAmount / status)`,
        ],
        sensitivity: "high",
        legalGate: true,
        defaultInclude: { transaction: true, card: true },
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
        message: `${NAME}.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode, best-effort/unverified)`,
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
      throw new Error(`${NAME}.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)`);
    }

    async *_syncViaSnapshot(opts) {
      const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
      const snapshot = JSON.parse(raw);
      if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(`${NAME}.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`);
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

        const rec = ev.kind === KIND_TRANSACTION ? mapTransaction(ev) : mapCard(ev);
        if (!rec) continue;
        const recTime = ev.kind === KIND_TRANSACTION ? rec.timeMs : billMonthToMs(rec.billMonth) || rec.dueMs;
        const capturedAt = parseTime(ev.capturedAt) || recTime || fallbackCapturedAt;
        yield {
          adapter: NAME,
          kind: ev.kind,
          originalId: stableOriginalId(ev.kind, ev.kind === KIND_TRANSACTION ? rec.txId : rec.billId),
          capturedAt,
          payload: { record: rec, kind: ev.kind, account },
        };
        emitted += 1;
      }
    }

    async *_syncViaCookie(opts = {}) {
      if (!(await this._cookieAuth.validate())) return;
      const cookies = this._cookieAuth.toHeader();
      const include = opts.include || {};
      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
      const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 12;

      const plan = [
        { kind: KIND_TRANSACTION, url: this._urls.transaction, map: mapTransaction, idOf: (r) => r.txId, ts: (r) => r.timeMs },
        { kind: KIND_CARD, url: this._urls.card, map: mapCard, idOf: (r) => r.billId, ts: (r) => billMonthToMs(r.billMonth) || r.dueMs },
      ];

      let emitted = 0;
      for (const step of plan) {
        if (include[step.kind] === false) continue;
        let page = 1;
        while (page <= maxPages) {
          const query = { page, size: PAGE_SIZE };
          let sign = null;
          if (this._signProvider) sign = await this._signProvider({ url: step.url, query, cookies });
          const resp = await this._fetchFn({ url: step.url, cookies, query, sign });
          const items = extractList(resp);
          if (!items.length) break;
          for (const it of items) {
            const rec = step.map(it);
            if (!rec) continue;
            if (emitted >= limit) return;
            yield {
              adapter: NAME,
              kind: step.kind,
              originalId: stableOriginalId(step.kind, step.idOf(rec)),
              capturedAt: step.ts(rec) || Date.now(),
              payload: { record: rec, kind: step.kind, cookie: true },
            };
            emitted += 1;
          }
          if (items.length < PAGE_SIZE) break;
          page += 1;
        }
      }
    }

    normalize(raw) {
      if (!raw || !raw.payload || !raw.payload.record) {
        throw new Error(`${NAME}.normalize: payload.record missing`);
      }
      const kind = raw.kind || raw.payload.kind;
      const rec = raw.payload.record;
      const ingestedAt = Date.now();
      const source = {
        adapter: NAME,
        adapterVersion: VERSION,
        originalId: raw.originalId,
        capturedAt: raw.capturedAt || ingestedAt,
        capturedBy: CAPTURED_BY.API,
      };

      if (kind === KIND_TRANSACTION) {
        const occurredAt = rec.timeMs || raw.capturedAt || ingestedAt;
        const arrow = rec.direction === "credit" ? "收入" : "支出";
        return {
          events: [
            {
              id: newId(),
              type: ENTITY_TYPES.EVENT,
              subtype: EVENT_SUBTYPES.PAYMENT,
              occurredAt,
              actor: "person-self",
              content: { title: `${arrow}: ${rec.summary}`.slice(0, 80), text: rec.summary },
              ingestedAt,
              source,
              extra: {
                platform,
                kind: KIND_TRANSACTION,
                amount: rec.amount,
                direction: rec.direction,
                counterparty: rec.counterparty || null,
                balance: rec.balance,
                channel: rec.channel || null,
              },
            },
          ],
          persons: [],
          places: [],
          items: [],
          topics: [],
        };
      }
      // card
      const occurredAt = billMonthToMs(rec.billMonth) || rec.dueMs || raw.capturedAt || ingestedAt;
      return {
        events: [
          {
            id: newId(),
            type: ENTITY_TYPES.EVENT,
            subtype: EVENT_SUBTYPES.OTHER,
            occurredAt,
            actor: "person-self",
            content: { title: `信用卡账单${rec.billMonth ? ` ${rec.billMonth}` : ""}`.slice(0, 80), text: "信用卡账单" },
            ingestedAt,
            source,
            extra: {
              platform,
              kind: KIND_CARD,
              billMonth: rec.billMonth || null,
              statementAmount: rec.statementAmount,
              minPayment: rec.minPayment,
              dueMs: rec.dueMs || null,
              status: rec.status || null,
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

  return BankAdapter;
}

async function defaultFetch(_opts) {
  throw new Error("bank-base: no fetchFn configured for cookie-api mode");
}

module.exports = {
  createBankAdapter,
  mapTransaction,
  mapCard,
  extractList,
  normDirection,
  toAmount,
  parseTime,
  billMonthToMs,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
