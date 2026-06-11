"use strict";

/**
 * 网易云音乐 (NetEase Cloud Music) adapter — snapshot + live cookie modes.
 *
 * 两路互补：
 *   - snapshot 模式（inputPath）：device-side collector（Android in-app）写
 *     的快照 JSON；schema 是 OUR contract，normalize 全可测、vault 路径稳定。
 *   - **live 模式（cookie，v0.2 接通）**：[NeteaseMusicApiClient.fetchSnapshot]
 *     经标准 weapi 加密拉 `/weapi/v1/play/record`（听歌排行）+ `/weapi/user/playlist`
 *     （歌单），输出形状对齐 snapshot 故 normalize 不变。favorite（喜欢的歌）
 *     需额外解 likelist+歌曲详情，留 snapshot 模式，live 暂不出。
 * Schema 是 OUR contract，无论字节怎么采到 normalize 都一致。
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     schemaVersion: 1, snapshottedAt: <ms>,
 *     account: { uid, nickname },
 *     events: [
 *       { kind: "play",     id, capturedAt, song, artist, album, songId, playCount },
 *       { kind: "favorite", id, capturedAt, song, artist, album, songId },
 *       { kind: "playlist", id, capturedAt, name, playlistId, trackCount, creator }
 *     ]
 *   }
 *
 * play     → EVENT(media, "听了 <song>") + ITEM(song)
 * favorite → EVENT(like)                 + ITEM(song)
 * playlist → TOPIC(歌单)
 */

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "netease-music";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PLAY = "play";
const KIND_FAVORITE = "favorite";
const KIND_PLAYLIST = "playlist";
const VALID_KINDS = Object.freeze([KIND_PLAY, KIND_FAVORITE, KIND_PLAYLIST]);

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
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `netease-music:${kind}:${safe}`;
}

