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
 *      (or constructor `signProvider`). The signature is sent only as a header;
 *      it is never appended to the URL. When absent the request is issued
 *      unsigned and an HTTP authentication / anti-bot rejection is surfaced by
 *      the host transport without advancing the watermark.
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
const { createAccountScopeFromAccount } = require("../../account-scope");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const {
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "social-zhihu";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ANSWER = "answer";
const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_ANSWER,
  KIND_FAVOURITE,
  KIND_FOLLOW,
]);

// Best-effort zhihu /api/v4 endpoints. `{token}` is replaced with url_token.
// Overridable via opts.answersUrl / opts.followeesUrl / opts.collectionsUrl.
const ANSWERS_URL = "https://www.zhihu.com/api/v4/members/{token}/answers";
const FOLLOWEES_URL = "https://www.zhihu.com/api/v4/members/{token}/followees";
const COLLECTIONS_URL =
  "https://www.zhihu.com/api/v4/people/{token}/collections";
const PAGE_LIMIT = 20;
const ZHIHU_REQUEST_HEADERS = Object.freeze({
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "x-requested-with": "XMLHttpRequest",
});

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
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "urlToken",
    ]);

    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "zhihu", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      answers: opts.answersUrl || ANSWERS_URL,
      followees: opts.followeesUrl || FOLLOWEES_URL,
      collections: opts.collectionsUrl || COLLECTIONS_URL,
    };

    this.name = NAME;
    this.runtimeScopeIdentityKey = "urlToken";
    this.version = VERSION;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
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
    if (hasRuntimeCookie(ctx) && !hasRuntimeUrlToken(ctx)) {
      return {
        ok: false,
        reason: "NO_ACCOUNT_URL_TOKEN",
        message:
          "cookie-api mode requires opts.accountId (Zhihu member url_token) for an isolated watermark scope",
      };
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "zhihu",
      identityKey: "urlToken",
    });
    if (cookieAuth) {
      const ok = await cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      if (!account || !account.urlToken) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_URL_TOKEN",
          message:
            "cookie-api mode requires account.urlToken or opts.accountId (Zhihu member url_token)",
        };
      }
      return { ok: true, account: account.urlToken, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-zhihu.authenticate: needs opts.inputPath (snapshot mode) OR configured account.cookies + urlToken OR opts.cookie + opts.accountId (cookie-api mode)",
    };
  }

  async healthCheck(opts = {}) {
    const result = await this.authenticate(opts);
    return result.ok
      ? { ok: true, lastChecked: Date.now() }
      : {
          ok: false,
          reason: result.reason,
          error: result.error || result.message,
        };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (this._cookieAuth || hasRuntimeCookie(opts)) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error(
      "social-zhihu.sync: needs opts.inputPath (snapshot mode) OR configured account.cookies + urlToken OR opts.cookie + opts.accountId (cookie-api mode; some Zhihu endpoints need x-zse-96 via opts.signProvider)",
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
      const kind = ev.kind;
      if (!VALID_SNAPSHOT_KINDS.includes(kind)) continue;
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) ||
        parseTime(ev.createdTime) ||
        fallbackCapturedAt;
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
    if (hasRuntimeCookie(opts) && !hasRuntimeUrlToken(opts)) {
      throw new Error(
        "social-zhihu._syncViaCookie: opts.accountId required for transient cookie collection",
      );
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "zhihu",
      identityKey: "urlToken",
    });
    if (!account || !account.urlToken) {
      throw new Error(
        "social-zhihu._syncViaCookie: account.urlToken or opts.accountId required",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const cookies = cookieAuth.toHeader();
    const token = encodeURIComponent(account.urlToken);
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
        kind: KIND_ANSWER,
        url: this._urls.answers,
        mapId: (it) => `answer-${it.id}`,
      },
      {
        kind: KIND_FOLLOW,
        url: this._urls.followees,
        mapId: (it) => `follow-${it.url_token || it.id}`,
      },
      {
        kind: KIND_FAVOURITE,
        url: this._urls.collections,
        mapId: (it) => `fav-${it.id}`,
      },
    ];
    if (plan.every((step) => include[step.kind] === false)) return;

    let emitted = 0;
    let scanComplete = true;
    let sourceRequests = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      if (sourceRequests >= maxPages) {
        scanComplete = false;
        break;
      }
      const baseUrl = step.url.replace("{token}", token);
      let offset = 0;
      let page = 0;
      let streamComplete = false;
      while (sourceRequests < maxPages) {
        const query = { limit: PAGE_LIMIT, offset };
        let signature = null;
        if (this._signProvider) {
          signature = await this._signProvider({
            url: baseUrl,
            query,
            cookies,
          });
        }
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({ operation: step.kind, page });
        }
        sourceRequests += 1;
        const resp = await this._fetchFn({
          url: baseUrl,
          cookies,
          query,
          headers: buildZhihuHeaders(account.urlToken, signature),
        });
        if (!hasDataList(resp)) break;
        const items = extractData(resp);
        if (!items.length) {
          streamComplete = true;
          break;
        }
        let reachedWatermark = false;
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          const capturedAt = cookieItemTime(step.kind, it);
          if (capturedAt < sinceMs) {
            reachedWatermark = true;
            break;
          }
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, step.mapId(it)),
            capturedAt,
            payload: { item: it, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (
          reachedWatermark ||
          responseEndsStream(resp, items.length, PAGE_LIMIT)
        ) {
          streamComplete = true;
          break;
        }
        offset += items.length;
        page += 1;
      }
      if (!streamComplete) scanComplete = false;
    }
    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
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

function hasDataList(resp) {
  return !!(
    resp &&
    typeof resp === "object" &&
    (Array.isArray(resp.data) || Array.isArray(resp.items))
  );
}

function responseEndsStream(resp, itemCount, pageLimit) {
  if (
    resp &&
    resp.paging &&
    typeof resp.paging === "object" &&
    typeof resp.paging.is_end === "boolean"
  ) {
    return resp.paging.is_end;
  }
  return itemCount < pageLimit;
}

function buildZhihuHeaders(urlToken, signature) {
  const headers = {
    ...ZHIHU_REQUEST_HEADERS,
    referer: `https://www.zhihu.com/people/${encodeURIComponent(urlToken)}`,
  };
  const xZse96 =
    typeof signature === "string"
      ? signature
      : signature && typeof signature === "object"
        ? signature.xZse96 ||
          signature["x-zse-96"] ||
          (signature.headers && signature.headers["x-zse-96"])
        : null;
  if (typeof xZse96 === "string" && xZse96.trim().length > 0) {
    headers["x-zse-96"] = xZse96;
  }
  return headers;
}

function hasRuntimeUrlToken(opts = {}) {
  const value = opts.urlToken != null ? opts.urlToken : opts.accountId;
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
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
    parseTime(
      it.createdTime || it.created_time || it.created || raw.capturedAt,
    ) || ingestedAt;
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
          voteupCount:
            it.voteupCount != null ? it.voteupCount : it.voteup_count || 0,
          commentCount:
            it.commentCount != null ? it.commentCount : it.comment_count || 0,
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
          zhihuItemId:
            (it.itemId || it.id) != null ? String(it.itemId || it.id) : null,
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
  const memberToken =
    it.memberToken || it.url_token || it.id || `unknown-${newId()}`;
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
