/**
 * §A12 — Kugou 酷狗音乐 (com.kugou.android) adapter, dual-mode (snapshot +
 * cookie-api). Phase 13+ §12.1 line-781 ROI ⭐⭐ "听歌历史".
 *
 * Mirrors netease-music's three-kind shape (play / favorite / playlist) so the
 * vault treats music listening uniformly across providers. Unlike netease (which
 * needs weapi signing via a dedicated api-client), Kugou's web endpoints are
 * fetched through a generic injected `fetchFn` + optional signProvider seam,
 * keeping this module a pure-Node parser/orchestrator.
 *
 *   1. snapshot mode (opts.inputPath): JSON schemaVersion 1, stateless.
 *   2. cookie-api mode (opts.account.cookies): fetch play history / favourites /
 *      playlists from kugou web via the injected fetchFn, paginate; sign seam
 *      (opts.signProvider) for any anti-bot token; endpoints overridable via
 *      opts.*Url (best-effort, not field-verified — FAMILY-23 playbook).
 *
 * Snapshot schema (schemaVersion 1, mirrors netease-music):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "play",     "id": "...", "songId": "...", "song": "...",
 *         "artist": "...", "album": "...", "playCount": N, "capturedAt": <ms> },
 *       { "kind": "favorite", "id": "...", "songId": "...", "song": "...", "artist": "..." },
 *       { "kind": "playlist", "id": "...", "playlistId": "...", "name": "...",
 *         "trackCount": N, "creator": "..." }
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

const NAME = "music-kugou";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PLAY = "play";
const KIND_FAVORITE = "favorite";
const KIND_PLAYLIST = "playlist";
const VALID_KINDS = Object.freeze([KIND_PLAY, KIND_FAVORITE, KIND_PLAYLIST]);

// Best-effort Kugou web endpoints. Overridable via opts.*Url.
const PLAYS_URL = "https://www.kugou.com/api/v3/user/listen/list";
const FAVORITES_URL = "https://www.kugou.com/api/v3/user/favorite/list";
const PLAYLISTS_URL = "https://www.kugou.com/api/v3/user/playlist/list";
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
  return `kugou:${kind}:${safe}`;
}

/** Split Kugou's "歌手 - 歌名" filename into {song, artist} when discrete
 *  fields are absent. */
function splitFilename(name) {
  if (typeof name !== "string" || !name.includes(" - ")) return null;
  const idx = name.indexOf(" - ");
  return { artist: name.slice(0, idx).trim(), song: name.slice(idx + 3).trim() };
}

class KugouMusicAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "kugou", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._urls = {
      play: opts.playsUrl || PLAYS_URL,
      favorite: opts.favoritesUrl || FAVORITES_URL,
      playlist: opts.playlistsUrl || PLAYLISTS_URL,
    };

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:kugou-play",
      "parse:kugou-favorite",
      "parse:kugou-playlist",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "kugou:play (歌名 / 歌手 / 专辑)",
        "kugou:favorite (收藏的歌)",
        "kugou:playlist (歌单名 / 曲目数)",
      ],
      sensitivity: "low",
      legalGate: false,
      defaultInclude: { play: true, favorite: true, playlist: true },
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
      message: "music-kugou.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
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
      "music-kugou.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(
        `music-kugou.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      const id = (typeof ev.id === "string" && ev.id) || ev.songId || ev.playlistId || null;
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
      { kind: KIND_PLAY, url: this._urls.play, map: songItemToRecord },
      { kind: KIND_FAVORITE, url: this._urls.favorite, map: songItemToRecord },
      { kind: KIND_PLAYLIST, url: this._urls.playlist, map: playlistItemToRecord },
    ];

    let emitted = 0;
    for (const step of plan) {
      if (include[step.kind] === false) continue;
      let page = 1;
      while (page <= maxPages) {
        const query = { page, pagesize: PAGE_SIZE };
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
    if (!raw || !raw.payload) throw new Error("KugouMusicAdapter.normalize: payload missing");
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_PLAY) return normalizeSong(raw.payload, raw, ingestedAt, EVENT_SUBTYPES.MEDIA, "听了");
    if (kind === KIND_FAVORITE) return normalizeSong(raw.payload, raw, ingestedAt, EVENT_SUBTYPES.LIKE, "收藏");
    if (kind === KIND_PLAYLIST) return normalizePlaylist(raw.payload, raw, ingestedAt);
    throw new Error(`KugouMusicAdapter.normalize: unknown kind ${kind}`);
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
    if (Array.isArray(d.info)) return d.info;
    if (Array.isArray(d.songs)) return d.songs;
  }
  return [];
}

function songItemToRecord(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.hash || it.mixsongid || it.songid || it.audio_id || it.id;
  if (!id) return null;
  let song = it.songname || it.song_name || it.name || null;
  let artist = it.singername || it.singer_name || it.author_name || it.singer || null;
  if ((!song || !artist) && it.filename) {
    const split = splitFilename(it.filename);
    if (split) {
      song = song || split.song;
      artist = artist || split.artist;
    }
  }
  return {
    id: String(id),
    songId: String(id),
    song: song || "(未知歌曲)",
    artist: artist || "",
    album: it.album_name || it.albumname || it.album || null,
    occurredAt: parseTime(it.addtime || it.playtime || it.update_time || it.timestamp),
  };
}

function playlistItemToRecord(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.listid || it.global_collection_id || it.specialid || it.id;
  if (!id) return null;
  return {
    id: String(id),
    playlistId: String(id),
    name: it.name || it.list_name || it.specialname || "(未命名歌单)",
    trackCount: it.count != null ? it.count : it.song_count != null ? it.song_count : null,
    creator: it.nickname || it.list_create_username || it.creator || null,
    occurredAt: parseTime(it.create_time || it.addtime),
  };
}

// ─── normalizers (mirror netease-music) ──────────────────────────────────────

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeSong(p, raw, ingestedAt, subtype, verb) {
  const occurredAt = parseTime(p.occurredAt || p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const song = p.song || "(未知歌曲)";
  const artist = p.artist || "";
  const songId = p.songId != null ? String(p.songId) : null;
  const itemId = songId ? `item-kugou-song-${songId}` : `item-kugou-song-${newId()}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype,
        occurredAt,
        actor: "person-self",
        content: { title: `${verb}: ${song}${artist ? " - " + artist : ""}`, text: `${song} ${artist}`.trim() },
        ingestedAt,
        source,
        extra: {
          platform: "kugou",
          song,
          artist,
          album: p.album || null,
          songId,
          playCount: p.playCount != null ? p.playCount : null,
          itemRef: itemId,
        },
      },
    ],
    items: [
      {
        id: itemId,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.MEDIA,
        name: artist ? `${song} - ${artist}` : song,
        ingestedAt,
        source,
        extra: { platform: "kugou", kind: "song", song, artist, album: p.album || null, songId },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

function normalizePlaylist(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.occurredAt || p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const pid = p.playlistId != null ? String(p.playlistId) : null;
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [
      {
        id: pid ? `topic-kugou-playlist-${pid}` : `topic-kugou-playlist-${newId()}`,
        type: ENTITY_TYPES.TOPIC,
        name: p.name || "(未命名歌单)",
        ingestedAt,
        source,
        extra: {
          platform: "kugou",
          playlistId: pid,
          trackCount: p.trackCount != null ? p.trackCount : null,
          creator: p.creator || null,
        },
      },
    ],
  };
}

async function defaultFetch(_opts) {
  throw new Error("music-kugou: no fetchFn configured for cookie-api mode");
}

module.exports = {
  KugouMusicAdapter,
  extractList,
  songItemToRecord,
  playlistItemToRecord,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
};
