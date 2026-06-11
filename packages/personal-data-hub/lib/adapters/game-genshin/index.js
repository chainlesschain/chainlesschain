/**
 * FAMILY-23 — Genshin Impact (原神 / 米哈游) adapter.
 *
 * 家庭守护 telemetry：家长想看孩子玩什么游戏 / 玩多久。两路互补：
 *   - snapshot 模式（inputPath）：消费手机端 collector 产的快照 JSON
 *     （profile + play-session 事件，含精确游戏时长）。
 *   - **live 模式（cookie，v0.2 接通）**：[GenshinApiClient.fetchProfiles] 经
 *     米游社 takumi 接口 + DS v1 签名拉取角色档案（nickname / level / region /
 *     活跃天数）。web game-record API 不暴露单次时长，故 live 仅出 profile；
 *     "玩多久" 仍依赖 snapshot。
 * 无 inputPath 且无 cookie 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "旅行者" },
 *     "events": [
 *       { "kind": "profile", "id": "profile-<uid>", "capturedAt": <ms>,
 *         "uid": "...", "nickname": "...", "level": N, "avatarUrl": "..." },
 *       { "kind": "play", "id": "play-<sessionId>", "capturedAt": <ms>,
 *         "durationMs": N, "mode": "...", "startAt": <ms> }
 *     ]
 *   }
 *
 * Sensitivity: "medium" — 游戏时长 / 等级揭示娱乐偏好与在线时段。
 */
"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { GenshinApiClient } = require("./api-client");

const NAME = "game-genshin";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_PLAY = "play";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_PLAY]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `genshin:${kind}:${safe}`;
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

class GenshinAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:genshin-profile",
      "parse:genshin-play-session",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "genshin:profile (uid / nickname / level / avatar)",
        "genshin:play_session (start / duration / mode)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { profile: true, play: true },
    };
    this.apiClient = new GenshinApiClient(opts);
    // Test seam: override how the live client is built per-sync (inject fetch).
    this._apiClientFactory =
      typeof opts.apiClientFactory === "function" ? opts.apiClientFactory : null;
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
    if (ctx && typeof ctx.cookie === "string" && ctx.cookie.length > 0) {
      const uid = this.apiClient.extractUid(ctx.cookie);
      if (!uid) {
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          message: `game-genshin.authenticate: ${this.apiClient.lastError.message}`,
        };
      }
      return { ok: true, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "game-genshin.authenticate: needs opts.inputPath (snapshot mode) or opts.cookie (live HoYoLAB fetch)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (typeof opts.cookie === "string" && opts.cookie.length > 0) {
      yield* this._syncViaLive(opts);
      return;
    }
    throw new Error(
      "game-genshin.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) or opts.cookie (live HoYoLAB fetch via takumi + DS 签名)",
    );
  }

  async *_syncViaLive(opts) {
    const client = this._apiClientFactory
      ? this._apiClientFactory(opts)
      : new GenshinApiClient({
          fetch: opts.fetch,
          now: opts.now,
          rand: opts.rand,
          appVersion: opts.appVersion,
          salt: opts.salt,
          takumiApi: opts.takumiApi,
          recordApi: opts.recordApi,
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
    const profiles = await client.fetchProfiles(opts.cookie, {
      fetchStats: opts.fetchStats !== false,
      limit: opts.limit,
    });
    if (profiles === null) {
      const e = client.lastError;
      throw new Error(
        `game-genshin.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
      );
    }
    emit("roles", { count: profiles.length });
    const capturedAt = Date.now();
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    let emitted = 0;
    for (const prof of profiles) {
      if (emitted >= limit) return;
      yield {
        adapter: NAME,
        kind: KIND_PROFILE,
        originalId: stableOriginalId(KIND_PROFILE, prof.uid),
        capturedAt,
        payload: {
          kind: KIND_PROFILE,
          ...prof,
          account: { uid: prof.uid, displayName: prof.nickname },
        },
      };
      emitted += 1;
    }
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
        `game-genshin.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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

      const capturedAt = parseTime(ev.capturedAt) || fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.uid ||
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

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("GenshinAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) {
      return normalizeProfile(p, raw, ingestedAt);
    }
    if (kind === KIND_PLAY) {
      return normalizePlay(p, raw, ingestedAt);
    }
    throw new Error(`GenshinAdapter.normalize: unknown kind ${kind}`);
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

function normalizeProfile(p, raw, ingestedAt) {
  const uid = p.uid || (p.account && p.account.uid) || null;
  const nickname =
    p.nickname || (p.account && p.account.displayName) || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const identifiers = {};
  if (uid) identifiers["genshin-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-genshin-${uid}` : `person-genshin-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: {
          platform: "genshin",
          level: p.level != null ? p.level : null,
          avatarUrl: p.avatarUrl || null,
          region: p.region || null,
          regionName: p.regionName || null,
          activeDayNumber: Number.isFinite(p.activeDayNumber)
            ? p.activeDayNumber
            : null,
          snapshottedAt: occurredAt,
        },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizePlay(p, raw, ingestedAt) {
  const occurredAt =
    parseTime(p.startAt) ||
    parseTime(p.capturedAt) ||
    raw.capturedAt ||
    ingestedAt;
  const durationMs = Number.isFinite(p.durationMs) ? p.durationMs : 0;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MEDIA,
        occurredAt,
        actor: "person-self",
        content: { title: "原神 游戏时长" },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "genshin",
          kind: "play",
          durationMs,
          mode: p.mode || null,
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
  GenshinAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_PLAY,
};
