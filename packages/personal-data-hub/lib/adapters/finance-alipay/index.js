/**
 * FAMILY-23 — 支付宝 (Alipay) adapter.
 *
 * 家庭守护 telemetry：家长看孩子的消费情况。**高敏感**（涉资金）— 上行受
 * telemetry level + quiet hours 闸（FAMILY-24/25）。两路互补：
 *   - snapshot 模式（inputPath）：手机端 collector 快照 (profile + order)。
 *   - **live 模式（cookie，v0.2 接通）**：[AlipayApiClient.fetchSnapshot] 经
 *     mobilegw（mgw.htm）拉账单/交易明细；多数 operationType 需 app 级签名 —
 *     opts.signProvider seam 注入，未注入发未签名请求（服务端可能拒）。端点/
 *     字段无公开稳定文档，按社区逆向常见形态实现 + 多字段名兼容，**未实地
 *     验证**，漂移时按 api-client 常量/pick 列表调整。
 * 无 inputPath 且无 cookie 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   { schemaVersion:1, snapshottedAt, account:{uid,displayName}, events:[
 *     { kind:"profile", id, capturedAt, uid, nickname },
 *     { kind:"order", id, capturedAt, merchant, amountFen, direction, startAt } ] }
 *   direction: "out"(支出) | "in"(收入)。amountFen: 分（整数）。
 *
 * Sensitivity: "high"。
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
const { AlipayApiClient } = require("./api-client");
const {
  assertRuntimeAccountId,
  createSourceRequestAudit,
  hasRuntimeCookie,
  hasRuntimeAccountId,
  healthCheckFromAuthenticate,
  runtimeAccountIdFailure,
} = require("../_runtime-cookie-source");

const NAME = "finance-alipay";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_PROFILE = "profile";
const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_ORDER]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `alipay:${kind}:${safe}`;
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

class AlipayAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["userId", "uid", "accountId"],
    );
    this.runtimeScopeIdentityKey = "userId";
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:alipay-profile",
      "parse:alipay-order",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "alipay:profile (uid / nickname)",
        "alipay:order (merchant / amount / direction / time)",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { profile: true, order: true },
    };
    this.apiClient = new AlipayApiClient(opts);
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
          message: `finance-alipay.authenticate: ${this.apiClient.lastError.message}`,
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
        "finance-alipay.authenticate: needs opts.inputPath (snapshot mode) or opts.cookie (支付宝会话, mobilegw live fetch)",
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
      "finance-alipay.sync: needs opts.inputPath (snapshot mode) or opts.cookie (支付宝会话, 账单 mobilegw live fetch)",
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
      : new AlipayApiClient({
          fetch: sourceRequestAudit.fetch,
          baseUrl: opts.baseUrl,
          mgwPath: opts.mgwPath,
          billListOp: opts.billListOp,
          signProvider: opts.signProvider,
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
        `finance-alipay.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
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
      throw new Error("AlipayAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) return normalizeProfile(p, raw, ingestedAt);
    if (kind === KIND_ORDER) return normalizeOrder(p, raw, ingestedAt);
    throw new Error(`AlipayAdapter.normalize: unknown kind ${kind}`);
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
  if (uid) identifiers["alipay-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-alipay-${uid}` : `person-alipay-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: { platform: "alipay", snapshottedAt: occurredAt },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeOrder(p, raw, ingestedAt) {
  const occurredAt =
    parseTime(p.startAt) ||
    parseTime(p.capturedAt) ||
    raw.capturedAt ||
    ingestedAt;
  const merchant = p.merchant || "(unknown merchant)";
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.PAYMENT,
        occurredAt,
        actor: "person-self",
        content: { title: merchant },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "alipay",
          kind: "order",
          merchant,
          amountFen: Number.isFinite(p.amountFen) ? p.amountFen : null,
          direction: p.direction === "in" ? "in" : "out",
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
  AlipayAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_ORDER,
};
