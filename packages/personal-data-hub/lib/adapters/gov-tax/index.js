/**
 * §12.1 Phase 13+ ⭐⭐⭐⭐ — 个人所得税 / 个税 APP (cn.gov.tax.its) adapter,
 * "收入 + 雇主 + 申报".
 *
 * ⚠️ MAXIMALLY SENSITIVE (financial/tax, real-name + 可能人脸 auth).
 * BEST-EFFORT SCAFFOLD (user-requested). The 个税 app is a government tax
 * system behind real-name SSO with NO verifiable public API; the cookie-api
 * endpoints below are FABRICATED placeholders (overridable via opts.*Url, NOT
 * field-verified — FAMILY-23 playbook) and cannot authenticate without the
 * gov real-name login. **snapshot mode is the reliable path** (the app / a
 * manual 收入纳税明细 export produces a JSON); the cookie path is a seam only
 * and surfaces `auth.unverified=true`. Gated sensitivity:"high" +
 * legalGate:true — the registry REQUIRES explicit legal/consent confirmation
 * before any collection runs.
 *
 * Personal footprint modelled (two kinds):
 *   - "income"       收入/扣缴明细: { period(YYYY-MM), incomeType(工资薪金/劳务报酬
 *                    /稿酬/经营所得/...), amount, withheld(已扣缴税额),
 *                    payer(扣缴义务人 name + id) } → EVENT(INCOME) + employer
 *                    Person(MERCHANT).
 *   - "declaration"  申报/年度汇算: { year, declType(综合所得年度汇算/...),
 *                    status(申报成功/待缴款/已退税/...), settleAmount(汇算结果:
 *                    退税为负 / 补税为正) } → EVENT(OTHER).
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "income", "id": "inc-<id>", "recordId": "...", "period": "2025-03",
 *         "incomeType": "工资薪金", "amount": 20000, "withheld": 1234.56,
 *         "payerName": "某某公司", "payerId": "9144..." },
 *       { "kind": "declaration", "id": "dec-<id>", "recordId": "...", "year": 2024,
 *         "declType": "综合所得年度汇算", "status": "已退税", "settleAmount": -800.0,
 *         "declaredAt": <s|ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "gov-tax";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_INCOME = "income";
const KIND_DECLARATION = "declaration";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_INCOME, KIND_DECLARATION]);

// FABRICATED best-effort endpoints — NOT field-verified. Overridable.
const INCOME_URL = "https://its.tax.gov.cn/api/v1/income/list";
const DECLARATION_URL = "https://its.tax.gov.cn/api/v1/declaration/list";
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

// "2025-03" / "202503" / epoch → ms at month start (best-effort).
function periodToMs(period) {
  if (period == null) return null;
  const s = String(period);
  let m = s.match(/^(\d{4})[-/]?(\d{1,2})/);
  if (m) {
    const t = Date.parse(`${m[1]}-${String(m[2]).padStart(2, "0")}-01T00:00:00Z`);
    return Number.isFinite(t) ? t : null;
  }
  return parseTime(period);
}

function toAmount(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,，¥\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `tax:${kind}:${safe}`;
}

function mapIncome(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.recordId || raw.record_id || raw.id || raw.detailId;
  if (id == null) return null;
  return {
    recordId: String(id),
    period: raw.period || raw.taxPeriod || raw.tax_period || raw.month || null,
    incomeType: raw.incomeType || raw.income_type || raw.type || raw.itemName || "其他所得",
    amount: toAmount(raw.amount != null ? raw.amount : raw.income),
    withheld: toAmount(raw.withheld != null ? raw.withheld : raw.tax != null ? raw.tax : raw.withheldTax),
    payerName: raw.payerName || raw.payer_name || raw.payer || raw.company || raw.employer || null,
    payerId: raw.payerId || raw.payer_id || raw.payerTaxId || raw.companyId || null,
  };
}

function mapDeclaration(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.recordId || raw.record_id || raw.id || raw.declId;
  if (id == null) return null;
  return {
    recordId: String(id),
    year: raw.year || raw.taxYear || raw.tax_year || null,
    declType: raw.declType || raw.decl_type || raw.type || raw.itemName || "申报",
    status: raw.status || raw.statusName || raw.state || null,
    settleAmount: toAmount(raw.settleAmount != null ? raw.settleAmount : raw.amount),
    declaredMs: parseTime(raw.declaredAt || raw.declared_at || raw.submitTime || raw.submit_time || raw.time),
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
  }
  return [];
}

class TaxAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "tax", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      income: opts.incomeUrl || opts.listUrl || INCOME_URL,
      declaration: opts.declarationUrl || DECLARATION_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:tax-income",
      "parse:tax-declaration",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 6, perDay: 100 };
    this.dataDisclosure = {
      fields: [
        "tax:income (period / incomeType / amount / withheld / payer)",
        "tax:declaration (year / declType / status / settleAmount)",
      ],
      // Real-name financial / tax data — maximally sensitive.
      sensitivity: "high",
      legalGate: true,
      defaultInclude: { income: true, declaration: true },
    };

    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      try {
        this._deps.fs.accessSync(ctx.inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `snapshot not readable at ${ctx.inputPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
        unverified: true,
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "gov-tax.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode, best-effort/unverified)",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok
        ? { ok: true, lastChecked: Date.now(), unverified: true }
        : { ok: false, reason: r.reason, error: r.error };
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
    throw new Error(
      "gov-tax.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `gov-tax.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object" ? snapshot.account : null;
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object") continue;
      if (!VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;

      const rec = ev.kind === KIND_INCOME ? mapIncome(ev) : mapDeclaration(ev);
      if (!rec) continue;
      const recTime =
        ev.kind === KIND_INCOME ? periodToMs(rec.period) : rec.declaredMs || (rec.year ? periodToMs(`${rec.year}-01`) : null);
      const capturedAt = parseTime(ev.capturedAt) || recTime || fallbackCapturedAt;
      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, rec.recordId),
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
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 12;

    const plan = [
      { kind: KIND_INCOME, url: this._urls.income, map: mapIncome },
      { kind: KIND_DECLARATION, url: this._urls.declaration, map: mapDeclaration },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      let page = 1;
      while (page <= maxPages) {
        const query = { page, size: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: step.url, query, cookies });
        }
        const resp = await this._fetchFn({ url: step.url, cookies, query, sign });
        const items = extractList(resp);
        if (!items.length) break;
        for (const it of items) {
          const rec = step.map(it);
          if (!rec) continue;
          if (emitted >= limit) return;
          const recTime =
            step.kind === KIND_INCOME
              ? periodToMs(rec.period)
              : rec.declaredMs || (rec.year ? periodToMs(`${rec.year}-01`) : null);
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, rec.recordId),
            capturedAt: recTime || Date.now(),
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
      throw new Error("TaxAdapter.normalize: payload.record missing");
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

    if (kind === KIND_INCOME) {
      const occurredAt = periodToMs(rec.period) || raw.capturedAt || ingestedAt;
      const persons = [];
      let payerRef = null;
      if (rec.payerName) {
        payerRef = `person-tax-payer-${rec.payerId || rec.payerName}`;
        persons.push({
          id: payerRef,
          type: ENTITY_TYPES.PERSON,
          subtype: PERSON_SUBTYPES.MERCHANT,
          names: [rec.payerName],
          ingestedAt,
          source,
          identifiers: rec.payerId ? { "tax-payer-id": [String(rec.payerId)] } : {},
          extra: { platform: "tax", role: "扣缴义务人" },
        });
      }
      return {
        events: [
          {
            id: newId(),
            type: ENTITY_TYPES.EVENT,
            subtype: EVENT_SUBTYPES.INCOME,
            occurredAt,
            actor: "person-self",
            content: {
              title: `收入: ${rec.incomeType}${rec.period ? ` (${rec.period})` : ""}`.slice(0, 80),
              text: rec.incomeType,
            },
            ingestedAt,
            source,
            extra: {
              platform: "tax",
              kind: KIND_INCOME,
              period: rec.period || null,
              incomeType: rec.incomeType,
              amount: rec.amount,
              withheld: rec.withheld,
              payerRef,
            },
          },
        ],
        persons,
        places: [],
        items: [],
        topics: [],
      };
    }
    // declaration
    const occurredAt =
      rec.declaredMs || (rec.year ? periodToMs(`${rec.year}-01`) : null) || raw.capturedAt || ingestedAt;
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.OTHER,
          occurredAt,
          actor: "person-self",
          content: {
            title: `个税申报: ${rec.declType}${rec.year ? ` (${rec.year})` : ""}`.slice(0, 80),
            text: rec.declType,
          },
          ingestedAt,
          source,
          extra: {
            platform: "tax",
            kind: KIND_DECLARATION,
            year: rec.year || null,
            declType: rec.declType,
            status: rec.status || null,
            settleAmount: rec.settleAmount,
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
  throw new Error("gov-tax: no fetchFn configured for cookie-api mode");
}

module.exports = {
  TaxAdapter,
  mapIncome,
  mapDeclaration,
  extractList,
  periodToMs,
  toAmount,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
