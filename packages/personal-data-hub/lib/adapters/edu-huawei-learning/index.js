/**
 * FAMILY-23 — 华为学习中心 (Huawei Learning Center) adapter.
 *
 * 家庭守护 telemetry：家长看孩子的课程/学习时长。两路互补：
 *   - snapshot 模式（inputPath）：手机端 collector 快照 (profile + study-session)。
 *   - **live 模式（cookie，v0.2 接通）**：[HuaweiLearningApiClient.fetchSnapshot]
 *     经学习中心接口（华为账号 web 会话 cookie）拉 用户信息 + 课程学习记录。
 *     端点/字段无公开稳定文档，按 hicloud 教育服务常见形态实现 + 多字段名兼容，
 *     **未实地验证**，漂移时按 api-client 常量/pick 列表调整。
 * 无 inputPath 且无 cookie 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   { schemaVersion:1, snapshottedAt, account:{uid,displayName}, events:[
 *     { kind:"profile", id, capturedAt, uid, nickname },
 *     { kind:"study", id, capturedAt, course, durationMs, startAt } ] }
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
const { HuaweiLearningApiClient } = require("./api-client");

const NAME = "edu-huawei-learning";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_PROFILE = "profile";
const KIND_STUDY = "study";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_STUDY]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `huaweilearning:${kind}:${safe}`;
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

class HuaweiLearningAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:huawei-learning-profile",
      "parse:huawei-learning-study-session",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "huawei-learning:profile (uid / nickname)",
        "huawei-learning:study_session (course / start / duration)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { profile: true, study: true },
    };
    this.apiClient = new HuaweiLearningApiClient(opts);
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
      if (!this.apiClient.hasSession(ctx.cookie)) {
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          message: `edu-huawei-learning.authenticate: ${this.apiClient.lastError.message}`,
        };
      }
      return { ok: true, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "edu-huawei-learning.authenticate: needs opts.inputPath (snapshot mode) or opts.cookie (华为账号会话, live fetch)",
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
      "edu-huawei-learning.sync: needs opts.inputPath (snapshot mode) or opts.cookie (华为账号会话, 课程学习记录 live fetch)",
    );
  }

  async *_syncViaLive(opts) {
    const client = this._apiClientFactory
      ? this._apiClientFactory(opts)
      : new HuaweiLearningApiClient({
          fetch: opts.fetch,
          baseUrl: opts.baseUrl,
          userInfoPath: opts.userInfoPath,
          studyRecordsPath: opts.studyRecordsPath,
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
      limit: opts.limit,
      offset: opts.offset,
    });
    if (result === null) {
      const e = client.lastError;
      throw new Error(
        `edu-huawei-learning.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
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
        `edu-huawei-learning.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      throw new Error("HuaweiLearningAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) return normalizeProfile(p, raw, ingestedAt);
    if (kind === KIND_STUDY) return normalizeStudy(p, raw, ingestedAt);
    throw new Error(`HuaweiLearningAdapter.normalize: unknown kind ${kind}`);
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
  if (uid) identifiers["huawei-learning-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid
          ? `person-huaweilearning-${uid}`
          : `person-huaweilearning-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: { platform: "huawei-learning", snapshottedAt: occurredAt },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeStudy(p, raw, ingestedAt) {
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
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt,
        actor: "person-self",
        content: { title: "华为学习中心 学习" },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "huawei-learning",
          kind: "study",
          course: p.course || null,
          durationMs: Number.isFinite(p.durationMs) ? p.durationMs : 0,
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
  HuaweiLearningAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_STUDY,
};
