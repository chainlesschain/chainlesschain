/**
 * FAMILY-23 — 王者荣耀 (Honor of Kings) adapter.
 *
 * 家庭守护 telemetry：家长看孩子玩什么游戏/玩多久。两路互补：
 *   - snapshot 模式（inputPath）：手机端 collector 快照 (profile + play-session)。
 *   - **live 模式（credential，v0.2 接通）**：[HonorOfKingsApiClient.fetchSnapshot]
 *     经 王者营地 (Camp) 接口拉个人资料 + 最近对局（含对局时长 → "玩多久"）。
 *     ⚠️ 营地走 QQ/微信 OAuth，需 credential={accessToken,openid,acctype,areaId,
 *     roleId,...}（手机端登录态取得后回传），不是 web cookie。营地端点/字段无公开
 *     稳定文档，按社区逆向常见形态实现且做了多字段名兼容，**未实地验证**，漂移
 *     时按 api-client 常量/pick 列表调整。
 * 无 inputPath 且无 credential 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   { schemaVersion:1, snapshottedAt, account:{uid,displayName}, events:[
 *     { kind:"profile", id, capturedAt, uid, nickname, level, rank, avatarUrl },
 *     { kind:"play", id, capturedAt, durationMs, mode, startAt } ] }
 *
 * Sensitivity: "medium"。
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
const { HonorOfKingsApiClient } = require("./api-client");

const NAME = "game-honor-of-kings";
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
  return `hok:${kind}:${safe}`;
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

class HonorOfKingsAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:camp-token",
      "parse:hok-profile",
      "parse:hok-play-session",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "hok:profile (uid / nickname / level / rank / avatar)",
        "hok:play_session (start / duration / mode)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { profile: true, play: true },
    };
    this.apiClient = new HonorOfKingsApiClient(opts);
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
    const cred = ctx && ctx.credential;
    if (cred && typeof cred === "object" && cred.accessToken && cred.openid) {
      return { ok: true, mode: "camp-token" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "game-honor-of-kings.authenticate: needs opts.inputPath (snapshot) or opts.credential {accessToken,openid,...} (营地 live)",
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
    if (opts.credential && typeof opts.credential === "object") {
      yield* this._syncViaLive(opts);
      return;
    }
    throw new Error(
      "game-honor-of-kings.sync: needs opts.inputPath (snapshot mode) or opts.credential {accessToken,openid,...} (营地战绩 live)",
    );
  }

  async *_syncViaLive(opts) {
    const client = this._apiClientFactory
      ? this._apiClientFactory(opts)
      : new HonorOfKingsApiClient({
          fetch: opts.fetch,
          now: opts.now,
          baseUrl: opts.baseUrl,
          profilePath: opts.profilePath,
          battleListPath: opts.battleListPath,
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
    const result = await client.fetchSnapshot(opts.credential, {
      include: opts.include || {},
      limit: opts.limit,
      offset: opts.offset,
    });
    if (result === null) {
      const e = client.lastError;
      throw new Error(
        `game-honor-of-kings.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
      );
    }
    const account = result.account || null;
    emit("fetched", { count: result.events.length });
    const capturedAt = Date.now();
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const include = opts.include || {};
    let emitted = 0;
    for (const ev of result.events) {
      if (emitted >= limit) return;
      if (!ev || !VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) || ev.uid || null;
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

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `game-honor-of-kings.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      throw new Error("HonorOfKingsAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) return normalizeProfile(p, raw, ingestedAt);
    if (kind === KIND_PLAY) return normalizePlay(p, raw, ingestedAt);
    throw new Error(`HonorOfKingsAdapter.normalize: unknown kind ${kind}`);
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
  if (uid) identifiers["hok-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-hok-${uid}` : `person-hok-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: {
          platform: "honor-of-kings",
          level: p.level != null ? p.level : null,
          rank: p.rank || null,
          avatarUrl: p.avatarUrl || null,
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
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MEDIA,
        occurredAt,
        actor: "person-self",
        content: { title: "王者荣耀 游戏时长" },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "honor-of-kings",
          kind: "play",
          durationMs: Number.isFinite(p.durationMs) ? p.durationMs : 0,
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
  HonorOfKingsAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_PLAY,
};
