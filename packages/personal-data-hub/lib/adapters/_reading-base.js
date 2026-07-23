/**
 * _reading-base — shared infrastructure for "novel/reading-history" adapters
 * (番茄小说 / 七猫小说 / etc.), Phase 13+ device-discovered gap (2026-06-15).
 *
 * Reading apps expose the same shape of personal data: books the user read
 * (阅读历史 / 书架, with progress) + optionally favourited (收藏/追更). Same
 * family pattern as _video-base / _document-base: `createReadingAdapter(config)`
 * returns a full adapter (snapshot + optional custom cookie API); each platform
 * supplies field mapping. Guessed endpoints are never selected by default.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. custom cookie-api mode: caller must provide account.cookies, readUrl,
 *      favouriteUrl, and fetchFn captured from its own authorized session.
 *
 * normalize() emits, per book: a MEDIA event ("读了 X" / "收藏 X") + a DOCUMENT
 * item (the book entity), mirroring _video-base's event+item dual-emit so the
 * vault can timeline reading and list the book.
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "read",      "id": "...", "bookId": "...", "title": "...",
 *         "author": "...", "category": "...", "chapter": "...",
 *         "progress": 0.42, "capturedAt": <s|ms> },
 *       { "kind": "favourite", "id": "...", "bookId": "...", "title": "...", "author": "..." }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, ITEM_SUBTYPES, CAPTURED_BY } = require("../constants");

const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_READ = "read";
const KIND_FAVOURITE = "favourite";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_READ, KIND_FAVOURITE]);
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

/**
 * @param {object} config
 * @param {string} config.NAME           e.g. "reading-fanqie"
 * @param {string} config.VERSION
 * @param {string} config.platform       e.g. "fanqie"
 * @param {string} config.readUrl        best-effort read-history endpoint
 * @param {string} config.favouriteUrl   best-effort 书架/收藏 endpoint
 * @param {(resp:any)=>any[]} config.extractItems
 * @param {(raw:any)=>object|null} config.mapItem
 *        BookRecord = { bookId, title, author, category, chapter, progress, url, occurredAt? }
 */
