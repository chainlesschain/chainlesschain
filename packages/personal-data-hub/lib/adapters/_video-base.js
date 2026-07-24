/**
 * _video-base — shared infrastructure for "video watch-history" adapters
 * (爱奇艺 / 腾讯视频 / etc.), Phase 13+ §12.1 (ROI ⭐⭐ each).
 *
 * These platforms expose the same shape of personal data: a paginated list of
 * videos the user watched (观看记录) + optionally favourited/追剧 (收藏). Rather
 * than copy ~300 lines per platform (mirroring _document-base / shopping-base /
 * travel-base), `createVideoAdapter(config)` returns a fully-formed adapter
 * class with snapshot + cookie-api modes; each platform supplies only its
 * endpoints + field mapping.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch watch / favourite lists via
 *      the injected `fetchFn` (Android in-APK cc → OkHttp; desktop hub →
 *      Electron WebView net request), paginate. A sign seam (opts.signProvider)
 *      covers anti-bot tokens; best-effort unsigned. Endpoints overridable via
 *      opts.watchUrl / opts.favouriteUrl (best-effort, not field-verified —
 *      FAMILY-23 playbook).
 *
 * normalize() emits, per item: a MEDIA event (watch) or LIKE event (favourite)
 * + a MEDIA item, mirroring netease-music / music-kugou so the vault can both
 * timeline "我看了 X" and list the video entity.
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "watch",     "id": "...", "videoId": "...", "title": "...",
 *         "category": "movie|tv|variety|anime|...", "episode": "...",
 *         "channel": "...", "durationSec": N, "capturedAt": <s|ms> },
 *       { "kind": "favourite", "id": "...", "videoId": "...", "title": "...",
 *         "category": "...", "capturedAt": <ms> }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../constants");

const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_WATCH = "watch";
const KIND_FAVOURITE = "favourite";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_WATCH, KIND_FAVOURITE]);
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
 * @param {string} config.NAME           e.g. "video-iqiyi"
 * @param {string} config.VERSION
 * @param {string} config.platform       e.g. "iqiyi"
 * @param {string} config.watchUrl       best-effort watch-history endpoint
 * @param {string} config.favouriteUrl   best-effort favourite/追剧 endpoint
 * @param {(resp:any)=>any[]} config.extractItems
 * @param {(raw:any)=>object|null} config.mapItem
 *        VideoRecord = { videoId, title, category, episode, channel, durationSec, url, occurredAt? }
 */
