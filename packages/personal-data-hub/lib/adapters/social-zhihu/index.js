/**
 * §A9 — Zhihu (知乎) adapter, dual-mode (snapshot + cookie-api).
 *
 * 知乎 (com.zhihu.android) is a Phase 13+ roadmap platform (ROI ⭐⭐⭐ in
 * docs/design/Personal_Data_Hub_Architecture.md §12.1, "收藏 + 关注 + 自己回答")
 * — the highest-value feasible long-tail social source: 知乎's own-data web API
 * (zhihu.com /api/v4) is cookie-accessible and device-independent, feeding the
 * "interests" analysis skill. Mirrors the social-weibo two-mode shape but uses
 * cookie-api (not sqlite) since 知乎 has a clean web API and no need for a pulled
 * device DB.
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc / browser-extension /
 *      curated JSON. account OPTIONAL — the snapshot carries account.
 *
 *   2. cookie-api mode (opts.account.cookies + account.urlToken): fetch the
 *      logged-in user's answers / followees / collections via the injected
 *      `fetchFn` (Android in-APK cc → OkHttp; desktop hub → Electron WebView net
 *      request) so this module stays a pure-Node parser + orchestrator. Zhihu's
 *      /api/v4 member endpoints key off the user's `url_token`, so account.urlToken
 *      is REQUIRED in cookie mode (checked at sync time). Pagination follows
 *      zhihu's `{ data, paging: { is_end, next, ... } }` offset cursor.
 *
 *      ── sign seam ──────────────────────────────────────────────────────────
 *      Some zhihu /api/v4 endpoints require an `x-zse-96` signature header
 *      computed by client-side JS (analogous to 抖音 X-Bogus). No pure-Node impl
 *      survives the rotation, so signing is injected via `opts.signProvider`
 *      (or constructor `signProvider`). When absent the request is still issued
 *      unsigned — best-effort, the endpoint may reject it, which surfaces as zero
 *      events rather than a crash. Endpoint constants are best-effort and
 *      overridable via opts.*Url; zhihu rotates these (FAMILY-23 playbook —
 *      endpoints are not field-verified here).
 *
 * Snapshot schema (schemaVersion 1):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "urlToken": "...", "name": "..." },
 *     "events": [
 *       { "kind": "answer",    "id": "answer-<id>",  "answerId": "...",
 *         "questionTitle": "...", "excerpt": "...", "voteupCount": N,
 *         "commentCount": N, "createdTime": <s|ms>, "url": "..." },
 *       { "kind": "favourite", "id": "fav-<id>",     "itemId": "...",
 *         "title": "...", "url": "...", "collectionName": "...", "capturedAt": <ms> },
 *       { "kind": "follow",    "id": "follow-<token>", "memberToken": "...",
 *         "name": "...", "headline": "...", "avatarUrl": "...", "capturedAt": <ms> }
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

const NAME = "social-zhihu";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ANSWER = "answer";
const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ANSWER, KIND_FAVOURITE, KIND_FOLLOW]);

// Best-effort zhihu /api/v4 endpoints. `{token}` is replaced with url_token.
// Overridable via opts.answersUrl / opts.followeesUrl / opts.collectionsUrl.
const ANSWERS_URL = "https://www.zhihu.com/api/v4/members/{token}/answers";
const FOLLOWEES_URL = "https://www.zhihu.com/api/v4/members/{token}/followees";
const COLLECTIONS_URL = "https://www.zhihu.com/api/v4/people/{token}/collections";
const PAGE_LIMIT = 20;

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `zhihu:${kind}:${safe}`;
}

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

class ZhihuAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;

    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "zhihu", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      answers: opts.answersUrl || ANSWERS_URL,
      followees: opts.followeesUrl || FOLLOWEES_URL,
      collections: opts.collectionsUrl || COLLECTIONS_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:zhihu-answer",
      "parse:zhihu-favourite",
      "parse:zhihu-follow",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "zhihu:answer (questionTitle / excerpt / voteupCount)",
        "zhihu:favourite (title / url / collectionName)",
        "zhihu:follow (memberToken / name / headline)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { answer: true, favourite: true, follow: true },
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require.
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
      if (!this.account || !this.account.urlToken) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_URL_TOKEN",
          message: "cookie-api mode requires account.urlToken (zhihu member url_token)",
        };
      }
      return { ok: true, account: this.account.urlToken, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-zhihu.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies + urlToken (cookie-api mode)",
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
      "social-zhihu.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies + urlToken (cookie-api mode; some zhihu endpoints need x-zse-96 via opts.signProvider)",
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
        `social-zhihu.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      const kind = ev.kind;
      if (!VALID_SNAPSHOT_KINDS.includes(kind)) continue;
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) || parseTime(ev.createdTime) || fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.answerId ||
        ev.itemId ||
        ev.memberToken ||
        null;

      yield {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!this.account || !this.account.urlToken) {
      throw new Error(
        "social-zhihu._syncViaCookie: account.urlToken required (set via new ZhihuAdapter({ account: { urlToken, cookies } }))",
      );
    }
    if (!(await this._cookieAuth.validate())) return;
    const token = encodeURIComponent(this.account.urlToken);
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    const plan = [
      { kind: KIND_ANSWER, url: this._urls.answers, idOf: (it) => it.id, mapId: (it) => `answer-${it.id}` },
      { kind: KIND_FOLLOW, url: this._urls.followees, idOf: (it) => it.url_token || it.id, mapId: (it) => `follow-${it.url_token || it.id}` },
      { kind: KIND_FAVOURITE, url: this._urls.collections, idOf: (it) => it.id, mapId: (it) => `fav-${it.id}` },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      const baseUrl = step.url.replace("{token}", token);
      let offset = 0;
      let page = 0;
      while (page < maxPages) {
        const query = { limit: PAGE_LIMIT, offset };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({
            url: baseUrl,
            query,
            cookies: this._cookieAuth.toHeader(),
          });
        }
        const resp = await this._fetchFn({
          url: baseUrl,
          cookies: this._cookieAuth.toHeader(),
          query,
          sign,
        });
        const items = extractData(resp);
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
        if (isEnd(resp) || items.length < PAGE_LIMIT) break;
        offset += items.length;
        page += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("ZhihuAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    if (kind === KIND_ANSWER) return normalizeAnswer(raw, ingestedAt);
    if (kind === KIND_FAVOURITE) return normalizeFavourite(raw, ingestedAt);
    if (kind === KIND_FOLLOW) return normalizeFollow(raw, ingestedAt);
    throw new Error(`ZhihuAdapter.normalize: unknown kind ${kind}`);
  }
}

// ─── cookie-api response helpers ─────────────────────────────────────────────

/** Pull the data array from a zhihu /api/v4 paginated response. */
function extractData(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.items)) return resp.items;
  return [];
}

