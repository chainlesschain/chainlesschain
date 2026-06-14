/**
 * §A13 — 懂车帝 (Dongchedi, com.ss.android.auto) adapter, dual-mode (snapshot +
 * cookie-api). Phase 13+ §12.1 line-784 ROI ⭐⭐ "汽车关注".
 *
 * 懂车帝 (ByteDance auto vertical) personal data = the user's car-interest
 * footprint: car series / creators they follow, and articles / videos / series
 * they favourited. Both are interest signals → favourite maps to a LIKE event,
 * follow to a contact Person (the followed series/creator). Mirrors the
 * social-zhihu two-mode shape.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch the user's favourites +
 *      follows from dongchedi.com via the injected `fetchFn`, paginate; a sign
 *      seam (opts.signProvider) covers ByteDance's signed-request token (X-Bogus
 *      / msToken family); best-effort unsigned when absent. Endpoints overridable
 *      via opts.favouritesUrl / opts.followsUrl (best-effort, not field-verified
 *      — FAMILY-23 playbook). account OPTIONAL — the cookie carries identity.
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "favourite", "id": "fav-<id>", "itemId": "...", "title": "...",
 *         "contentType": "article|video|series", "url": "...", "capturedAt": <ms> },
 *       { "kind": "follow", "id": "follow-<id>", "followId": "...", "name": "...",
 *         "followType": "series|creator", "url": "...", "capturedAt": <ms> }
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

const NAME = "social-dongchedi";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_FAVOURITE, KIND_FOLLOW]);

// Best-effort dongchedi.com endpoints. Overridable via opts.*Url.
const FAVOURITES_URL = "https://www.dongchedi.com/motor/profile/get_favorite_list";
const FOLLOWS_URL = "https://www.dongchedi.com/motor/profile/get_follow_list";
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
  return `dongchedi:${kind}:${safe}`;
}

class DongchediAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "dongchedi", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      favourites: opts.favouritesUrl || FAVOURITES_URL,
      follows: opts.followsUrl || FOLLOWS_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:dongchedi-favourite",
      "parse:dongchedi-follow",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "dongchedi:favourite (title / contentType / url)",
        "dongchedi:follow (name / followType)",
      ],
      sensitivity: "low",
      legalGate: false,
      defaultInclude: { favourite: true, follow: true },
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
      return { ok: true, account: (this.account && this.account.userId) || null, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-dongchedi.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok ? { ok: true, lastChecked: Date.now() } : { ok: false, reason: r.reason, error: r.error };
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
      "social-dongchedi.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(
        `social-dongchedi.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallback =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account = snapshot.account && typeof snapshot.account === "object" ? snapshot.account : null;
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object" || !VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;
      const id = (typeof ev.id === "string" && ev.id) || ev.itemId || ev.followId || null;
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
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    const plan = [
      { kind: KIND_FAVOURITE, url: this._urls.favourites },
      { kind: KIND_FOLLOW, url: this._urls.follows },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      let offset = 0;
      let page = 0;
      while (page < maxPages) {
        const query = { offset, count: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: step.url, query, cookies });
        }
        const resp = await this._fetchFn({ url: step.url, cookies, query, sign });
        const items = extractData(resp);
        if (!items.length) break;
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          if (emitted >= limit) return;
          const id = step.kind === KIND_FOLLOW
            ? it.follow_id || it.user_id || it.series_id || it.id
            : it.group_id || it.item_id || it.id;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, id),
            capturedAt: parseTime(it.create_time || it.favorite_time || it.follow_time) || Date.now(),
            payload: { item: it, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (isEnd(resp) || items.length < PAGE_SIZE) break;
        offset += items.length;
        page += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) throw new Error("DongchediAdapter.normalize: payload missing");
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    if (kind === KIND_FAVOURITE) return normalizeFavourite(raw, ingestedAt);
    if (kind === KIND_FOLLOW) return normalizeFollow(raw, ingestedAt);
    throw new Error(`DongchediAdapter.normalize: unknown kind ${kind}`);
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
    if (Array.isArray(d.favorite_list)) return d.favorite_list;
    if (Array.isArray(d.follow_list)) return d.follow_list;
    if (Array.isArray(d.records)) return d.records;
  }
  return [];
}

function isEnd(resp) {
  const d = resp && resp.data && typeof resp.data === "object" ? resp.data : resp;
  if (d && typeof d === "object" && (d.has_more === false || d.has_more === 0)) return true;
  return false;
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

function normalizeFavourite(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const title = it.title || it.group_title || it.name || "";
  const occurredAt = parseTime(it.capturedAt || it.create_time || it.favorite_time || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.LIKE,
        occurredAt,
        actor: "person-self",
        content: { title: `收藏: ${title}`.trim(), text: title },
        ingestedAt,
        source,
        extra: {
          platform: "dongchedi",
          itemId: (it.itemId || it.group_id || it.item_id || it.id) != null
            ? String(it.itemId || it.group_id || it.item_id || it.id) : null,
          contentType: it.contentType || it.content_type || it.type || null,
          url: it.url || it.share_url || null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeFollow(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const followId = it.followId || it.follow_id || it.user_id || it.series_id || it.id || `unknown-${newId()}`;
  const name = it.name || it.series_name || it.user_name || it.screen_name || "(unnamed)";
  const followType = it.followType || it.follow_type || (it.series_id ? "series" : "creator");
  const occurredAt = parseTime(it.capturedAt || it.follow_time || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const person = {
    id: `person-dongchedi-${followId}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [name],
    ingestedAt,
    source,
    identifiers: { "dongchedi-id": [String(followId)] },
    extra: {
      platform: "dongchedi",
      followType,
      url: it.url || it.share_url || null,
      followedAt: occurredAt,
    },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

async function defaultFetch(_opts) {
  throw new Error("social-dongchedi: no fetchFn configured for cookie-api mode");
}

module.exports = {
  DongchediAdapter,
  extractData,
  isEnd,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
