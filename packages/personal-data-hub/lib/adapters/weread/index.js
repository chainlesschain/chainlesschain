"use strict";

/**
 * 微信读书 (WeRead) adapter — cookie 模式 + snapshot 模式.
 *
 * 知识阅读类数据源。WeRead 没有像微信/QQ 那样的本地加密大库；最可靠的个人
 * 路径是 **cookie web API**（登录 weread.qq.com 后用 cookie 拉自己的笔记本/
 * 划线/想法/阅读时长）。
 *
 *   1. cookie 模式 (opts.cookie): 用 WeReadApiClient 直接拉 → 产出
 *      book / highlight / review 事件。一键友好（UI 抓 cookie 后传入）。
 *   2. snapshot 模式 (opts.inputPath): 消费预先抓好的 JSON（Android 采集器 /
 *      可测）。schema 与 cookie 模式产出的 kinds 对齐。
 *
 * 实体映射：
 *   book      → ITEM(document《书名》) + EVENT(browse 读了《书名》)
 *   highlight → EVENT(other, 划线文本)          extra.kind=highlight
 *   review    → EVENT(post, 想法文本)            extra.kind=review
 *
 * snapshot schema (schemaVersion 1):
 *   { schemaVersion:1, snapshottedAt, account:{vid,name},
 *     events:[ {kind:"book",id,bookId,title,author,noteCount},
 *              {kind:"highlight",id,bookId,bookTitle,markText,chapterTitle,createTime},
 *              {kind:"review",id,bookId,bookTitle,content,chapterTitle,createTime} ] }
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const { newId } = require("../../ids");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  probeJsonSnapshotFile,
  readJsonSnapshot,
} = require("../../snapshot-file");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const {
  assertRuntimeAccountId,
  createSourceRequestAudit,
  hasRuntimeCookie,
  hasRuntimeAccountId,
  healthCheckFromAuthenticate,
  runtimeAccountIdFailure,
} = require("../_runtime-cookie-source");

const NAME = "weread";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_BOOKS_PER_SYNC = 25;
const MAX_BOOKS_PER_SYNC = 100;
const CURSOR_VERSION = 1;

const KIND_BOOK = "book";
const KIND_HIGHLIGHT = "highlight";
const KIND_REVIEW = "review";
const VALID_KINDS = Object.freeze([KIND_BOOK, KIND_HIGHLIGHT, KIND_REVIEW]);

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return n > 1e12 ? n : n * 1000;
  }
  return null;
}

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `weread:${kind}:${safe}`;
}

function snapshotEventId(event) {
  if (
    (typeof event.id === "string" && event.id.length > 0) ||
    (typeof event.id === "number" && Number.isFinite(event.id))
  ) {
    return event.id;
  }
  if (event.kind === KIND_BOOK) return event.bookId || null;
  if (event.kind === KIND_HIGHLIGHT) return event.bookmarkId || null;
  if (event.kind === KIND_REVIEW) return event.reviewId || null;
  return null;
}

class WeReadAdapter {
  constructor(opts = {}) {
    this._cookie = opts.cookie || null;
    this._dataPath = opts.inputPath || null;
    this._fetch = typeof opts.fetch === "function" ? opts.fetch : null;
    this._apiClientFactory = opts.apiClientFactory || null; // test seam

    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      opts.account || opts,
      ["vid", "userId", "accountId"],
    );
    this.runtimeScopeIdentityKey = "vid";
    this.watermarkStrategy = "explicit";
    this.version = VERSION;
    this.capabilities = [
      "sync:cookie",
      "sync:snapshot",
      "parse:weread-book",
      "parse:weread-highlight",
      "parse:weread-review",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 30, perDay: 1200 };
    this.dataDisclosure = {
      fields: [
        "weread:book (书名 / 作者 / 笔记数)",
        "weread:highlight (划线文本 / 章节)",
        "weread:review (想法文本 / 章节)",
      ],
      sensitivity: "medium",
      legalGate: false,
    };

    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_KINDS,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
      return runtimeAccountIdFailure(NAME);
    }
    if (ctx && ctx.readinessOnly) {
      if (this._cookie || hasRuntimeCookie(ctx)) {
        return {
          ok: true,
          account: hasRuntimeCookie(ctx) ? String(ctx.accountId).trim() : null,
          mode: this._cookie ? "configured" : "cookie",
        };
      }
      return {
        ok: false,
        reason: "INVALID_COOKIE",
        message:
          "weread: 需登录微信读书网页版抓取 cookie（或选择已采集的快照文件）",
      };
    }
    if (hasRuntimeCookie(ctx) || this._cookie) {
      return {
        ok: true,
        account: hasRuntimeCookie(ctx) ? String(ctx.accountId).trim() : null,
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "INVALID_COOKIE",
      message:
        "weread.authenticate: needs opts.cookie (cookie mode) OR opts.inputPath (snapshot)",
    };
  }

  async healthCheck(opts = {}) {
    return healthCheckFromAuthenticate(this, opts);
  }

  async *sync(opts = {}) {
    const inputPath = opts.inputPath || this._dataPath;
    if (inputPath) {
      yield* this._syncViaSnapshot({ ...opts, inputPath });
      return;
    }
    assertRuntimeAccountId(NAME, opts);
    const cookie = opts.cookie || this._cookie;
    if (cookie) {
      yield* this._syncViaCookie({ ...opts, cookie });
      return;
    }
    throw new Error(
      "weread.sync: needs opts.cookie (cookie mode) OR opts.inputPath (snapshot)",
    );
  }

  async *_syncViaCookie(opts) {
    const sourceRequestAudit = createSourceRequestAudit(
      opts,
      `${NAME}:live`,
      this._fetch,
    );
    const liveOpts = { ...opts, fetch: sourceRequestAudit.fetch };
    const client = this._apiClientFactory
      ? this._apiClientFactory(liveOpts)
      : new (require("./api-client").WeReadApiClient)({
          cookie: opts.cookie,
          fetch: sourceRequestAudit.fetch,
          baseUrl: opts.baseUrl,
        });
    const emit = (phase, extra) => {
      if (typeof opts.onProgress === "function") {
        try {
          opts.onProgress({ phase, adapter: NAME, ...extra });
        } catch (_e) {
          /* best-effort */
        }
      }
    };

    const requestedMaxBooks =
      Number.isInteger(opts.maxBooks) && opts.maxBooks > 0
        ? opts.maxBooks
        : DEFAULT_MAX_BOOKS_PER_SYNC;
    const maxBooks = Math.min(requestedMaxBooks, MAX_BOOKS_PER_SYNC);
    const includeNotes = opts.includeNotes !== false; // pull highlights/reviews per book
    const books = await client.getNotebooks();
    sourceRequestAudit.throwIfPermitFailed();
    const startIndex = resolveBookStartIndex(books, opts.sinceWatermark);
    const selectedBooks = books.slice(startIndex, startIndex + maxBooks);
    emit("notebooks", {
      count: books.length,
      startIndex,
      selectedCount: selectedBooks.length,
    });

    for (const b of selectedBooks) {
      yield {
        adapter: NAME,
        kind: KIND_BOOK,
        originalId: stableOriginalId(KIND_BOOK, b.bookId),
        capturedAt: Date.now(),
        payload: { kind: KIND_BOOK, ...b },
      };

      if (!includeNotes || !b.bookId) continue;
      // Highlights
      const marks = await client.getBookmarks(b.bookId);
      sourceRequestAudit.throwIfPermitFailed();
      for (const m of marks) {
        yield {
          adapter: NAME,
          kind: KIND_HIGHLIGHT,
          originalId: stableOriginalId(KIND_HIGHLIGHT, m.bookmarkId),
          capturedAt: parseTime(m.createTime) || Date.now(),
          payload: { kind: KIND_HIGHLIGHT, ...m, bookTitle: b.title },
        };
      }
      // Reviews / thoughts
      const reviews = await client.getReviews(b.bookId);
      sourceRequestAudit.throwIfPermitFailed();
      for (const r of reviews) {
        yield {
          adapter: NAME,
          kind: KIND_REVIEW,
          originalId: stableOriginalId(KIND_REVIEW, r.reviewId),
          capturedAt: parseTime(r.createTime) || Date.now(),
          payload: { kind: KIND_REVIEW, ...r, bookTitle: b.title },
        };
      }
      emit("book-done", {
        bookId: b.bookId,
        marks: marks.length,
        reviews: reviews.length,
      });
    }
    const lastBook = selectedBooks[selectedBooks.length - 1];
    if (lastBook && typeof opts.updateWatermark === "function") {
      opts.updateWatermark(serializeBookCursor(lastBook.bookId));
    }
  }

  async *_syncViaSnapshot(opts) {
    const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
      maxBytes: opts.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["events"],
      allowedEventKinds: VALID_KINDS,
    });
    const fallback =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const include = opts.include || {};
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const events = snapshot.events;
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (include[ev.kind] === false) continue;
      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, snapshotEventId(ev)),
        capturedAt:
          parseTime(ev.capturedAt) || parseTime(ev.createTime) || fallback,
        payload: { ...ev },
      };
      emitted += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload)
      throw new Error("WeReadAdapter.normalize: payload missing");
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_BOOK) return normalizeBook(raw.payload, raw, ingestedAt);
    if (kind === KIND_HIGHLIGHT)
      return normalizeHighlight(raw.payload, raw, ingestedAt);
    if (kind === KIND_REVIEW)
      return normalizeReview(raw.payload, raw, ingestedAt);
    throw new Error(`WeReadAdapter.normalize: unknown kind ${kind}`);
  }
}

