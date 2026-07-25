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
const crypto = require("node:crypto");
const { newId } = require("../../ids");
const {
  createAccountScope,
  createAccountScopeFromAccount,
} = require("../../account-scope");
const {
  SnapshotFileError,
  inspectSnapshotFile,
  probeJsonSnapshotFile,
  readBoundedSnapshotBuffer,
  validateJsonSnapshot,
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
const {
  DEFAULT_MAX_PLAYLIST_PAGES,
  DEFAULT_PLAYLIST_PAGE_SIZE,
  NeteaseMusicApiClient,
} = require("./api-client");
const {
  advanceCursor,
  assertScanIdentity,
  beginScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "netease-music";
const VERSION = "0.3.0";
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
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `netease-music:${kind}:${safe}`;
}

class NeteaseMusicAdapter {
  constructor(opts = {}) {
    this._dataPath = opts.inputPath || null;
    this._cookie = opts.cookie || null;
    this._fetch = typeof opts.fetch === "function" ? opts.fetch : null;
    // Test seam: override how the live client is built per-sync (inject fetch).
    this._apiClientFactory =
      typeof opts.apiClientFactory === "function"
        ? opts.apiClientFactory
        : null;
    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      opts.account || opts,
      ["userId", "uid", "accountId"],
    );
    this.runtimeScopeIdentityKey = "userId";
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:netease-play",
      "parse:netease-favorite",
      "parse:netease-playlist",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.watermarkStrategy = "explicit";
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

  fileCheckpointMode() {
    return "shared";
  }

  resolveDefaultScope(options = {}) {
    const inputPath = options.inputPath || this._dataPath;
    return inputPath
      ? scopeForSnapshot(
          this._deps.fs,
          inputPath,
          options.maxSnapshotBytes,
          this.defaultScope,
        )
      : this.defaultScope;
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
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
      return probeJsonSnapshotFile(this._deps.fs, inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_KINDS,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
      return runtimeAccountIdFailure(NAME);
    }
    const cookie = (ctx && ctx.cookie) || this._cookie;
    if (cookie) {
      return /MUSIC_U=/.test(cookie)
        ? {
            ok: true,
            account: hasRuntimeCookie(ctx)
              ? String(ctx.accountId).trim()
              : null,
            mode: "cookie",
          }
        : {
            ok: false,
            reason: "INVALID_COOKIE",
            message: "netease-music.authenticate: cookie 缺 MUSIC_U（未登录）",
          };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "netease-music.authenticate: needs opts.inputPath (snapshot) or opts.cookie (live weapi)",
    };
  }

  async healthCheck(opts = {}) {
    return healthCheckFromAuthenticate(this, opts);
  }

  async *sync(opts = {}) {
    const inputPath = opts.inputPath || this._dataPath;
    if (!inputPath) {
      assertRuntimeAccountId(NAME, opts);
      const cookie = opts.cookie || this._cookie;
      if (cookie) {
        yield* this._syncViaCookie({ ...opts, cookie });
        return;
      }
      throw new Error(
        "netease-music.sync: needs opts.inputPath (snapshot JSON) or opts.cookie (live weapi fetch)",
      );
    }
    const { snapshot, source } = readSnapshotSource(
      this._deps.fs,
      inputPath,
      opts.maxSnapshotBytes,
    );
    const fallback =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const records = snapshot.events.map((ev) => {
      const id =
        (typeof ev.id === "string" && ev.id) ||
        ev.songId ||
        ev.playlistId ||
        null;
      return {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt: parseTime(ev.capturedAt) || fallback,
        payload: { ...ev, account },
      };
    });
    const config = collectionConfig("snapshot", opts);
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode: "snapshot",
      source,
      config,
      upper: records.length,
    });
    const publish = () => publishCursor(opts, cursor);
    let emitted = 0;
    let ordinal = cursor.after ?? 0;
    while (cursor.upper !== null && emitted < limit) {
      ordinal += 1;
      const raw = records[ordinal - 1];
      cursor = advanceCursor(cursor, ordinal);
      publish();
      if (include[raw.kind] === false) continue;
      yield raw;
      emitted += 1;
    }
    publish();
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
      : new NeteaseMusicApiClient({
          fetch: sourceRequestAudit.fetch,
          rand: opts.rand,
          secKey: opts.secKey,
          baseUrl: opts.baseUrl,
        });
    const emit = (phase, extra) => {
      if (typeof opts.onProgress === "function") {
        try {
          opts.onProgress({ phase, adapter: NAME, ...extra });
        } catch {
          /* progress callback errors are best-effort */
        }
      }
    };
    const result = await client.fetchSnapshot(opts.cookie, {
      include: opts.include || {},
      recordType: resolveRecordType(opts.recordType),
      playlistPageSize: resolvePlaylistPageSize(opts),
      maxPlaylistPages: resolveMaxPlaylistPages(opts.maxPlaylistPages),
    });
    sourceRequestAudit.throwIfPermitFailed();
    if (result === null) {
      const e = client.lastError;
      throw new Error(
        `netease-music.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
      );
    }
    const account = result.account || null;
    emit("fetched", { count: result.events.length });
    const capturedAt = Date.now();
    const records = result.events.map((ev) => {
      if (!ev || !VALID_KINDS.includes(ev.kind)) {
        throw new Error(`${NAME}.sync: live source returned an unknown kind`);
      }
      const id =
        (typeof ev.id === "string" && ev.id) ||
        ev.songId ||
        ev.playlistId ||
        null;
      return {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt,
        payload: { ...ev, capturedAt, account },
      };
    });
    const source = digest(
      Buffer.from(
        JSON.stringify(records.map((record) => record.originalId)),
        "utf8",
      ),
    );
    const config = collectionConfig("live", opts);
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode: "live",
      source,
      config,
      upper: records.length,
    });
    const publish = () => publishCursor(opts, cursor);
    let emitted = 0;
    let ordinal = cursor.after ?? 0;
    while (cursor.upper !== null && emitted < limit) {
      ordinal += 1;
      const raw = records[ordinal - 1];
      cursor = advanceCursor(cursor, ordinal);
      publish();
      yield raw;
      emitted += 1;
    }
    publish();
    emit("done", { yielded: emitted, count: records.length });
  }

  normalize(raw) {
    if (!raw || !raw.payload)
      throw new Error("NeteaseMusicAdapter.normalize: payload missing");
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_PLAY)
      return normalizeSong(
        raw.payload,
        raw,
        ingestedAt,
        EVENT_SUBTYPES.MEDIA,
        "听了",
      );
    if (kind === KIND_FAVORITE)
      return normalizeSong(
        raw.payload,
        raw,
        ingestedAt,
        EVENT_SUBTYPES.LIKE,
        "收藏",
      );
    if (kind === KIND_PLAYLIST)
      return normalizePlaylist(raw.payload, raw, ingestedAt);
    throw new Error(`NeteaseMusicAdapter.normalize: unknown kind ${kind}`);
  }
}

function readSnapshotSource(fsMod, inputPath, maxBytes) {
  const buffer = readBoundedSnapshotBuffer(fsMod, inputPath, { maxBytes });
  let snapshot;
  try {
    snapshot = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new SnapshotFileError(
      "SNAPSHOT_JSON_INVALID",
      "snapshot file must contain valid JSON",
      { cause: error },
    );
  }
  validateJsonSnapshot(snapshot, {
    expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    requiredArrayFields: ["events"],
    allowedEventKinds: VALID_KINDS,
  });
  return { snapshot, source: digest(buffer) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(mode, opts) {
  const include = opts.include || {};
  const config = {
    include: {
      favorite: include[KIND_FAVORITE] !== false,
      play: include[KIND_PLAY] !== false,
      playlist: include[KIND_PLAYLIST] !== false,
    },
    mode,
  };
  if (mode === "live") {
    config.recordType = resolveRecordType(opts.recordType);
    config.playlistPageSize = resolvePlaylistPageSize(opts);
    config.maxPlaylistPages = resolveMaxPlaylistPages(opts.maxPlaylistPages);
  }
  return digest(Buffer.from(JSON.stringify(config), "utf8"));
}

function resolveRecordType(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 1;
}

function resolvePlaylistPageSize(opts) {
  if (
    Number.isSafeInteger(opts.playlistPageSize) &&
    opts.playlistPageSize > 0
  ) {
    return opts.playlistPageSize;
  }
  if (Number.isSafeInteger(opts.playlistLimit) && opts.playlistLimit > 0) {
    return opts.playlistLimit;
  }
  return DEFAULT_PLAYLIST_PAGE_SIZE;
}

function resolveMaxPlaylistPages(value) {
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_PLAYLIST_PAGES;
}

function prepareCursor(sinceWatermark, identity) {
  let cursor = parseCursor(sinceWatermark).cursor;
  cursor =
    cursor.upper === null
      ? beginScan(cursor, identity)
      : assertScanIdentity(cursor, identity);
  return cursor;
}

function publishCursor(opts, cursor) {
  if (typeof opts.updateWatermark === "function") {
    opts.updateWatermark(serializeCursor(cursor));
  }
}

function scopeForSnapshot(fsMod, inputPath, maxBytes, accountScope) {
  const inspected = inspectSnapshotFile(fsMod, inputPath, { maxBytes });
  const revision =
    inspected.stat.mtimeNs ??
    inspected.stat.mtimeMs ??
    inspected.stat.ctimeNs ??
    inspected.stat.ctimeMs ??
    "";
  return createAccountScope(
    NAME,
    [
      accountScope || "unscoped",
      "snapshot",
      inspected.realPath,
      String(inspected.size),
      String(revision),
    ].join("\0"),
  );
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
  const itemId = songId
    ? `item-netease-song-${songId}`
    : `item-netease-song-${newId()}`;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype,
        occurredAt,
        actor: "person-self",
        content: {
          title: `${verb}: ${song}${artist ? " - " + artist : ""}`,
          text: `${song} ${artist}`.trim(),
        },
        ingestedAt,
        source,
        extra: {
          platform: "netease-music",
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
        extra: {
          platform: "netease-music",
          kind: "song",
          song,
          artist,
          album: p.album || null,
          songId,
        },
      },
    ],
    persons: [],
    places: [],
    topics: [],
  };
}

function normalizePlaylist(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const pid = p.playlistId != null ? String(p.playlistId) : null;
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [
      {
        id: pid
          ? `topic-netease-playlist-${pid}`
          : `topic-netease-playlist-${newId()}`,
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
      },
    ],
  };
}

module.exports = {
  NeteaseMusicAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
};
