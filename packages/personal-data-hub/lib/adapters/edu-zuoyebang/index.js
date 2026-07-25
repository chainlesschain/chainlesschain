/**
 * FAMILY-23 — 作业帮 (Zuoyebang) adapter.
 *
 * 家庭守护 telemetry：家长看孩子的学习/搜题情况。两路互补：
 *   - snapshot 模式（inputPath）：手机端 collector 快照 (profile + study-session)。
 *   - **live 模式（cookie，v0.2 接通）**：[ZuoyebangApiClient.fetchSnapshot] 经
 *     作业帮 web 接口（ZYBUSS 会话 cookie）拉 用户信息 + 学习/搜题记录。端点/
 *     字段无公开稳定文档，按 web 端常见形态实现 + 多字段名兼容，**未实地验证**，
 *     漂移时按 api-client 常量/pick 列表调整。
 * 无 inputPath 且无 cookie 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   { schemaVersion:1, snapshottedAt, account:{uid,displayName}, events:[
 *     { kind:"profile", id, capturedAt, uid, nickname, grade },
 *     { kind:"study", id, capturedAt, subject, durationMs, startAt } ] }
 *
 * Sensitivity: "medium"（学习习惯）。
 */
"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  probeJsonSnapshotFile,
  readJsonSnapshot,
} = require("../../snapshot-file");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { ZuoyebangApiClient } = require("./api-client");
const {
  assertRuntimeAccountId,
  createSourceRequestAudit,
  hasRuntimeCookie,
  hasRuntimeAccountId,
  healthCheckFromAuthenticate,
  runtimeAccountIdFailure,
} = require("../_runtime-cookie-source");

const NAME = "edu-zuoyebang";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_PROFILE = "profile";
const KIND_STUDY = "study";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_STUDY]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `zuoyebang:${kind}:${safe}`;
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

class ZuoyebangAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["uid", "userId", "accountId"],
    );
    this.runtimeScopeIdentityKey = "uid";
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:zuoyebang-profile",
      "parse:zuoyebang-study-session",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "zuoyebang:profile (uid / nickname / grade)",
        "zuoyebang:study_session (subject / start / duration)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { profile: true, study: true },
    };
    this.apiClient = new ZuoyebangApiClient(opts);
    this._fetch = typeof opts.fetch === "function" ? opts.fetch : null;
    // Test seam: override how the live client is built per-sync (inject fetch).
    this._apiClientFactory =
      typeof opts.apiClientFactory === "function"
        ? opts.apiClientFactory
        : null;
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
      return runtimeAccountIdFailure(NAME);
    }
    if (hasRuntimeCookie(ctx)) {
      if (!this.apiClient.hasSession(ctx.cookie)) {
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          message: `edu-zuoyebang.authenticate: ${this.apiClient.lastError.message}`,
        };
      }
      return {
        ok: true,
        account: String(ctx.accountId).trim(),
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "edu-zuoyebang.authenticate: needs opts.inputPath (snapshot mode) or opts.cookie (ZYBUSS 会话, live fetch)",
    };
  }

  async healthCheck(opts = {}) {
    return healthCheckFromAuthenticate(this, opts);
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (hasRuntimeCookie(opts)) {
      assertRuntimeAccountId(NAME, opts);
      yield* this._syncViaLive(opts);
      return;
    }
    throw new Error(
      "edu-zuoyebang.sync: needs opts.inputPath (snapshot mode) or opts.cookie (ZYBUSS 会话, 学习/搜题记录 live fetch)",
    );
  }

  async *_syncViaLive(opts) {
    assertRuntimeAccountId(NAME, opts);
    const sourceRequestAudit = createSourceRequestAudit(
      opts,
      `${NAME}:live`,
      this._fetch,
    );
    const liveOpts = { ...opts, fetch: sourceRequestAudit.fetch };
    const client = this._apiClientFactory
      ? this._apiClientFactory(liveOpts)
      : new ZuoyebangApiClient({
          fetch: sourceRequestAudit.fetch,
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
    sourceRequestAudit.throwIfPermitFailed();
    if (result === null) {
      const e = client.lastError;
      throw new Error(
        `edu-zuoyebang.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
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
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.uid ||
        null;
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
    const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
      maxBytes: opts.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["events"],
      allowedEventKinds: VALID_SNAPSHOT_KINDS,
    });
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
    const events = snapshot.events;
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      const kind = ev.kind;
      if (include[kind] === false) continue;
      const capturedAt = parseTime(ev.capturedAt) || fallbackCapturedAt;
      const explicitId =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        (typeof ev.id === "number" && Number.isFinite(ev.id) ? ev.id : null);
      const id = explicitId ?? (kind === KIND_PROFILE ? ev.uid : null);
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
      throw new Error("ZuoyebangAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) return normalizeProfile(p, raw, ingestedAt);
    if (kind === KIND_STUDY) return normalizeStudy(p, raw, ingestedAt);
    throw new Error(`ZuoyebangAdapter.normalize: unknown kind ${kind}`);
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
  if (uid) identifiers["zuoyebang-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid
          ? `person-zuoyebang-${uid}`
          : `person-zuoyebang-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: {
          platform: "zuoyebang",
          grade: p.grade || null,
          snapshottedAt: occurredAt,
        },
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
        content: { title: "作业帮 学习" },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "zuoyebang",
          kind: "study",
          subject: p.subject || null,
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
  ZuoyebangAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_STUDY,
};
