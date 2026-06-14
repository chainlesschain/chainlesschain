/**
 * §12.1 Phase 13+ ⭐⭐ — 交管12123 (com.tmri.app.main) adapter, "驾驶证 + 违章".
 * BEST-EFFORT SCAFFOLD (user-requested).
 *
 * ⚠️ SENSITIVE (gov real-name traffic/vehicle data). The 12123 app has NO
 * documented public API; the cookie-api endpoints below are FABRICATED
 * placeholders (overridable, NOT field-verified — FAMILY-23 playbook) and
 * cannot authenticate without the gov real-name login. **snapshot mode is the
 * reliable path**; cookie path surfaces auth.unverified=true. Gated
 * sensitivity:"high" + legalGate:true.
 *
 * Two record kinds:
 *   - "violation" 违章记录: { violationId, time, location, reason, fine, points }
 *                 → EVENT(OTHER) "交通违章: <reason>".
 *   - "license"   驾驶证状态: { licenseId, status, cumulativePoints(累计记分),
 *                 validUntil } → EVENT(OTHER) "驾驶证状态".
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "violation", "id": "v-<id>", "violationId": "...", "time": <s|ms>,
 *         "location": "...", "reason": "超速", "fine": 200, "points": 3 },
 *       { "kind": "license", "id": "l-<id>", "licenseId": "...", "status": "正常",
 *         "cumulativePoints": 3, "validUntil": <s|ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "gov-12123";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_VIOLATION = "violation";
const KIND_LICENSE = "license";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_VIOLATION, KIND_LICENSE]);
const VIOLATION_URL = "https://gab.122.gov.cn/api/v1/violation/list";
const LICENSE_URL = "https://gab.122.gov.cn/api/v1/license/info";
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

function toNum(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,，¥\s元分]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapViolation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.violationId || raw.violation_id || raw.id || raw.wzbh || raw.serialNo;
  if (id == null) return null;
  return {
    violationId: String(id),
    timeMs: parseTime(raw.time || raw.violationTime || raw.wfsj || raw.date),
    location: raw.location || raw.address || raw.wfdz || raw.place || null,
    reason: raw.reason || raw.behavior || raw.wfxw || raw.desc || "交通违法",
    fine: toNum(raw.fine != null ? raw.fine : raw.fkje != null ? raw.fkje : raw.amount),
    points: toNum(raw.points != null ? raw.points : raw.wfjfs != null ? raw.wfjfs : raw.score),
  };
}

function mapLicense(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.licenseId || raw.license_id || raw.id || raw.dabh || raw.fileNo;
  if (id == null) return null;
  return {
    licenseId: String(id),
    status: raw.status || raw.statusName || raw.zt || raw.state || null,
    cumulativePoints: toNum(raw.cumulativePoints != null ? raw.cumulativePoints : raw.ljjf != null ? raw.ljjf : raw.totalPoints),
    validUntilMs: parseTime(raw.validUntil || raw.yxqz || raw.expireDate || raw.valid_until),
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

// License endpoint returns a single object (not a paginated list); wrap it.
function extractLicense(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (resp.data && typeof resp.data === "object" && !Array.isArray(resp.data)) return [resp.data];
  if (resp.licenseId || resp.dabh || resp.id) return [resp];
  return extractList(resp);
}

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `12123:${kind}:${safe}`;
}

class Tmri12123Adapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies ? new CookieAuth({ platform: "12123", cookies: opts.account.cookies }) : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider = typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      violation: opts.violationUrl || opts.listUrl || VIOLATION_URL,
      license: opts.licenseUrl || LICENSE_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:snapshot", "sync:cookie-api", "parse:12123-violation", "parse:12123-license"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 6, perDay: 100 };
    this.dataDisclosure = {
      fields: [
        "12123:violation (time / location / reason / fine / points)",
        "12123:license (status / cumulativePoints / validUntil)",
      ],
      sensitivity: "high",
      legalGate: true,
      defaultInclude: { violation: true, license: true },
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
      message: "gov-12123.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode, best-effort/unverified)",
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
    throw new Error("gov-12123.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)");
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`gov-12123.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`);
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
      const rec = ev.kind === KIND_VIOLATION ? mapViolation(ev) : mapLicense(ev);
      if (!rec) continue;
      const recTime = ev.kind === KIND_VIOLATION ? rec.timeMs : rec.validUntilMs;
      const capturedAt = parseTime(ev.capturedAt) || recTime || fallbackCapturedAt;
      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, ev.kind === KIND_VIOLATION ? rec.violationId : rec.licenseId),
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
    const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    let emitted = 0;

    // violations (paginated)
    if (include[KIND_VIOLATION] !== false) {
      let page = 1;
      while (page <= maxPages) {
        const query = { page, size: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) sign = await this._signProvider({ url: this._urls.violation, query, cookies });
        const resp = await this._fetchFn({ url: this._urls.violation, cookies, query, sign });
        const items = extractList(resp);
        if (!items.length) break;
        for (const it of items) {
          const rec = mapViolation(it);
          if (!rec) continue;
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: KIND_VIOLATION,
            originalId: stableOriginalId(KIND_VIOLATION, rec.violationId),
            capturedAt: rec.timeMs || Date.now(),
            payload: { record: rec, kind: KIND_VIOLATION, cookie: true },
          };
          emitted += 1;
        }
        if (items.length < PAGE_SIZE) break;
        page += 1;
      }
    }

    // license (single fetch)
    if (include[KIND_LICENSE] !== false) {
      let sign = null;
      if (this._signProvider) sign = await this._signProvider({ url: this._urls.license, query: {}, cookies });
      const resp = await this._fetchFn({ url: this._urls.license, cookies, query: {}, sign });
      for (const it of extractLicense(resp)) {
        const rec = mapLicense(it);
        if (!rec) continue;
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_LICENSE,
          originalId: stableOriginalId(KIND_LICENSE, rec.licenseId),
          capturedAt: rec.validUntilMs || Date.now(),
          payload: { record: rec, kind: KIND_LICENSE, cookie: true },
        };
        emitted += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("Tmri12123Adapter.normalize: payload.record missing");
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

    if (kind === KIND_VIOLATION) {
      const occurredAt = rec.timeMs || raw.capturedAt || ingestedAt;
      return {
        events: [
          {
            id: newId(),
            type: ENTITY_TYPES.EVENT,
            subtype: EVENT_SUBTYPES.OTHER,
            occurredAt,
            actor: "person-self",
            content: { title: `交通违章: ${rec.reason}`.slice(0, 80), text: rec.reason },
            ingestedAt,
            source,
            extra: {
              platform: "12123",
              kind: KIND_VIOLATION,
              location: rec.location || null,
              fine: rec.fine,
              points: rec.points,
            },
          },
        ],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }
    // license
    const occurredAt = rec.validUntilMs || raw.capturedAt || ingestedAt;
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.OTHER,
          occurredAt,
          actor: "person-self",
          content: { title: `驾驶证状态: ${rec.status || "未知"}`.slice(0, 80), text: "驾驶证状态" },
          ingestedAt,
          source,
          extra: {
            platform: "12123",
            kind: KIND_LICENSE,
            status: rec.status || null,
            cumulativePoints: rec.cumulativePoints,
            validUntilMs: rec.validUntilMs || null,
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
  throw new Error("gov-12123: no fetchFn configured for cookie-api mode");
}

module.exports = {
  Tmri12123Adapter,
  mapViolation,
  mapLicense,
  extractList,
  extractLicense,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
