/**
 * _document-base — shared infrastructure for "own-document list" adapters
 * (WPS 云文档 / 腾讯文档 / etc.), Phase 13+ §12.1 "自创文档列表".
 *
 * These platforms all expose the same shape of personal data: a paginated list
 * of documents the user created/owns (title, type, create/modify time, url).
 * Rather than copy ~300 lines per platform (mirroring shopping-base /
 * travel-base / _local-im-pc-adapter), `createDocumentAdapter(config)` returns
 * a fully-formed adapter class with snapshot + cookie-api modes; each platform
 * supplies only its endpoint + field mapping.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch the owner's document list
 *      via the injected `fetchFn` (Android in-APK cc → OkHttp; desktop hub →
 *      Electron WebView net request), paginate, map each doc → a DocumentRecord.
 *      A sign seam (opts.signProvider) covers any anti-bot token; best-effort
 *      unsigned when absent. Endpoint overridable via opts.listUrl (best-effort,
 *      not field-verified — FAMILY-23 playbook).
 *
 * normalize() emits, per document: an authoring EVENT (subtype POST) + an ITEM
 * (subtype DOCUMENT), mirroring netease-music's event+item dual-emit so the
 * vault can both timeline "我创建了 X" and list the document entity.
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "document", "id": "doc-<id>", "docId": "...", "title": "...",
 *         "docType": "doc|sheet|slide|pdf|form|...", "url": "...",
 *         "createdTime": <s|ms>, "updatedTime": <s|ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../account-scope");
const { newId } = require("../ids");
const { probeJsonSnapshotFile, readJsonSnapshot } = require("../snapshot-file");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../constants");

const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_DOCUMENT = "document";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_DOCUMENT]);
const PAGE_SIZE = 20;

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

/**
 * Build a document-list adapter class.
 *
 * @param {object} config
 * @param {string} config.NAME           adapter name, e.g. "doc-wps"
 * @param {string} config.VERSION        semver string
 * @param {string} config.platform       short platform id, e.g. "wps"
 * @param {string} config.defaultListUrl best-effort list endpoint
 * @param {(resp:any)=>any[]} config.extractDocs  pull the doc array from a response
 * @param {(raw:any)=>object|null} config.mapDoc  map a raw doc → DocumentRecord
 *        DocumentRecord = { docId, title, docType, url, createdMs, updatedMs, extra? }
 */
