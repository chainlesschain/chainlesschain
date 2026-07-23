/**
 * §12.1 Phase 13+ ⭐⭐ — i 厦门 (com.xmgov.xmapp) adapter, "本地政务".
 *
 * i 厦门 is a local-government
 * super-app (社保 / 公积金 / 医保 / 政务办事 / 预约) behind real-name gov SSO.
 * Unlike the document / shopping / travel adapters it has **no verifiable
 * public API**. Static APK analysis (com.xmgov.xmapp, 2026-06-16) CONFIRMED the
 * real backend host (see IXIAMEN_LIST_URL), but the exact 办事记录 list sub-path
 * and request/response body stay UNVERIFIED — bodies are encrypted by
 * libzxprotect/libijmDataEncryption, so the endpoint cannot be fully derived
 * statically and cannot authenticate without gov real-name login. The reliable
 * path is therefore **snapshot mode** (the app / a manual export produces a JSON
 * of the user's 办事记录). The cookie path is kept as a seam (overridable via
 * opts.listUrl) so it can be wired once a live capture confirms path + sign.
 *
 * Personal footprint modelled: 政务办事记录 (government-service handling). Each
 * record → an INTERACTION event ("办理: <服务名>") + a Topic for the service
 * category (社保 / 公积金 / 医保 / ...) so the vault can group which kinds of
 * civic services the user used. High sensitivity + legalGate (gov real-name
 * data) — first collection requires explicit legal confirmation.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): best-effort, unverified —
 *      paginate the handle-list via injected fetchFn; signProvider seam for
 *      the gov gateway signature; best-effort unsigned when absent.
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "service", "id": "svc-<id>", "serviceId": "...",
 *         "serviceName": "城乡居民医保缴费", "category": "医保",
 *         "handledTime": <s|ms>, "status": "已办结", "dept": "厦门市医保局" }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "gov-ixiamen";
const VERSION = "0.3.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_SERVICE = "service";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_SERVICE]);

// Host CONFIRMED via static APK analysis (com.xmgov.xmapp, 2026-06-16): the real
// i厦门 backend domain is *.ixiamen.org.cn — production business gateway is
// https://buss.ixiamen.org.cn/pbc/ (usercenter auth under /pbc/usercenter/;
// 市民卡/社保 under https://smk.ixiamen.org.cn/smk/). The host + /pbc/ business
// prefix are confirmed; the "/handle/list" tail is still BEST-EFFORT and the
// request/response body is UNVERIFIED (encrypted by libzxprotect — opaque to
// static analysis). Overridable via opts.listUrl once a live capture confirms it.
const IXIAMEN_LIST_URL = "https://buss.ixiamen.org.cn/pbc/handle/list";
const PAGE_SIZE = 20;

// Coarse service-category keyword map → grouping Topic name. Best-effort; the
// raw `category` (if present) always wins.
const CATEGORY_KEYWORDS = [
  ["社保", /社保|社会保险|养老保险|失业|工伤/],
  ["公积金", /公积金/],
  ["医保", /医保|医疗保险|门诊|住院报销/],
  ["户籍", /户籍|户口|身份证|居住证/],
  ["车驾管", /驾驶证|行驶证|车辆|违章|车驾管/],
  ["教育", /入学|学籍|教育|招生|学位/],
  ["民政", /婚姻|结婚|离婚|低保|殡葬|民政/],
  ["税务", /纳税|个税|税务|发票/],
  ["出行", /公交|地铁|出行|交通卡/],
  ["证照", /营业执照|证照|许可|备案/],
];

function inferCategory(name, explicit) {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const s = String(name || "");
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(s)) return cat;
  }
  return "其他政务";
}

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

function stableOriginalId(id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `ixiamen:service:${safe}`;
}

/** Raw service record (snapshot or cookie shape) → canonical fields. */
function mapService(raw) {
  if (!raw || typeof raw !== "object") return null;
  const serviceId =
    raw.serviceId || raw.service_id || raw.id || raw.bizId || raw.biz_id || raw.orderNo;
  if (!serviceId) return null;
  const serviceName =
    raw.serviceName || raw.service_name || raw.name || raw.title || raw.itemName || "(未命名事项)";
  return {
    serviceId: String(serviceId),
    serviceName: String(serviceName),
    category: inferCategory(serviceName, raw.category || raw.categoryName || raw.type),
    handledMs: parseTime(
      raw.handledTime || raw.handle_time || raw.handledAt || raw.createTime || raw.create_time || raw.time,
    ),
    status: raw.status || raw.statusName || raw.state || null,
    dept: raw.dept || raw.deptName || raw.department || raw.org || raw.handleOrg || null,
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

class IXiamenAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "ixiamen", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._listUrl =
      typeof opts.listUrl === "string" && opts.listUrl.length > 0
        ? opts.listUrl
        : null;
    this._liveConfigured = Boolean(this._listUrl && typeof opts.fetchFn === "function");

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
      "parse:ixiamen-service",
    ];
    this.extractMode = this._liveConfigured ? "web-api" : "file-import";
    this.rateLimits = { perMinute: 6, perDay: 100 };
    this.dataDisclosure = {
      fields: ["ixiamen:service (serviceName / category / handledTime / status / dept)"],
      // Gov real-name service records are sensitive personal data.
      sensitivity: "high",
      legalGate: true,
      defaultInclude: { service: true },
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
        message: `gov-ixiamen: /pbc host is known but the encrypted list path is not field-verified; provide captured listUrl and fetchFn (host reference: ${IXIAMEN_LIST_URL})`,
      };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
        // Honest signal: live path is unverified for this gov source.
        unverified: true,
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "gov-ixiamen.authenticate: needs opts.inputPath; custom live mode also requires cookies, listUrl, and fetchFn",
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
    if (this._cookieAuth && this._liveConfigured) {
      yield* this._syncViaCookie(opts);
      return;
    }
    if (this._cookieAuth) {
      throw new Error(
        "gov-ixiamen.sync: explicit listUrl and fetchFn required for custom cookie collection",
      );
    }
    throw new Error(
      "gov-ixiamen.sync: needs opts.inputPath (snapshot mode)",
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
        `gov-ixiamen.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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

      const rec = mapService(ev);
      if (!rec) continue;
      const capturedAt = parseTime(ev.capturedAt) || rec.handledMs || fallbackCapturedAt;
      yield {
        adapter: NAME,
        kind: KIND_SERVICE,
        originalId: stableOriginalId(rec.serviceId),
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
    if (include[KIND_SERVICE] === false) return;
    const sinceMs =
      opts.sinceWatermark != null ? parseInt(String(opts.sinceWatermark), 10) || 0 : 0;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    let emitted = 0;
    let page = 1;
    while (page <= maxPages) {
      const query = { page, size: PAGE_SIZE };
      let sign = null;
      if (this._signProvider) {
        sign = await this._signProvider({ url: this._listUrl, query, cookies });
      }
      const resp = await this._fetchFn({ url: this._listUrl, cookies, query, sign });
      const items = extractList(resp);
      if (!items.length) break;
      let reachedWatermark = false;
      for (const it of items) {
        const rec = mapService(it);
        if (!rec) continue;
        const ts = rec.handledMs || null;
        if (sinceMs && ts && ts < sinceMs) {
          reachedWatermark = true;
          break;
        }
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_SERVICE,
          originalId: stableOriginalId(rec.serviceId),
          capturedAt: ts || Date.now(),
          payload: { record: rec, cookie: true },
        };
        emitted += 1;
      }
      if (reachedWatermark || items.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("IXiamenAdapter.normalize: payload.record missing");
    }
    const rec = raw.payload.record;
    const ingestedAt = Date.now();
    const occurredAt = rec.handledMs || raw.capturedAt || ingestedAt;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt || occurredAt,
      capturedBy: CAPTURED_BY.API,
    };
    const topicId = `topic-ixiamen-cat-${rec.category}`;
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.INTERACTION,
          occurredAt,
          actor: "person-self",
          content: {
            title: `办理: ${rec.serviceName}`.slice(0, 80),
            text: rec.serviceName,
          },
          ingestedAt,
          source,
          extra: {
            platform: "ixiamen",
            serviceId: rec.serviceId,
            category: rec.category,
            status: rec.status || null,
            dept: rec.dept || null,
            topicRef: topicId,
          },
        },
      ],
      persons: [],
      places: [],
      items: [],
      topics: [
        {
          id: topicId,
          type: ENTITY_TYPES.TOPIC,
          name: rec.category,
          ingestedAt,
          source,
          extra: { platform: "ixiamen", kind: "service-category" },
        },
      ],
    };
  }
}

async function defaultFetch(_opts) {
  throw new Error("gov-ixiamen: no fetchFn configured for cookie-api mode");
}

module.exports = {
  IXiamenAdapter,
  mapService,
  extractList,
  inferCategory,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
