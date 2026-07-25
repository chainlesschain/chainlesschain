/**
 * 书影音 — Douban (豆瓣) adapter, dual-mode (snapshot + cookie-api).
 *
 * 豆瓣 (com.douban.frodo) is a Phase 13+ long-tail platform (NOT on the §12.1
 * roadmap nor the reference device, added on user request). It is the highest-
 * value remaining personal-interest source: a user's 书影音游 (book/movie/music/
 * game) marks + ratings + reviews + followed users form a rich taste/interest
 * graph feeding the "interests" analysis skill. Mirrors social-zhihu's two-mode,
 * multi-endpoint, custom-normalize shape, plus the video-base MEDIA event+item
 * pattern for marks (so the vault can both timeline a 标记 AND dedupe the subject).
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc / browser-extension /
 *      curated JSON. account OPTIONAL — the snapshot carries account.
 *
 *   2. cookie-api mode (opts.account.cookies + account.userId): fetch the
 *      logged-in user's interests / reviews / following via the injected
 *      `fetchFn`. Frodo (frodo.douban.com /api/v2) endpoints key off the user's
 *      numeric id, so account.userId is REQUIRED in cookie mode. Pagination
 *      follows Frodo's `{ start, count, total, <collection> }` offset cursor.
 *
 *      ── sign seam ──────────────────────────────────────────────────────────
 *      Frodo endpoints require an `apikey` + `_sig`/`_ts` signature computed
 *      client-side. No pure-Node impl survives the rotation, so signing is
 *      injected via `opts.signProvider`. When absent the request is still issued
 *      unsigned — best-effort, the endpoint may reject it (zero events, no
 *      crash). Endpoint constants are best-effort and overridable via opts.*Url;
 *      豆瓣 rotates these (FAMILY-23 playbook — NOT field-verified here).
 *
 * Snapshot schema (schemaVersion 1):
 *
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <epoch-ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "interest", "id": "interest-<id>", "subjectId": "...",
 *         "subjectType": "movie|book|music|game|tv|drama", "title": "...",
 *         "status": "mark|doing|done", "myRating": 4, "comment": "...",
 *         "createdTime": <s|ms>, "url": "..." },
 *       { "kind": "review", "id": "review-<id>", "title": "...", "abstract": "...",
 *         "subjectTitle": "...", "rating": 5, "createdTime": <s|ms>, "url": "..." },
 *       { "kind": "follow", "id": "follow-<uid>", "memberId": "...",
 *         "name": "...", "url": "...", "capturedAt": <ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const {
  probeJsonSnapshotFile,
  readJsonSnapshot,
} = require("../../snapshot-file");
const { createAccountScopeFromAccount } = require("../../account-scope");
const { newId } = require("../../ids");
const { extractRecognizedArray } = require("../../source-page");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  ITEM_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const {
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "social-douban";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_INTEREST = "interest";
const KIND_REVIEW = "review";
const KIND_FOLLOW = "follow";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_INTEREST,
  KIND_REVIEW,
  KIND_FOLLOW,
]);

// Best-effort Frodo /api/v2 endpoints. `{id}` is replaced with the user id.
// Overridable via opts.interestsUrl / opts.reviewsUrl / opts.followingUrl.
const INTERESTS_URL = "https://frodo.douban.com/api/v2/user/{id}/interests";
const REVIEWS_URL = "https://frodo.douban.com/api/v2/user/{id}/reviews";
const FOLLOWING_URL = "https://frodo.douban.com/api/v2/user/{id}/following";
const PAGE_LIMIT = 20;

// 豆瓣 mark status → human verb.
const STATUS_VERB = Object.freeze({
  mark: "想看",
  wish: "想看",
  doing: "在看",
  do: "在看",
  done: "看过",
  collect: "看过",
});

// 豆瓣 subject type → readable category (best-effort; falls back to raw token).
const SUBJECT_LABEL = Object.freeze({
  movie: "电影",
  tv: "电视剧",
  drama: "舞台剧",
  book: "图书",
  music: "音乐",
  game: "游戏",
  app: "App",
});

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!stringified) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `douban:${kind}:${stringified}`;
}

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    // 豆瓣 timestamps like "2024-01-02 13:45:00" — Date.parse treats as local.
    const t = Date.parse(v.replace(" ", "T"));
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

class DoubanAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "douban", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      interests: opts.interestsUrl || INTERESTS_URL,
      reviews: opts.reviewsUrl || REVIEWS_URL,
      following: opts.followingUrl || FOLLOWING_URL,
    };

    this.name = NAME;
    this.runtimeScopeIdentityKey = "userId";
    this.version = VERSION;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:douban-interest",
      "parse:douban-review",
      "parse:douban-follow",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "douban:interest (subjectType / title / status / myRating / comment)",
        "douban:review (title / subjectTitle / rating)",
        "douban:follow (memberId / name)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { interest: true, review: true, follow: true },
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require.
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeUserId(ctx)) {
      return {
        ok: false,
        reason: "NO_ACCOUNT_USER_ID",
        message:
          "cookie-api mode requires opts.accountId (douban numeric id) for an isolated watermark scope",
      };
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "douban",
      identityKey: "userId",
    });
    if (cookieAuth) {
      const ok = await cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      if (!account || !account.userId) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USER_ID",
          message:
            "cookie-api mode requires account.userId or opts.accountId (douban numeric id)",
        };
      }
      return { ok: true, account: account.userId, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-douban.authenticate: needs opts.inputPath (snapshot mode) OR configured account.cookies + userId OR opts.cookie + opts.accountId (cookie-api mode)",
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
          lastChecked: Date.now(),
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
      "social-douban.sync: needs opts.inputPath (snapshot mode) OR configured account.cookies + userId OR opts.cookie + opts.accountId (cookie-api mode; Frodo endpoints need apikey/_sig via opts.signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
      maxBytes: opts.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["events"],
      allowedEventKinds: VALID_SNAPSHOT_KINDS,
    });
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
        (typeof ev.id === "number" &&
          Number.isFinite(ev.id) &&
          String(ev.id)) ||
        ev.subjectId ||
        ev.reviewId ||
        ev.memberId ||
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
    if (hasRuntimeCookie(opts) && !hasRuntimeUserId(opts)) {
      throw new Error(
        "social-douban._syncViaCookie: opts.accountId required for transient cookie collection",
      );
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "douban",
      identityKey: "userId",
    });
    if (!account || !account.userId) {
      throw new Error(
        "social-douban._syncViaCookie: account.userId or opts.accountId required",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const cookies = cookieAuth.toHeader();
    const id = encodeURIComponent(account.userId);
    const include = opts.include || {};
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : Number.POSITIVE_INFINITY;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : 0;

    const plan = [
      {
        kind: KIND_INTEREST,
        url: this._urls.interests,
        mapId: (it) => `interest-${itemId(it)}`,
      },
      {
        kind: KIND_REVIEW,
        url: this._urls.reviews,
        mapId: (it) => `review-${itemId(it)}`,
      },
      {
        kind: KIND_FOLLOW,
        url: this._urls.following,
        mapId: (it) => `follow-${itemId(it)}`,
      },
    ];

    let emitted = 0;
    let scanComplete = true;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      const baseUrl = step.url.replace("{id}", id);
      let start = 0;
      let page = 0;
      let streamComplete = false;
      while (page < maxPages) {
        const query = { start, count: PAGE_LIMIT };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({
            url: baseUrl,
            query,
            cookies,
            signal: opts.signal,
          });
        }
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({ operation: step.kind, page });
        }
        const resp = await this._fetchFn({
          url: baseUrl,
          cookies,
          query,
          sign,
          signal: opts.signal,
        });
        const items = extractData(resp, step.kind);
        if (!items.length) {
          streamComplete = true;
          break;
        }
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          const capturedAt = cookieItemTime(step.kind, it);
          if (capturedAt < sinceMs) {
            continue;
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
        if (isEnd(resp, start, items.length)) {
          streamComplete = true;
          break;
        }
        start += items.length;
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
      throw new Error("DoubanAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    if (kind === KIND_INTEREST) return normalizeInterest(raw, ingestedAt);
    if (kind === KIND_REVIEW) return normalizeReview(raw, ingestedAt);
    if (kind === KIND_FOLLOW) return normalizeFollow(raw, ingestedAt);
    throw new Error(`DoubanAdapter.normalize: unknown kind ${kind}`);
  }
}

// ─── cookie-api response helpers ─────────────────────────────────────────────

/** Pull the collection array from a Frodo paginated response. */
function extractData(resp, kind) {
  if (Array.isArray(resp)) return resp;
  const paths = [
    ["interests"],
    ["reviews"],
    ["users"],
    ["following"],
    ["items"],
    ["data"],
  ];
  // Frodo sometimes keys the collection by its kind plural — best-effort.
  if (kind) paths.push([`${kind}s`]);
  return extractRecognizedArray(resp, paths, {
    source: NAME,
    stream: kind,
  });
}