function resolveBookStartIndex(books, watermark) {
  const after = parseBookCursor(watermark);
  if (!after || !Array.isArray(books) || books.length === 0) return 0;
  const previousIndex = books.findIndex(
    (book) => bookCursorKey(book && book.bookId) === after,
  );
  return previousIndex >= 0 && previousIndex + 1 < books.length
    ? previousIndex + 1
    : 0;
}

function serializeBookCursor(bookId) {
  return JSON.stringify({
    v: CURSOR_VERSION,
    after: bookCursorKey(bookId),
  });
}

function parseBookCursor(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed &&
      parsed.v === CURSOR_VERSION &&
      typeof parsed.after === "string" &&
      /^[a-f0-9]{64}$/u.test(parsed.after)
      ? parsed.after
      : null;
  } catch (_error) {
    return null;
  }
}

function bookCursorKey(bookId) {
  return crypto
    .createHash("sha256")
    .update(String(bookId == null ? "" : bookId), "utf8")
    .digest("hex");
}

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function bookItemId(bookId) {
  return bookId ? `item-weread-book-${bookId}` : `item-weread-book-${newId()}`;
}

function normalizeBook(p, raw, ingestedAt) {
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const title = p.title || "(未知书名)";
  const itemId = bookItemId(p.bookId);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.BROWSE,
        occurredAt,
        actor: "person-self",
        content: { title: `读《${title}》`, text: title },
        ingestedAt,
        source,
        extra: {
          platform: "weread",
          kind: "book",
          bookId: p.bookId || null,
          author: p.author || null,
          noteCount: p.noteCount != null ? p.noteCount : null,
          reviewCount: p.reviewCount != null ? p.reviewCount : null,
          itemRef: itemId,
        },
      },
    ],
    items: [
      {
        id: itemId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.DOCUMENT,
        name: p.author ? `${title} - ${p.author}` : title,
        ingestedAt,
        source,
        extra: {
          platform: "weread",
          kind: "book",
          bookId: p.bookId || null,
          author: p.author || null,
          cover: p.cover || null,
          category: p.category || null,
        },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

function normalizeHighlight(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.createTime) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const text = p.markText || "";
  const book = p.bookTitle || "";
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt,
        actor: "person-self",
        content: {
          title: `划线${book ? "《" + book + "》" : ""}: ${text.slice(0, 60)}`,
          text,
        },
        ingestedAt,
        source,
        extra: {
          platform: "weread",
          kind: "highlight",
          bookId: p.bookId || null,
          bookTitle: book || null,
          chapterTitle: p.chapterTitle || null,
          itemRef: p.bookId ? bookItemId(p.bookId) : null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeReview(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.createTime) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const text = p.content || "";
  const book = p.bookTitle || "";
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.POST,
        occurredAt,
        actor: "person-self",
        content: {
          title: `想法${book ? "《" + book + "》" : ""}: ${text.slice(0, 60)}`,
          text,
        },
        ingestedAt,
        source,
        extra: {
          platform: "weread",
          kind: "review",
          bookId: p.bookId || null,
          bookTitle: book || null,
          chapterTitle: p.chapterTitle || null,
          itemRef: p.bookId ? bookItemId(p.bookId) : null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

module.exports = {
  WeReadAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
};