function createReadingAdapter(config) {
  const { NAME, VERSION, platform, extractItems, mapItem } = config;
  const { CookieAuth } = require("./shopping-base");

  function stableOriginalId(kind, id) {
    const safe =
      (typeof id === "string" && id.length > 0 && id) ||
      (typeof id === "number" && Number.isFinite(id) && String(id)) ||
      `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${platform}:${kind}:${safe}`;
  }

  class ReadingAdapter {
    constructor(opts = {}) {
      this.account = opts.account || null;
      this._cookieAuth =
        opts.account && opts.account.cookies ? new CookieAuth({ platform, cookies: opts.account.cookies }) : null;
      this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
      this._signProvider = typeof opts.signProvider === "function" ? opts.signProvider : null;
      this._urls = { read: opts.readUrl || null, favourite: opts.favouriteUrl || null };
      this._liveConfigured = Boolean(
        this._urls.read && this._urls.favourite && typeof opts.fetchFn === "function",
      );

      this.name = NAME;
      this.version = VERSION;
      this.capabilities = [
        "sync:snapshot",
        ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
        `parse:${platform}-read`,
        `parse:${platform}-favourite`,
      ];
      this.extractMode = this._liveConfigured ? "web-api" : "file-import";
      this.rateLimits = {};
      this.dataDisclosure = {
        fields: [`${platform}:read (书名 / 作者 / 分类 / 进度)`, `${platform}:favourite (收藏的书)`],
        sensitivity: "low",
        legalGate: false,
        defaultInclude: { read: true, favourite: true },
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
      if (this._cookieAuth && !this._liveConfigured) {
        return {
          ok: false,
          reason: "EXPLICIT_ENDPOINT_REQUIRED",
          message: `${NAME}: cookie collection requires captured readUrl + favouriteUrl and fetchFn; snapshot import is ready`,
        };
      }
      if (this._cookieAuth) {
        const ok = await this._cookieAuth.validate();
        if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
        return { ok: true, account: (this.account && this.account.userId) || null, mode: "cookie" };
      }
      return {
        ok: false,
        reason: "NO_INPUT",
        message: `${NAME}.authenticate: needs opts.inputPath; custom live mode also requires cookies, readUrl, favouriteUrl, and fetchFn`,
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
      if (this._cookieAuth && this._liveConfigured) {
        yield* this._syncViaCookie(opts);
        return;
      }
      if (this._cookieAuth) {
        throw new Error(`${NAME}.sync: explicit readUrl + favouriteUrl and fetchFn required for custom cookie collection`);
      }
      throw new Error(`${NAME}.sync: needs opts.inputPath (snapshot mode)`);
    }

    async *_syncViaSnapshot(opts) {
      const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
      const snapshot = JSON.parse(raw);
      if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(`${NAME}.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`);
      }
      const fallback =
        Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0 ? Math.floor(snapshot.snapshottedAt) : Date.now();
      const account = snapshot.account && typeof snapshot.account === "object" ? snapshot.account : null;
      const include = opts.include || {};
      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
      const events = Array.isArray(snapshot.events) ? snapshot.events : [];
      let emitted = 0;
      for (const ev of events) {
        if (emitted >= limit) return;
        if (!ev || typeof ev !== "object" || !VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
        if (include[ev.kind] === false) continue;
        const id = (typeof ev.id === "string" && ev.id) || ev.bookId || null;
        yield {
          adapter: NAME,
          kind: ev.kind,
          originalId: stableOriginalId(ev.kind, id),
          capturedAt: parseTime(ev.capturedAt) || fallback,
          payload: { record: snapshotEventToRecord(ev), kind: ev.kind, account },
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
        { kind: KIND_READ, url: this._urls.read },
        { kind: KIND_FAVOURITE, url: this._urls.favourite },
      ];

      let emitted = 0;
      for (const step of plan) {
        if (include[step.kind] === false) continue;
        if (!step.url) continue;
        let page = 1;
        while (page <= maxPages) {
          const query = { page, pageSize: PAGE_SIZE };
          let sign = null;
          if (this._signProvider) {
            sign = await this._signProvider({ url: step.url, query, cookies });
          }
          const resp = await this._fetchFn({ url: step.url, cookies, query, sign });
          const items = extractItems(resp) || [];
          if (!items.length) break;
          for (const it of items) {
            const rec = mapItem(it);
            if (!rec || !rec.bookId) continue;
            if (emitted >= limit) return;
            yield {
              adapter: NAME,
              kind: step.kind,
              originalId: stableOriginalId(step.kind, rec.bookId),
              capturedAt: rec.occurredAt || Date.now(),
              payload: { record: rec, kind: step.kind },
            };
            emitted += 1;
          }
          if (items.length < PAGE_SIZE) break;
          page += 1;
        }
      }
    }

    normalize(raw) {
      if (!raw || !raw.payload || !raw.payload.record) {
        throw new Error(`${NAME}.normalize: payload.record missing`);
      }
      const kind = raw.kind || raw.payload.kind;
      const subtype = kind === KIND_FAVOURITE ? EVENT_SUBTYPES.LIKE : EVENT_SUBTYPES.MEDIA;
      const verb = kind === KIND_FAVOURITE ? "收藏" : "读了";
      return normalizeBookRecord(raw.payload.record, raw, platform, NAME, VERSION, subtype, verb);
    }
  }

  return ReadingAdapter;
}

function snapshotEventToRecord(ev) {
  return {
    bookId: String(ev.bookId || ev.id || "unknown"),
    title: ev.title || "(未知书籍)",
    author: ev.author || null,
    category: ev.category || ev.type || null,
    chapter: ev.chapter || null,
    progress: Number.isFinite(ev.progress) ? ev.progress : null,
    url: ev.url || null,
    occurredAt: parseTime(ev.capturedAt),
  };
}

function normalizeBookRecord(rec, raw, platform, NAME, VERSION, subtype, verb) {
  const ingestedAt = Date.now();
  const occurredAt = rec.occurredAt || raw.capturedAt || ingestedAt;
  const source = {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
  const title = rec.title || "(未知书籍)";
  const authorSuffix = rec.author ? ` - ${rec.author}` : "";
  const itemId = `item-${platform}-book-${rec.bookId}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype,
        occurredAt,
        actor: "person-self",
        content: { title: `${verb}: ${title}${authorSuffix}`, text: title },
        ingestedAt,
        source,
        extra: {
          platform,
          bookId: rec.bookId,
          author: rec.author || null,
          category: rec.category || null,
          chapter: rec.chapter || null,
          progress: rec.progress != null ? rec.progress : null,
          url: rec.url || null,
          itemRef: itemId,
        },
      },
    ],
    items: [
      {
        id: itemId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.DOCUMENT,
        name: rec.author ? `${title} - ${rec.author}` : title,
        ingestedAt,
        source,
        extra: { platform, kind: "book", bookId: rec.bookId, author: rec.author || null, category: rec.category || null },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

async function defaultFetch(_opts) {
  throw new Error("reading-base: no fetchFn configured for cookie-api mode");
}

module.exports = {
  createReadingAdapter,
  normalizeBookRecord,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
  KIND_READ,
  KIND_FAVOURITE,
  VALID_SNAPSHOT_KINDS,
};
