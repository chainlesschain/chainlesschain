/**
 * FAMILY-23 v0.1 — 支付宝 (Alipay) adapter, snapshot mode.
 *
 * 家庭守护 telemetry：家长看孩子的消费情况。**高敏感**（涉资金）— 上行受
 * telemetry level + quiet hours 闸（FAMILY-24/25）。v0.1 cookie-scrape 占位 —
 * [AlipayApiClient.extractUid] 抽 uid；snapshot 模式消费手机端 collector 快照
 * (profile + order)。账单 HTTP fetcher（mobilegw + 签名）留 v0.2，故无 inputPath
 * 时 sync 抛 NO_INPUT。
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
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { AlipayApiClient } = require("./api-client");

const NAME = "finance-alipay";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_PROFILE = "profile";
const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_ORDER]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "parse:alipay-profile",
      "parse:alipay-order",
    ];
    this.extractMode = "web-api";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "alipay:profile (uid / nickname)",
        "alipay:order (merchant / amount / direction / time)",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { profile: true, order: true },
    };
    this.apiClient = new AlipayApiClient();
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
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "finance-alipay.authenticate: v0.1 needs opts.inputPath (snapshot mode); live HTTP fetcher 待 v0.2",
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
    throw new Error(
      "finance-alipay.sync: v0.1 needs opts.inputPath (snapshot mode); 账单 HTTP fetcher (mobilegw + 签名) 待 v0.2",
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
        `finance-alipay.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
