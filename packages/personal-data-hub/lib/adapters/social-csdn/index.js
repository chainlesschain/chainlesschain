/**
 * §A11 — CSDN (net.csdn.csdnplus) adapter, dual-mode (snapshot + cookie-api).
 * Phase 13+ §12.1 line-783 ROI ⭐⭐⭐ "技术阅读 + 收藏".
 *
 * CSDN's personal data is the user's tech-content footprint: blog posts they
 * authored, articles they favourited (收藏 = strong interest signal), and authors
 * they follow. Maps cleanly to the same answer/favourite/follow shape as
 * social-zhihu (article↔answer), so it mirrors that adapter.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies + account.username): fetch the
 *      user's articles / favourites / followees from csdn.net via the injected
 *      `fetchFn` (Android in-APK cc → OkHttp; desktop hub → Electron WebView net
 *      request). CSDN's home-api keys off the user's `username`, so
 *      account.username is REQUIRED in cookie mode. A sign seam (opts.signProvider)
 *      covers any anti-bot token; best-effort unsigned. Endpoints overridable via
 *      opts.*Url (best-effort, not field-verified — FAMILY-23 playbook).
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "username": "...", "name": "..." },
 *     "events": [
 *       { "kind": "article",   "id": "article-<id>", "articleId": "...", "title": "...",
 *         "url": "...", "viewCount": N, "collectCount": N, "createdTime": <s|ms> },
 *       { "kind": "favourite", "id": "fav-<id>", "itemId": "...", "title": "...",
 *         "url": "...", "source": "...", "capturedAt": <ms> },
 *       { "kind": "follow",    "id": "follow-<u>", "username": "...", "name": "...",
 *         "url": "...", "capturedAt": <ms> }
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

const NAME = "social-csdn";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ARTICLE = "article";
const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ARTICLE, KIND_FAVOURITE, KIND_FOLLOW]);

// Best-effort CSDN home-api endpoints. `{user}` replaced with username.
const ARTICLES_URL =
  "https://blog.csdn.net/community/home-api/v1/get-business-list";
const FAVOURITES_URL = "https://me.csdn.net/api/favorite/list";
const FOLLOWEES_URL =
  "https://blog.csdn.net/community/home-api/v1/get-follow-list";
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
  return `csdn:${kind}:${safe}`;
}

function stripHtml(s) {
  return typeof s === "string" ? s.replace(/<[^>]+>/g, "").trim() : "";
}

class CsdnAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "csdn", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      articles: opts.articlesUrl || ARTICLES_URL,
      favourites: opts.favouritesUrl || FAVOURITES_URL,
      followees: opts.followeesUrl || FOLLOWEES_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:csdn-article",
      "parse:csdn-favourite",
      "parse:csdn-follow",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "csdn:article (title / viewCount / collectCount)",
        "csdn:favourite (title / url / source)",
        "csdn:follow (username / name)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { article: true, favourite: true, follow: true },
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
      if (!this.account || !this.account.username) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USERNAME",
          message: "cookie-api mode requires account.username (CSDN blog username)",
        };
      }
      return { ok: true, account: this.account.username, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-csdn.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies + username (cookie-api mode)",
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
      "social-csdn.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies + username (cookie-api mode)",
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
        `social-csdn.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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

      const capturedAt =
        parseTime(ev.capturedAt) || parseTime(ev.createdTime) || fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.articleId ||
        ev.itemId ||
        ev.username ||
        null;

      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!this.account || !this.account.username) {
      throw new Error(
        "social-csdn._syncViaCookie: account.username required (set via new CsdnAdapter({ account: { username, cookies } }))",
      );
    }
    if (!(await this._cookieAuth.validate())) return;
    const user = encodeURIComponent(this.account.username);
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    const plan = [
      { kind: KIND_ARTICLE, url: this._urls.articles, mapId: (it) => `article-${it.articleId || it.id || it.url}` },
      { kind: KIND_FAVOURITE, url: this._urls.favourites, mapId: (it) => `fav-${it.id || it.source_id || it.url}` },
      { kind: KIND_FOLLOW, url: this._urls.followees, mapId: (it) => `follow-${it.username || it.userName || it.id}` },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      const baseUrl = step.url.replace("{user}", user);
      let page = 1;
      while (page <= maxPages) {
        const query = { page, size: PAGE_SIZE, username: this.account.username };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: baseUrl, query, cookies: this._cookieAuth.toHeader() });
        }
        const resp = await this._fetchFn({
          url: baseUrl,
          cookies: this._cookieAuth.toHeader(),
          query,
          sign,
        });
        const items = extractList(resp);
        if (!items.length) break;
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, step.mapId(it)),
            capturedAt: cookieItemTime(step.kind, it),
            payload: { item: it, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (items.length < PAGE_SIZE) break;
        page += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("CsdnAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    if (kind === KIND_ARTICLE) return normalizeArticle(raw, ingestedAt);
    if (kind === KIND_FAVOURITE) return normalizeFavourite(raw, ingestedAt);
    if (kind === KIND_FOLLOW) return normalizeFollow(raw, ingestedAt);
    throw new Error(`CsdnAdapter.normalize: unknown kind ${kind}`);
  }
}

// ─── cookie response helpers ─────────────────────────────────────────────────

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

function cookieItemTime(kind, it) {
  if (kind === KIND_ARTICLE) {
    return parseTime(it.createdTime || it.formatTime || it.postTime || it.created_at) || Date.now();
  }
  if (kind === KIND_FAVOURITE) {
    return parseTime(it.created_at || it.create_time || it.favoriteTime) || Date.now();
  }
  return Date.now();
}

// ─── per-kind normalizers ────────────────────────────────────────────────────

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeArticle(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const title = stripHtml(it.title || "");
  const articleId = it.articleId || it.id || null;
  const occurredAt =
    parseTime(it.createdTime || it.created_at || it.postTime || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.POST,
        occurredAt,
        actor: "person-self",
        content: { title: title.slice(0, 80) || "(无标题)", text: title },
        ingestedAt,
        source,
        extra: {
          platform: "csdn",
          csdnArticleId: articleId != null ? String(articleId) : null,
          viewCount: it.viewCount != null ? it.viewCount : it.view_count || 0,
          collectCount: it.collectCount != null ? it.collectCount : it.favor_count || 0,
          url: it.url || null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeFavourite(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const title = stripHtml(it.title || it.source_title || "");
  const occurredAt =
    parseTime(it.capturedAt || it.created_at || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.LIKE,
        occurredAt,
        actor: "person-self",
        content: { title: title.slice(0, 80) || "(无标题)", text: title },
        ingestedAt,
        source,
        extra: {
          platform: "csdn",
          csdnItemId: (it.itemId || it.id || it.source_id) != null ? String(it.itemId || it.id || it.source_id) : null,
          source: it.source || it.url_source || null,
          url: it.url || it.source_url || null,
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
  const uname = it.username || it.userName || it.id || `unknown-${newId()}`;
  const name = it.name || it.nickname || it.nickName || uname;
  const occurredAt = parseTime(it.capturedAt || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const person = {
    id: `person-csdn-${uname}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [name],
    ingestedAt,
    source,
    identifiers: { "csdn-username": [String(uname)] },
    extra: {
      platform: "csdn",
      url: it.url || (it.username ? `https://blog.csdn.net/${it.username}` : null),
      followedAt: occurredAt,
    },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

async function defaultFetch(_opts) {
  throw new Error("social-csdn: no fetchFn configured for cookie-api mode");
}

module.exports = {
  CsdnAdapter,
  extractList,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
