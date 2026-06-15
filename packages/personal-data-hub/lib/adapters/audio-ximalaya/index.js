/**
 * 听书/播客 — Ximalaya 喜马拉雅 (com.ximalaya.ting.android) adapter, dual-mode
 * (snapshot + cookie-api). Phase 13+ long-tail (user-requested), ROI ⭐⭐ "听书
 * /播客收听历史".
 *
 * 喜马拉雅 is China's largest audio platform (有声书 / 播客 / 相声 / 课程). Mirrors
 * music-kugou's three-kind shape — play(收听) / favorite(收藏) / subscribe(订阅专辑)
 * — so the vault treats audio listening uniformly alongside music. A new `audio-`
 * category prefix (distinct from music-* for songs and reading-* for novels).
 * Web endpoints are fetched through a generic injected `fetchFn` + optional
 * signProvider seam, keeping this module a pure-Node parser/orchestrator.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch listen history / favourites /
 *      subscriptions from ximalaya web via the injected fetchFn, paginate; sign
 *      seam (opts.signProvider) for any anti-bot token; endpoints overridable via
 *      opts.*Url (best-effort, NOT field-verified — FAMILY-23 playbook).
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "play",      "id": "...", "trackId": "...", "title": "...",
 *         "anchor": "...", "album": "...", "durationSec": N, "capturedAt": <ms> },
 *       { "kind": "favorite",  "id": "...", "trackId": "...", "title": "...", "anchor": "..." },
 *       { "kind": "subscribe", "id": "...", "albumId": "...", "album": "...",
 *         "trackCount": N, "anchor": "..." }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "audio-ximalaya";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PLAY = "play";
const KIND_FAVORITE = "favorite";
const KIND_SUBSCRIBE = "subscribe";
const VALID_KINDS = Object.freeze([KIND_PLAY, KIND_FAVORITE, KIND_SUBSCRIBE]);

// Best-effort Ximalaya web endpoints. Overridable via opts.*Url.
const PLAYS_URL = "https://www.ximalaya.com/revision/track/history";
const FAVORITES_URL = "https://www.ximalaya.com/revision/track/favorite/list";
const SUBSCRIBES_URL = "https://www.ximalaya.com/revision/album/subscribe/list";
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

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `ximalaya:${kind}:${safe}`;
}

class XimalayaAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "ximalaya", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      play: opts.playsUrl || PLAYS_URL,
      favorite: opts.favoritesUrl || FAVORITES_URL,
      subscribe: opts.subscribesUrl || SUBSCRIBES_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:ximalaya-play",
      "parse:ximalaya-favorite",
      "parse:ximalaya-subscribe",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "ximalaya:play (声音标题 / 主播 / 专辑)",
        "ximalaya:favorite (收藏的声音)",
        "ximalaya:subscribe (订阅专辑名 / 集数)",
      ],
      sensitivity: "low",
      legalGate: false,
      defaultInclude: { play: true, favorite: true, subscribe: true },
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
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message: "audio-ximalaya.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
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
      "audio-ximalaya.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode; ximalaya endpoints may need a sign via opts.signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(`audio-ximalaya.sync: snapshot must be JSON. Got parse error: ${err.message}`);
    }
    if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(
        `audio-ximalaya.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      if (!ev || typeof ev !== "object" || !VALID_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;
      const id = (typeof ev.id === "string" && ev.id) || ev.trackId || ev.albumId || null;
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
      { kind: KIND_PLAY, url: this._urls.play, map: trackItemToRecord },
      { kind: KIND_FAVORITE, url: this._urls.favorite, map: trackItemToRecord },
      { kind: KIND_SUBSCRIBE, url: this._urls.subscribe, map: albumItemToRecord },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      let page = 1;
      while (page <= maxPages) {
        const query = { page, pageSize: PAGE_SIZE };
        let sign = null;
        if (this._signProvider) {
          sign = await this._signProvider({ url: step.url, query, cookies });
        }
        const resp = await this._fetchFn({ url: step.url, cookies, query, sign });
        const items = extractList(resp);
        if (!items.length) break;
        for (const it of items) {
          const rec = step.map(it);
          if (!rec) continue;
          if (emitted >= limit) return;
          yield {
            adapter: NAME,
            kind: step.kind,
            originalId: stableOriginalId(step.kind, rec.id),
            capturedAt: rec.occurredAt || Date.now(),
            payload: { ...rec, kind: step.kind, cookie: true },
          };
          emitted += 1;
        }
        if (items.length < PAGE_SIZE) break;
        page += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) throw new Error("XimalayaAdapter.normalize: payload missing");
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_PLAY) return normalizeTrack(raw.payload, raw, ingestedAt, EVENT_SUBTYPES.MEDIA, "收听");
    if (kind === KIND_FAVORITE) return normalizeTrack(raw.payload, raw, ingestedAt, EVENT_SUBTYPES.LIKE, "收藏");
    if (kind === KIND_SUBSCRIBE) return normalizeSubscribe(raw.payload, raw, ingestedAt);
    throw new Error(`XimalayaAdapter.normalize: unknown kind ${kind}`);
  }
}

// ─── cookie response → intermediate record ───────────────────────────────────

function extractList(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.tracks)) return d.tracks;
    if (Array.isArray(d.albums)) return d.albums;
    if (Array.isArray(d.albumsInfo)) return d.albumsInfo;
  }
  return [];
}

function trackItemToRecord(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.trackId || it.track_id || it.id;
  if (!id) return null;
  return {
    id: String(id),
    trackId: String(id),
    title: it.title || it.trackTitle || it.track_title || it.name || "(未知声音)",
    anchor: it.nickname || it.anchorName || it.anchor_name || it.anchor || it.nickName || null,
    album: it.albumTitle || it.album_title || it.albumName || it.album || null,
    durationSec: Number.isFinite(it.duration) ? it.duration : Number.isFinite(it.durationSec) ? it.durationSec : null,
    occurredAt: parseTime(it.startedAt || it.playedAt || it.updateTime || it.update_time || it.createTime || it.timestamp),
  };
}

function albumItemToRecord(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.albumId || it.album_id || it.id;
  if (!id) return null;
  return {
    id: String(id),
    albumId: String(id),
    album: it.albumTitle || it.album_title || it.title || it.name || "(未命名专辑)",
    trackCount:
      it.includeTrackCount != null ? it.includeTrackCount
      : it.tracks != null ? it.tracks
      : it.trackCount != null ? it.trackCount
      : null,
    anchor: it.nickname || it.anchorName || it.anchor_name || it.anchor || null,
    occurredAt: parseTime(it.subscribeTime || it.subscribe_time || it.createTime || it.updateTime),
  };
}

// ─── normalizers (mirror music-kugou) ────────────────────────────────────────

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeTrack(p, raw, ingestedAt, subtype, verb) {
  const occurredAt = parseTime(p.occurredAt || p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const title = p.title || "(未知声音)";
  const anchor = p.anchor || "";
  const trackId = p.trackId != null ? String(p.trackId) : null;
  const itemId = trackId ? `item-ximalaya-track-${trackId}` : `item-ximalaya-track-${newId()}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype,
        occurredAt,
        actor: "person-self",
        content: { title: `${verb}: ${title}${anchor ? " - " + anchor : ""}`, text: `${title} ${anchor}`.trim() },
        ingestedAt,
        source,
        extra: {
          platform: "ximalaya",
          title,
          anchor,
          album: p.album || null,
          trackId,
          durationSec: p.durationSec != null ? p.durationSec : null,
          itemRef: itemId,
        },
      },
    ],
    items: [
      {
        id: itemId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.MEDIA,
        name: anchor ? `${title} - ${anchor}` : title,
        ingestedAt,
        source,
        extra: { platform: "ximalaya", kind: "track", title, anchor, album: p.album || null, trackId },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

function normalizeSubscribe(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.occurredAt || p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const aid = p.albumId != null ? String(p.albumId) : null;
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [
      {
        id: aid ? `topic-ximalaya-album-${aid}` : `topic-ximalaya-album-${newId()}`,
        type: ENTITY_TYPES.TOPIC,
        name: p.album || "(未命名专辑)",
        ingestedAt,
        source,
        extra: {
          platform: "ximalaya",
          albumId: aid,
          trackCount: p.trackCount != null ? p.trackCount : null,
          anchor: p.anchor || null,
        },
      },
    ],
  };
}

async function defaultFetch(_opts) {
  throw new Error("audio-ximalaya: no fetchFn configured for cookie-api mode");
}

module.exports = {
  XimalayaAdapter,
  extractList,
  trackItemToRecord,
  albumItemToRecord,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
};
