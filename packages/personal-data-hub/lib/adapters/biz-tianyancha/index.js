/**
 * §A14 — 天眼查 (Tianyancha, com.tianyancha.skyeye) adapter, dual-mode
 * (snapshot + cookie-api). Phase 13+ §12.1 line-780 ROI ⭐⭐ "自查公司关联".
 *
 * 天眼查 personal data = the user's business-intelligence footprint: companies
 * they monitor/关注 and their company-search history. Both are interest signals →
 * monitor maps to a LIKE event (关注某公司), search to an INTERACTION event
 * (搜索某公司). Mirrors the social-dongchedi two-mode shape; events-only (a
 * company is not a Person, and a lightweight event keeps the vault model simple).
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch monitor list + search
 *      history from tianyancha.com via the injected `fetchFn`, paginate; a sign
 *      seam (opts.signProvider) covers tianyancha's signed-request header (auth /
 *      version token); best-effort unsigned when absent. Endpoints overridable
 *      via opts.monitorUrl / opts.searchUrl (best-effort, not field-verified —
 *      FAMILY-23 playbook). account OPTIONAL — the cookie carries identity.
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "monitor", "id": "mon-<gid>", "companyId": "...", "companyName": "...",
 *         "legalPerson": "...", "regStatus": "...", "capturedAt": <ms> },
 *       { "kind": "search",  "id": "search-<id>", "query": "...", "companyName": "...",
 *         "capturedAt": <ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "biz-tianyancha";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_MONITOR = "monitor";
const KIND_SEARCH = "search";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_MONITOR, KIND_SEARCH]);

// Best-effort tianyancha.com endpoints. Overridable via opts.*Url.
const MONITOR_URL =
  "https://capi.tianyancha.com/cloud-monitor-app/monitor/list";
const SEARCH_URL =
  "https://capi.tianyancha.com/cloud-search-app/search/history";
const PAGE_SIZE = 20;

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

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `tianyancha:${kind}:${safe}`;
}

class TianyanchaAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({
            platform: "tianyancha",
            cookies: opts.account.cookies,
          })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      monitor: opts.monitorUrl || MONITOR_URL,
      search: opts.searchUrl || SEARCH_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:tianyancha-monitor",
      "parse:tianyancha-search",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "tianyancha:monitor (companyName / legalPerson / regStatus)",
        "tianyancha:search (query / companyName)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { monitor: true, search: true },
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
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "biz-tianyancha.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok
        ? { ok: true, lastChecked: Date.now() }
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
      "biz-tianyancha.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
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
        `biz-tianyancha.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallback =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (
        !ev ||
        typeof ev !== "object" ||
        !VALID_SNAPSHOT_KINDS.includes(ev.kind)
      )
        continue;
      if (include[ev.kind] === false) continue;
      const id =
        (typeof ev.id === "string" && ev.id) ||
        ev.companyId ||
        ev.query ||
        null;
      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt: parseTime(ev.capturedAt) || fallback,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const include = opts.include || {};
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : 0;

    const plan = [
      {
        kind: KIND_MONITOR,
        url: this._urls.monitor,
        idOf: (it) => it.graphId || it.companyId || it.id,
      },
      {
        kind: KIND_SEARCH,
        url: this._urls.search,
        idOf: (it) => it.id || it.keyword || it.word,
      },
    ];

    let emitted = 0;
    let scanComplete = true;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      let pageNum = 1;
      let streamComplete = false;
      while (pageNum <= maxPages) {
        const query = { pageNum, pageSize: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: step.url, query, cookies });
        }
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({
            operation: step.kind,
            page: pageNum,
          });
        }
        const resp = await this._fetchFn({
          url: step.url,
          cookies,
          query,
          sign,
        });
        const items = extractData(resp);
        if (!items.length) {
          streamComplete = true;
          break;
        }
        let reachedWatermark = false;
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          const capturedAt =
            parseTime(
              it.createTime || it.monitorTime || it.searchTime || it.gmtCreate,
            ) || Date.now();
          if (capturedAt < sinceMs) {
            reachedWatermark = true;
            break;
          }
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, step.idOf(it)),
            capturedAt,
            payload: { item: it, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (reachedWatermark || items.length < PAGE_SIZE) {
          streamComplete = true;
          break;
        }
        pageNum += 1;
      }
      if (!streamComplete) scanComplete = false;
    }
    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload)
      throw new Error("TianyanchaAdapter.normalize: payload missing");
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    if (kind === KIND_MONITOR) return normalizeMonitor(raw, ingestedAt);
    if (kind === KIND_SEARCH) return normalizeSearch(raw, ingestedAt);
    throw new Error(`TianyanchaAdapter.normalize: unknown kind ${kind}`);
  }
}

// ─── cookie response helpers ─────────────────────────────────────────────────

function extractData(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.list)) return resp.list;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.resultList)) return d.resultList;
    if (Array.isArray(d.records)) return d.records;
  }
  return [];
}

// ─── per-kind normalizers (snapshot fields OR cookie payload.item) ────────────

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeMonitor(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const company = it.companyName || it.name || it.company || "";
  const occurredAt =
    parseTime(
      it.capturedAt || it.createTime || it.monitorTime || raw.capturedAt,
    ) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.LIKE,
        occurredAt,
        actor: "person-self",
        content: { title: `关注公司: ${company}`.trim(), text: company },
        ingestedAt,
        source,
        extra: {
          platform: "tianyancha",
          companyId:
            (it.companyId || it.graphId || it.id) != null
              ? String(it.companyId || it.graphId || it.id)
              : null,
          companyName: company || null,
          legalPerson: it.legalPerson || it.legalPersonName || null,
          regStatus: it.regStatus || it.status || null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeSearch(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const q = it.query || it.keyword || it.word || it.companyName || "";
  const occurredAt =
    parseTime(
      it.capturedAt || it.searchTime || it.createTime || raw.capturedAt,
    ) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.INTERACTION,
        occurredAt,
        actor: "person-self",
        content: { title: `搜索企业: ${q}`.trim(), text: q },
        ingestedAt,
        source,
        extra: {
          platform: "tianyancha",
          query: q || null,
          companyName: it.companyName || null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

async function defaultFetch(_opts) {
  throw new Error("biz-tianyancha: no fetchFn configured for cookie-api mode");
}

module.exports = {
  TianyanchaAdapter,
  extractData,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