class NeteaseMusicAdapter {
  constructor(opts = {}) {
    this._dataPath = opts.inputPath || null;
    this._cookie = opts.cookie || null;
    // Test seam: override how the live client is built per-sync (inject fetch).
    this._apiClientFactory =
      typeof opts.apiClientFactory === "function" ? opts.apiClientFactory : null;
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:netease-play",
      "parse:netease-favorite",
      "parse:netease-playlist",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "netease:play (歌名 / 歌手 / 专辑 / 播放次数)",
        "netease:favorite (收藏的歌)",
        "netease:playlist (歌单名 / 曲目数)",
      ],
      sensitivity: "low",
      legalGate: false,
    };
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && ctx.readinessOnly) {
      return {
        ok: false,
        reason: "NO_INPUT",
        message: "netease-music: 需手机 App 内采集听歌记录/歌单快照后回传",
      };
    }
    const inputPath = (ctx && ctx.inputPath) || this._dataPath;
    if (inputPath) {
      try {
        this._deps.fs.accessSync(inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return { ok: false, reason: "INPUT_PATH_UNREADABLE", message: `snapshot not readable: ${err.message}` };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    const cookie = (ctx && ctx.cookie) || this._cookie;
    if (cookie) {
      return /MUSIC_U=/.test(cookie)
        ? { ok: true, mode: "cookie" }
        : { ok: false, reason: "INVALID_COOKIE", message: "netease-music.authenticate: cookie 缺 MUSIC_U（未登录）" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message: "netease-music.authenticate: needs opts.inputPath (snapshot) or opts.cookie (live weapi)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const inputPath = opts.inputPath || this._dataPath;
    if (!inputPath) {
      const cookie = opts.cookie || this._cookie;
      if (cookie) {
        yield* this._syncViaCookie({ ...opts, cookie });
        return;
      }
      throw new Error(
        "netease-music.sync: needs opts.inputPath (snapshot JSON) or opts.cookie (live weapi fetch)",
      );
    }
    if (!this._deps.fs.existsSync(inputPath)) return;
    const snapshot = JSON.parse(this._deps.fs.readFileSync(inputPath, "utf-8"));
    if (!snapshot || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(
        `netease-music.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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

  async *_syncViaCookie(opts) {
    const client = this._apiClientFactory
      ? this._apiClientFactory(opts)
      : new (require("./api-client").NeteaseMusicApiClient)({
          fetch: opts.fetch,
          rand: opts.rand,
          secKey: opts.secKey,
          baseUrl: opts.baseUrl,
        });
    const emit = (phase, extra) => {
      if (typeof opts.onProgress === "function") {
        try {
          opts.onProgress({ phase, adapter: NAME, ...extra });
        } catch (_e) {
          /* progress callback errors are best-effort */
        }
      }
    };
    const result = await client.fetchSnapshot(opts.cookie, {
      include: opts.include || {},
      recordType: opts.recordType,
      playlistLimit: opts.playlistLimit,
    });
    if (result === null) {
      const e = client.lastError;
      throw new Error(`netease-music.sync (live): ${e.message || "fetch failed"} (code ${e.code})`);
    }
    const account = result.account || null;
    emit("fetched", { count: result.events.length });
    const capturedAt = Date.now();
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const include = opts.include || {};
    let emitted = 0;
    for (const ev of result.events) {
      if (emitted >= limit) return;
      if (!ev || !VALID_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;
      const id = (typeof ev.id === "string" && ev.id) || ev.songId || ev.playlistId || null;
      yield {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt,
        payload: { ...ev, capturedAt, account },
      };
      emitted += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) throw new Error("NeteaseMusicAdapter.normalize: payload missing");
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_PLAY) return normalizeSong(raw.payload, raw, ingestedAt, EVENT_SUBTYPES.MEDIA, "听了");
    if (kind === KIND_FAVORITE) return normalizeSong(raw.payload, raw, ingestedAt, EVENT_SUBTYPES.LIKE, "收藏");
    if (kind === KIND_PLAYLIST) return normalizePlaylist(raw.payload, raw, ingestedAt);
    throw new Error(`NeteaseMusicAdapter.normalize: unknown kind ${kind}`);
  }
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

function normalizeSong(p, raw, ingestedAt, subtype, verb) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const song = p.song || "(未知歌曲)";
  const artist = p.artist || "";
  const songId = p.songId != null ? String(p.songId) : null;
  const itemId = songId ? `item-netease-song-${songId}` : `item-netease-song-${newId()}`;
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype,
      occurredAt,
      actor: "person-self",
      content: { title: `${verb}: ${song}${artist ? " - " + artist : ""}`, text: `${song} ${artist}`.trim() },
      ingestedAt,
      source,
      extra: {
        platform: "netease-music",
        song, artist, album: p.album || null, songId,
        playCount: p.playCount != null ? p.playCount : null,
        itemRef: itemId,
      },
    }],
    items: [{
      id: itemId,
      type: ENTITY_TYPES.ITEM,
      subtype: ITEM_SUBTYPES.MEDIA,
      name: artist ? `${song} - ${artist}` : song,
      ingestedAt,
      source,
      extra: { platform: "netease-music", kind: "song", song, artist, album: p.album || null, songId },
    }],
    persons: [], places: [], topics: [],
  };
}

function normalizePlaylist(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const pid = p.playlistId != null ? String(p.playlistId) : null;
  return {
    events: [], persons: [], places: [], items: [],
    topics: [{
      id: pid ? `topic-netease-playlist-${pid}` : `topic-netease-playlist-${newId()}`,
      type: ENTITY_TYPES.TOPIC,
      name: p.name || "(未命名歌单)",
      ingestedAt,
      source,
      extra: {
        platform: "netease-music",
        playlistId: pid,
        trackCount: p.trackCount != null ? p.trackCount : null,
        creator: p.creator || null,
      },
    }],
  };
}

module.exports = { NeteaseMusicAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION, VALID_KINDS };