function createDocumentAdapter(config) {
  const { NAME, VERSION, platform, defaultListUrl, extractDocs, mapDoc } =
    config;

  const {
    CookieAuth,
    hasRuntimeCookie,
    resolveCookieContext,
  } = require("./shopping-base");

  function stableOriginalId(id) {
    const safe =
      (typeof id === "string" && id.length > 0 && id) ||
      (typeof id === "number" && Number.isFinite(id) && String(id));
    if (!safe) {
      throw new Error(`${NAME}.sync: document record requires a stable id`);
    }
    return `${platform}:document:${safe}`;
  }

  class DocumentAdapter {
    constructor(opts = {}) {
      this.account = opts.account || null;
      this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
        "userId",
      ]);
      this._cookieAuth =
        opts.account && opts.account.cookies
          ? new CookieAuth({ platform, cookies: opts.account.cookies })
          : null;
      this._fetchFn =
        typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
      this._signProvider =
        typeof opts.signProvider === "function" ? opts.signProvider : null;
      this._listUrl =
        typeof opts.listUrl === "string" && opts.listUrl.length > 0
          ? opts.listUrl
          : defaultListUrl;

      this.name = NAME;
      this.runtimeScopeIdentityKey = "userId";
      this.watermarkStrategy = "max-captured-at";
      this.watermarkRequiresCompleteScan = true;
      this.version = VERSION;
      this.capabilities = [
        "sync:snapshot",
        "sync:cookie-api",
        `parse:${platform}-documents`,
      ];
      this.extractMode = "web-api";
      this.rateLimits = { perMinute: 8, perDay: 200 };
      this.dataDisclosure = {
        fields: [`${platform}:document (title / docType / createdTime / url)`],
        sensitivity: "medium",
        legalGate: false,
        defaultInclude: { document: true },
      };

      this._deps = { fs };
    }

    async authenticate(ctx = {}) {
      if (
        ctx &&
        typeof ctx.inputPath === "string" &&
        ctx.inputPath.length > 0
      ) {
        return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
          maxBytes: ctx.maxSnapshotBytes,
          expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
          requiredArrayFields: ["events"],
          allowedEventKinds: VALID_SNAPSHOT_KINDS,
        });
      }
      if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_ID",
          message: `${NAME} cookie mode requires opts.accountId for an isolated watermark scope`,
        };
      }
      const { account, cookieAuth } = resolveCookieContext({
        account: this.account,
        cookieAuth: this._cookieAuth,
        opts: ctx,
        platform,
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
        return {
          ok: true,
          account: (account && account.userId) || null,
          mode: "cookie",
        };
      }
      return {
        ok: false,
        reason: "NO_INPUT",
        message: `${NAME}.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)`,
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
        `${NAME}.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)`,
      );
    }

    async *_syncViaSnapshot(opts) {
      const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
        maxBytes: opts.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
      ) {
        throw new Error(
          `${NAME}.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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

        const capturedAt =
          parseTime(ev.capturedAt) ||
          parseTime(ev.updatedTime) ||
          parseTime(ev.createdTime) ||
          fallbackCapturedAt;
        const id =
          (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
          ev.docId ||
          null;

        yield {
          adapter: NAME,
          kind: KIND_DOCUMENT,
          originalId: stableOriginalId(id),
          capturedAt,
          payload: { record: snapshotEventToRecord(ev), account },
        };
        emitted += 1;
      }
    }

    async *_syncViaCookie(opts = {}) {
      if (hasRuntimeCookie(opts) && !hasRuntimeAccountId(opts)) {
        throw new Error(
          `${NAME}._syncViaCookie: opts.accountId required for transient cookie collection`,
        );
      }
      const { cookieAuth } = resolveCookieContext({
        account: this.account,
        cookieAuth: this._cookieAuth,
        opts,
        platform,
        identityKey: "userId",
      });
      if (!cookieAuth || !(await cookieAuth.validate())) return;
      const cookies = cookieAuth.toHeader();
      const include = opts.include || {};
      if (include[KIND_DOCUMENT] === false) return;
      const sinceMs =
        opts.sinceWatermark != null
          ? parseInt(String(opts.sinceWatermark), 10) || 0
          : 0;
      const limit =
        Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
      const maxPages =
        Number.isInteger(opts.maxPages) && opts.maxPages > 0
          ? opts.maxPages
          : 20;

      let emitted = 0;
      let offset = 0;
      let page = 0;
      let scanComplete = false;
      while (page < maxPages) {
        const query = { offset, limit: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({
            url: this._listUrl,
            query,
            cookies,
            signal: opts.signal,
          });
        }
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({ operation: KIND_DOCUMENT, page });
        }
        const resp = await this._fetchFn({
          url: this._listUrl,
          cookies,
          query,
          sign,
          signal: opts.signal,
        });
        const docs = extractDocs(resp, KIND_DOCUMENT);
        if (!Array.isArray(docs)) {
          throw new TypeError(`${NAME}.sync: extractDocs must return an array`);
        }
        if (!docs.length) {
          scanComplete = true;
          break;
        }
        for (const d of docs) {
          const rec = mapDoc(d);
          if (!rec || !rec.docId) continue;
          const ts = rec.updatedMs || rec.createdMs || null;
          if (sinceMs && ts && ts < sinceMs) {
            continue;
          }
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: KIND_DOCUMENT,
            originalId: stableOriginalId(rec.docId),
            capturedAt: ts || Date.now(),
            watermarkAt: ts || null,
            payload: { record: rec },
          };
          emitted += 1;
        }
        offset += docs.length;
        page += 1;
      }
      if (scanComplete && typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
    }

    normalize(raw) {
      if (!raw || !raw.payload || !raw.payload.record) {
        throw new Error(`${NAME}.normalize: payload.record missing`);
      }
      return normalizeDocumentRecord(
        raw.payload.record,
        raw,
        platform,
        NAME,
        VERSION,
      );
    }
  }

  return DocumentAdapter;
}

/** Snapshot event fields → DocumentRecord (the shape mapDoc also produces). */
function snapshotEventToRecord(ev) {
  return {
    docId: String(ev.docId || ev.id || "unknown"),
    title: ev.title || "(无标题)",
    docType: ev.docType || ev.type || "doc",
    url: ev.url || null,
    createdMs: parseTime(ev.createdTime),
    updatedMs: parseTime(ev.updatedTime),
    extra: ev.extra && typeof ev.extra === "object" ? ev.extra : {},
  };
}

function normalizeDocumentRecord(rec, raw, platform, NAME, VERSION) {
  const ingestedAt = Date.now();
  const occurredAt =
    rec.updatedMs || rec.createdMs || raw.capturedAt || ingestedAt;
  const source = {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
  const title = rec.title || "(无标题)";
  const itemId = `item-${platform}-doc-${rec.docId}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.POST,
        occurredAt,
        actor: "person-self",
        content: { title: `文档: ${title}`, text: title },
        ingestedAt,
        source,
        extra: {
          platform,
          docId: rec.docId,
          docType: rec.docType || "doc",
          url: rec.url || null,
          createdMs: rec.createdMs || null,
          updatedMs: rec.updatedMs || null,
          itemRef: itemId,
        },
      },
    ],
    items: [
      {
        id: itemId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.DOCUMENT,
        name: title,
        ingestedAt,
        source,
        extra: {
          platform,
          docId: rec.docId,
          docType: rec.docType || "doc",
          url: rec.url || null,
          ...(rec.extra || {}),
        },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

function hasRuntimeAccountId(opts = {}) {
  const value = opts.userId != null ? opts.userId : opts.accountId;
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

async function defaultFetch(_opts) {
  throw new Error("document-base: no fetchFn configured for cookie-api mode");
}

module.exports = {
  createDocumentAdapter,
  normalizeDocumentRecord,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
  KIND_DOCUMENT,
  VALID_SNAPSHOT_KINDS,
};
