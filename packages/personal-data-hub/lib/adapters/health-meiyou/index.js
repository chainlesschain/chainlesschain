/**
 * §12.1 Phase 13+ ⭐⭐ — 美柚 (com.lingan.seeyou) adapter, "周期健康".
 *
 * ⚠️ MAXIMALLY SENSITIVE (reproductive / menstrual-cycle health). 美柚 is a
 * period-tracking app; the personal footprint is the user's 经期记录
 * (menstrual cycle entries) + 健康日记 (mood / symptom / weight diary). This is
 * among the most sensitive personal-data categories that exists, so the
 * adapter is gated **sensitivity:"high" + legalGate:true** — the registry
 * REQUIRES explicit legal/consent confirmation before any collection runs, and
 * nothing is fetched until the user opts in.
 *
 * 美柚 has no documented public API and its cloud sync is account-bound, so
 * snapshot import is supported. No endpoint is selected by default; custom
 * live collection requires caller-supplied captured URLs and a fetchFn.
 *
 * Modelled records → EVENT(subtype OTHER) on the entry date, rich health
 * fields in `extra` (kept local in the vault, never normalized into searchable
 * content beyond the entry label). Two kinds:
 *   - "period"  经期记录:  { startDate, endDate, cycleLength, periodLength }
 *   - "record"  健康日记:  { date, recordType(mood|symptom|weight|...), value, note }
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "period", "id": "p-<id>", "recordId": "...",
 *         "startDate": <s|ms>, "endDate": <s|ms>, "cycleLength": 28, "periodLength": 5 },
 *       { "kind": "record", "id": "r-<id>", "recordId": "...", "recordType": "mood",
 *         "date": <s|ms>, "value": "开心", "note": "..." }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "health-meiyou";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PERIOD = "period";
const KIND_RECORD = "record";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PERIOD, KIND_RECORD]);

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

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `meiyou:${kind}:${safe}`;
}

function mapPeriod(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id =
    raw.recordId || raw.record_id || raw.id || raw.startDate || raw.start_date;
  if (id == null) return null;
  return {
    recordId: String(id),
    startMs: parseTime(raw.startDate || raw.start_date || raw.start),
    endMs: parseTime(raw.endDate || raw.end_date || raw.end),
    cycleLength:
      raw.cycleLength != null ? raw.cycleLength : (raw.cycle_length ?? null),
    periodLength:
      raw.periodLength != null ? raw.periodLength : (raw.period_length ?? null),
  };
}

function mapRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.recordId || raw.record_id || raw.id;
  if (id == null) return null;
  return {
    recordId: String(id),
    recordType: raw.recordType || raw.record_type || raw.type || "other",
    dateMs: parseTime(
      raw.date || raw.recordTime || raw.record_time || raw.time,
    ),
    value:
      raw.value != null ? raw.value : raw.content != null ? raw.content : null,
    note: raw.note || raw.remark || null,
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
    if (Array.isArray(d.calendar)) return d.calendar;
  }
  return [];
}

class MeiyouAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "meiyou", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      period: opts.periodUrl || opts.listUrl || null,
      record: opts.recordUrl || null,
    };
    this._liveConfigured = Boolean(
      this._urls.period &&
      this._urls.record &&
      typeof opts.fetchFn === "function",
    );

    this.name = NAME;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
      "parse:meiyou-period",
      "parse:meiyou-record",
    ];
    this.extractMode = this._liveConfigured ? "web-api" : "file-import";
    this.rateLimits = { perMinute: 6, perDay: 100 };
    this.dataDisclosure = {
      fields: [
        "meiyou:period (startDate / endDate / cycleLength / periodLength)",
        "meiyou:record (recordType / value / note)",
      ],
      // Reproductive / menstrual-cycle health — maximally sensitive.
      sensitivity: "high",
      legalGate: true,
      defaultInclude: { period: true, record: true },
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
    if (this._cookieAuth && !this._liveConfigured) {
      return {
        ok: false,
        reason: "EXPLICIT_ENDPOINT_REQUIRED",
        message:
          "health-meiyou: cookie collection requires captured periodUrl + recordUrl and fetchFn; snapshot import is ready",
      };
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
        unverified: true,
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "health-meiyou.authenticate: needs opts.inputPath; custom live mode also requires cookies, periodUrl, recordUrl, and fetchFn",
    };
  }

  async healthCheck(opts = {}) {
    if (this._cookieAuth) {
      const r = await this.authenticate(opts);
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
    if (this._cookieAuth && this._liveConfigured) {
      yield* this._syncViaCookie(opts);
      return;
    }
    if (this._cookieAuth) {
      throw new Error(
        "health-meiyou.sync: explicit periodUrl + recordUrl and fetchFn required for custom cookie collection",
      );
    }
    throw new Error("health-meiyou.sync: needs opts.inputPath (snapshot mode)");
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
        `health-meiyou.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
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
      if (!ev || typeof ev !== "object") continue;
      if (!VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;

      const rec = ev.kind === KIND_PERIOD ? mapPeriod(ev) : mapRecord(ev);
      if (!rec) continue;
      const recTime = ev.kind === KIND_PERIOD ? rec.startMs : rec.dateMs;
      const capturedAt =
        parseTime(ev.capturedAt) || recTime || fallbackCapturedAt;
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
        kind: KIND_PERIOD,
        url: this._urls.period,
        map: mapPeriod,
        ts: (r) => r.startMs,
      },
      {
        kind: KIND_RECORD,
        url: this._urls.record,
        map: mapRecord,
        ts: (r) => r.dateMs,
      },
    ];

    let emitted = 0;
    let scanComplete = true;
    let selectedKinds = 0;
    for (const step of plan) {
      if (include[step.kind] === false) {
        scanComplete = false;
        continue;
      }
      selectedKinds += 1;
      let page = 1;
      let stepComplete = false;
      while (page <= maxPages) {
        const query = { page, size: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: step.url, query, cookies });
        }
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({ operation: step.kind, page });
        }
        const resp = await this._fetchFn({
          url: step.url,
          cookies,
          query,
          sign,
        });
        const items = extractList(resp);
        if (!items.length) break;
        let reachedWatermark = false;
        for (const it of items) {
          const rec = step.map(it);
          if (!rec) continue;
          const ts = step.ts(rec) || null;
          if (sinceMs && ts && ts < sinceMs) {
            reachedWatermark = true;
            break;
          }
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, rec.recordId),
            capturedAt: ts || Date.now(),
            payload: { record: rec, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (reachedWatermark || items.length < PAGE_SIZE) {
          stepComplete = true;
          break;
        }
        page += 1;
      }
      if (!stepComplete) scanComplete = false;
    }
    if (
      scanComplete &&
      selectedKinds > 0 &&
      typeof opts.markWatermarkComplete === "function"
    ) {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("MeiyouAdapter.normalize: payload.record missing");
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

    if (kind === KIND_PERIOD) {
      const occurredAt = rec.startMs || raw.capturedAt || ingestedAt;
      return {
        events: [
          {
            id: newId(),
            type: ENTITY_TYPES.EVENT,
            subtype: EVENT_SUBTYPES.OTHER,
            occurredAt,
            actor: "person-self",
            content: { title: "经期记录", text: "经期记录" },
            ingestedAt,
            source,
            extra: {
              platform: "meiyou",
              kind: KIND_PERIOD,
              startMs: rec.startMs || null,
              endMs: rec.endMs || null,
              cycleLength: rec.cycleLength,
              periodLength: rec.periodLength,
            },
          },
        ],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }
    // record (health diary)
    const occurredAt = rec.dateMs || raw.capturedAt || ingestedAt;
    const label = `健康记录: ${rec.recordType}`;
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.OTHER,
          occurredAt,
          actor: "person-self",
          content: { title: label.slice(0, 80), text: label },
          ingestedAt,
          source,
          extra: {
            platform: "meiyou",
            kind: KIND_RECORD,
            recordType: rec.recordType,
            value: rec.value != null ? rec.value : null,
            note: rec.note || null,
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
  throw new Error("health-meiyou: no fetchFn configured for cookie-api mode");
}

module.exports = {
  MeiyouAdapter,
  mapPeriod,
  mapRecord,
  extractList,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