function createVideoAdapter(config) {
  const {
    NAME,
    VERSION,
    platform,
    watchUrl,
    favouriteUrl,
    extractItems,
    mapItem,
  } = config;
  const { CookieAuth } = require("./shopping-base");

  function stableOriginalId(kind, id) {
    const safe =
      (typeof id === "string" && id.length > 0 && id) ||
      (typeof id === "number" && Number.isFinite(id) && String(id)) ||
      `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${platform}:${kind}:${safe}`;
  }

  class VideoAdapter {
    constructor(opts = {}) {
      this.account = opts.account || null;
      this._cookieAuth =
        opts.account && opts.account.cookies
          ? new CookieAuth({ platform, cookies: opts.account.cookies })
          : null;
      this._fetchFn =
        typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
      this._signProvider =
        typeof opts.signProvider === "function" ? opts.signProvider : null;
      this._urls = {
        watch: opts.watchUrl || watchUrl,
        favourite: opts.favouriteUrl || favouriteUrl,
      };

      this.name = NAME;
      this.version = VERSION;
      this.watermarkStrategy = "max-captured-at";
      this.watermarkRequiresCompleteScan = true;
      this.capabilities = [
        "sync:snapshot",
        "sync:cookie-api",
        `parse:${platform}-watch`,
        `parse:${platform}-favourite`,
      ];
      this.extractMode = "web-api";
      this.rateLimits = {};
      this.dataDisclosure = {
        fields: [
          `${platform}:watch (title / category / episode / channel)`,
          `${platform}:favourite (title / category)`,
        ],
        sensitivity: "low",
        legalGate: false,
        defaultInclude: { watch: true, favourite: true },
      };
      this._deps = { fs };
    }

    async authenticate(ctx = {}) {
      if (
        ctx &&
        typeof ctx.inputPath === "string" &&
        ctx.inputPath.length > 0
      ) {
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
        if (!ok)
          return {
            ok: false,
            reason: "INVALID_COOKIE",
            error: "cookies missing",
          };
        return {
          ok: true,
          account: (this.account && this.account.userId) || null,
          mode: "cookie",
        };
      }
      return {
        ok: false,
        reason: "NO_INPUT",
        message: `${NAME}.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)`,
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
        `${NAME}.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)`,
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
          `${NAME}.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
        );
      }
      const fallback =
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
        if (
          !ev ||
          typeof ev !== "object" ||
          !VALID_SNAPSHOT_KINDS.includes(ev.kind)
        )
          continue;
        if (include[ev.kind] === false) continue;
        const id = (typeof ev.id === "string" && ev.id) || ev.videoId || null;
        yield {
          adapter: NAME,
          kind: ev.kind,
          originalId: stableOriginalId(ev.kind, id),
          capturedAt: parseTime(ev.capturedAt) || fallback,
          payload: {
            record: snapshotEventToRecord(ev),
            kind: ev.kind,
            account,
          },
        };
        emitted += 1;
      }
    }

    async *_syncViaCookie(opts = {}) {
      if (!(await this._cookieAuth.validate())) return;
      const cookies = this._cookieAuth.toHeader();
      const include = opts.include || {};
      const limit =
        Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
      const maxPages =
        Number.isInteger(opts.maxPages) && opts.maxPages > 0
          ? opts.maxPages
          : 10;
      const sinceMs =
        opts.sinceWatermark != null
          ? parseInt(String(opts.sinceWatermark), 10) || 0
          : 0;

      const plan = [
        { kind: KIND_WATCH, url: this._urls.watch },
        { kind: KIND_FAVOURITE, url: this._urls.favourite },
      ];

      let emitted = 0;
      let scanComplete = true;
      for (const step of plan) {
        if (include[step.kind] === false) continue;
        if (!step.url) continue;
        let page = 1;
        let streamComplete = false;
        while (page <= maxPages) {
          const query = { page, pageSize: PAGE_SIZE };
          let sign = null;
          if (this._signProvider) {
            sign = await this._signProvider({ url: step.url, query, cookies });
          }
          if (typeof opts.beforeSourceRequest === "function") {
            await opts.beforeSourceRequest({ operation: step.kind, page });
          }
          const resp = await this._fetchFn({
            url: step.url,
            cookies,
            query,
            sign,
          });
          const items = extractItems(resp) || [];
          if (!items.length) {
            streamComplete = true;
            break;
          }
          let reachedWatermark = false;
          for (const it of items) {
            const rec = mapItem(it);
            if (!rec || !rec.videoId) continue;
            if (rec.occurredAt && rec.occurredAt < sinceMs) {
              reachedWatermark = true;
              break;
            }
            if (emitted >= limit) return;
            yield {
              adapter: NAME,
              kind: step.kind,
              originalId: stableOriginalId(step.kind, rec.videoId),
              capturedAt: rec.occurredAt || Date.now(),
              payload: { record: rec, kind: step.kind },
            };
            emitted += 1;
          }
          if (reachedWatermark || items.length < PAGE_SIZE) {
            streamComplete = true;
            break;
          }
          page += 1;
        }
        if (!streamComplete) scanComplete = false;
      }
      if (scanComplete && typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
    }

    normalize(raw) {
      if (!raw || !raw.payload || !raw.payload.record) {
        throw new Error(`${NAME}.normalize: payload.record missing`);
      }
      const kind = raw.kind || raw.payload.kind;
      const subtype =
        kind === KIND_FAVOURITE ? EVENT_SUBTYPES.LIKE : EVENT_SUBTYPES.MEDIA;
      const verb = kind === KIND_FAVOURITE ? "收藏" : "观看";
      return normalizeVideoRecord(
        raw.payload.record,
        raw,
        platform,
        NAME,
        VERSION,
        subtype,
        verb,
      );
    }
  }

  return VideoAdapter;
}

function snapshotEventToRecord(ev) {
  return {
    videoId: String(ev.videoId || ev.id || "unknown"),
    title: ev.title || "(未知视频)",
    category: ev.category || ev.type || null,
    episode: ev.episode || null,
    channel: ev.channel || ev.uploader || null,
    durationSec: Number.isFinite(ev.durationSec) ? ev.durationSec : null,
    url: ev.url || null,
    occurredAt: parseTime(ev.capturedAt),
  };
}

function normalizeVideoRecord(
  rec,
  raw,
  platform,
  NAME,
  VERSION,
  subtype,
  verb,
) {
  const ingestedAt = Date.now();
  const occurredAt = rec.occurredAt || raw.capturedAt || ingestedAt;
  const source = {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
  const title = rec.title || "(未知视频)";
  const epSuffix = rec.episode ? ` ${rec.episode}` : "";
  const itemId = `item-${platform}-video-${rec.videoId}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype,
        occurredAt,
        actor: "person-self",
        content: { title: `${verb}: ${title}${epSuffix}`, text: title },
        ingestedAt,
        source,
        extra: {
          platform,
          videoId: rec.videoId,
          category: rec.category || null,
          episode: rec.episode || null,
          channel: rec.channel || null,
          durationSec: rec.durationSec != null ? rec.durationSec : null,
          url: rec.url || null,
          itemRef: itemId,
        },
      },
    ],
    items: [
      {
        id: itemId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.MEDIA,
        name: title,
        ingestedAt,
        source,
        extra: {
          platform,
          kind: "video",
          videoId: rec.videoId,
          category: rec.category || null,
          channel: rec.channel || null,
        },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

async function defaultFetch(_opts) {
  throw new Error("video-base: no fetchFn configured for cookie-api mode");
}

module.exports = {
  createVideoAdapter,
  normalizeVideoRecord,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
  KIND_WATCH,
  KIND_FAVOURITE,
  VALID_SNAPSHOT_KINDS,
};