function isEnd(resp) {
  return !!(resp && resp.paging && resp.paging.is_end === true);
}

function cookieItemTime(kind, it) {
  if (kind === KIND_ANSWER) {
    return parseTime(it.created_time || it.updated_time) || Date.now();
  }
  if (kind === KIND_FAVOURITE) {
    return parseTime(it.created || it.updated_time) || Date.now();
  }
  return Date.now();
}

// ─── per-kind normalizers (snapshot direct fields OR cookie payload.item) ─────

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeAnswer(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const questionTitle = p.cookie
    ? (it.question && it.question.title) || it.title || ""
    : it.questionTitle || it.title || "";
  const excerpt = it.excerpt || it.excerpt_new || it.content || "";
  const answerId = it.answerId || it.id || null;
  const occurredAt =
    parseTime(it.createdTime || it.created_time || it.created || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.POST,
        occurredAt,
        actor: "person-self",
        content: {
          title: (questionTitle || excerpt || "").slice(0, 80) || "(空)",
          text: stripHtml(excerpt),
        },
        ingestedAt,
        source,
        extra: {
          platform: "zhihu",
          zhihuAnswerId: answerId != null ? String(answerId) : null,
          questionTitle: questionTitle || null,
          voteupCount: it.voteupCount != null ? it.voteupCount : it.voteup_count || 0,
          commentCount: it.commentCount != null ? it.commentCount : it.comment_count || 0,
          url:
            it.url ||
            (answerId ? `https://www.zhihu.com/answer/${answerId}` : null),
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
  const title = it.title || it.collectionName || "";
  const occurredAt =
    parseTime(it.capturedAt || it.created || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.LIKE,
        occurredAt,
        actor: "person-self",
        content: {
          title: (title || "").slice(0, 80) || "(空)",
          text: title,
        },
        ingestedAt,
        source,
        extra: {
          platform: "zhihu",
          zhihuItemId: (it.itemId || it.id) != null ? String(it.itemId || it.id) : null,
          collectionName: it.collectionName || it.title || null,
          isPublic: it.is_public != null ? it.is_public : undefined,
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

function normalizeFollow(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const memberToken = it.memberToken || it.url_token || it.id || `unknown-${newId()}`;
  const name = it.name || "(unnamed)";
  const occurredAt = parseTime(it.capturedAt || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const person = {
    id: `person-zhihu-${memberToken}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [name],
    ingestedAt,
    source,
    identifiers: {
      "zhihu-token": [String(memberToken)],
    },
    extra: {
      platform: "zhihu",
      headline: it.headline || null,
      avatarUrl: it.avatarUrl || it.avatar_url || null,
      followedAt: occurredAt,
    },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

function stripHtml(s) {
  if (typeof s !== "string") return "";
  return s.replace(/<[^>]+>/g, "").trim();
}

async function defaultFetch(_opts) {
  throw new Error("social-zhihu: no fetchFn configured for cookie-api mode");
}

module.exports = {
  ZhihuAdapter,
  extractData,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