function isEnd(resp, start, batch) {
  if (resp && Number.isFinite(resp.total)) return start + batch >= resp.total;
  return false;
}

function hasRuntimeUserId(opts = {}) {
  const value = opts.userId != null ? opts.userId : opts.accountId;
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function itemId(it) {
  if (!it || typeof it !== "object") return "unknown";
  // interests nest the subject; reviews/users carry id directly.
  return (
    it.id || (it.subject && it.subject.id) || it.user_id || it.uid || "unknown"
  );
}

function cookieItemTime(kind, it) {
  if (kind === KIND_INTEREST) {
    return (
      parseTime(it.create_time || it.created_time || it.update_time) ||
      Date.now()
    );
  }
  if (kind === KIND_REVIEW) {
    return parseTime(it.create_time || it.created_time) || Date.now();
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

function normalizeInterest(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const subject = it.subject || {};
  const subjectType = (
    it.subjectType ||
    subject.type ||
    it.type ||
    ""
  ).toLowerCase();
  const title = it.title || subject.title || "(未知条目)";
  const status = String(it.status || "done").toLowerCase();
  const verb = STATUS_VERB[status] || "标记";
  const typeLabel = SUBJECT_LABEL[subjectType] || subjectType || "条目";
  const myRating =
    it.myRating != null
      ? it.myRating
      : it.rating && typeof it.rating === "object"
        ? it.rating.value
        : it.rating;
  const comment = it.comment || it.text || "";
  const subjectId = it.subjectId || subject.id || it.id || null;
  const url =
    it.url ||
    subject.url ||
    (subjectId ? `https://www.douban.com/${subjectType}/${subjectId}/` : null);
  const occurredAt =
    parseTime(
      it.createdTime || it.create_time || it.created_time || raw.capturedAt,
    ) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const refId = `item-douban-${subjectType || "subject"}-${subjectId || newId()}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MEDIA,
        occurredAt,
        actor: "person-self",
        content: {
          title: `${verb}${typeLabel}: ${title}`,
          text: comment || title,
        },
        ingestedAt,
        source,
        extra: {
          platform: "douban",
          subjectType: subjectType || null,
          subjectId: subjectId != null ? String(subjectId) : null,
          status,
          myRating: Number.isFinite(Number(myRating)) ? Number(myRating) : null,
          comment: comment || null,
          url,
          itemRef: refId,
        },
      },
    ],
    items: [
      {
        id: refId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.MEDIA,
        name: title,
        ingestedAt,
        source,
        extra: {
          platform: "douban",
          kind: subjectType || "subject",
          subjectId: subjectId != null ? String(subjectId) : null,
          url,
        },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

function normalizeReview(raw, ingestedAt) {
  const p = raw.payload;
  const it = p.cookie ? p.item : p;
  const subject = it.subject || {};
  const title = it.title || "(无标题)";
  const abstract = it.abstract || it.content || "";
  const subjectTitle = it.subjectTitle || subject.title || "";
  const reviewId = it.reviewId || it.id || null;
  const rating =
    it.rating && typeof it.rating === "object" ? it.rating.value : it.rating;
  const occurredAt =
    parseTime(
      it.createdTime || it.create_time || it.created_time || raw.capturedAt,
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
          title: (title || subjectTitle || "(无标题)").slice(0, 80),
          text: stripHtml(abstract),
        },
        ingestedAt,
        source,
        extra: {
          platform: "douban",
          doubanReviewId: reviewId != null ? String(reviewId) : null,
          subjectTitle: subjectTitle || null,
          rating: Number.isFinite(Number(rating)) ? Number(rating) : null,
          url:
            it.url ||
            (reviewId ? `https://www.douban.com/review/${reviewId}/` : null),
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
  const memberId =
    it.memberId || it.id || it.uid || it.user_id || `unknown-${newId()}`;
  const name = it.name || it.nickname || "(unnamed)";
  const occurredAt = parseTime(it.capturedAt || raw.capturedAt) || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const person = {
    id: `person-douban-${memberId}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [name],
    ingestedAt,
    source,
    identifiers: {
      "douban-id": [String(memberId)],
    },
    extra: {
      platform: "douban",
      avatarUrl: it.avatarUrl || it.avatar || null,
      url:
        it.url ||
        (memberId ? `https://www.douban.com/people/${memberId}/` : null),
      followedAt: occurredAt,
    },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

function stripHtml(s) {
  if (typeof s !== "string") return "";
  return s.replace(/<[^>]+>/g, "").trim();
}

async function defaultFetch() {
  throw new Error("social-douban: no fetchFn configured for cookie-api mode");
}

module.exports = {
  DoubanAdapter,
  extractData,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
