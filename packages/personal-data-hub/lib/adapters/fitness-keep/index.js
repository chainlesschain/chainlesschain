/**
 * 健身 — Keep (com.gotokeep.keep) adapter, "运动训练记录". Phase 13+ long-tail
 * (user-requested), new entry under the `fitness-` category (sibling of
 * fitness-joyrun).
 *
 * Keep is China's largest fitness app — 跑步/骑行/健走/瑜伽/力量训练/课程. Unlike
 * 悦跑圈 (running-only), Keep logs MANY workout types, so this carries a
 * `workoutType` per record (vs joyrun's single run kind).
 *
 * Snapshot import is the supported path. Custom cookie collection is enabled
 * only with an explicit, user-captured listUrl and injected fetchFn; this
 * adapter never selects a guessed Keep endpoint by default.
 * Outdoor workouts carry GPS/route → sensitivity:"medium" (legalGate off).
 *
 * One record kind: 训练记录 (workouts):
 *   { workoutId, type, name, time, distanceMeters, durationSec, calories, steps }
 *   → EVENT(OTHER) "运动: <type> X.XX km" / "运动: <type> N 分钟".
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "workout", "id": "w-<id>", "workoutId": "...",
 *         "type": "running|cycling|yoga|strength|hiking|...", "name": "...",
 *         "time": <s|ms>, "distanceMeters": 5230, "durationSec": 1800,
 *         "calories": 320, "steps": 6400 }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "fitness-keep";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_WORKOUT = "workout";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_WORKOUT]);
const PAGE_SIZE = 30;

// Keep workout type token → readable Chinese label (best-effort; falls back to
// the raw token so unknown types still surface).
const TYPE_LABEL = Object.freeze({
  running: "跑步",
  run: "跑步",
  jogging: "慢跑",
  cycling: "骑行",
  riding: "骑行",
  walking: "健走",
  hiking: "徒步",
  yoga: "瑜伽",
  strength: "力量训练",
  training: "训练",
  workout: "训练",
  swimming: "游泳",
  rope_skipping: "跳绳",
  elliptical: "椭圆机",
});

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

function toNum(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function typeLabel(type) {
  if (!type) return "运动";
  const key = String(type).toLowerCase();
  return TYPE_LABEL[key] || type;
}

function mapWorkout(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.workoutId || raw.workout_id || raw.id || raw.logId || raw._id;
  if (id == null) return null;
  // distance may arrive in meters or kilometers; meter field wins, else km*1000.
  let meters = toNum(
    raw.distanceMeters != null ? raw.distanceMeters
    : raw.meter != null ? raw.meter
    : raw.distance,
  );
  if (meters != null && meters > 0 && meters < 1000 && raw.distanceMeters == null && raw.meter == null) {
    meters = meters * 1000; // looked like kilometers
  }
  return {
    workoutId: String(id),
    type: raw.type || raw.workoutType || raw.subtype || raw.trainingType || null,
    name: raw.name || raw.workoutName || raw.title || raw.planName || null,
    timeMs: parseTime(raw.time || raw.doneDate || raw.endTime || raw.startTime || raw.createTime || raw.date),
    distanceMeters: meters,
    durationSec: toNum(
      raw.durationSec != null ? raw.durationSec
      : raw.duration != null ? raw.duration
      : raw.trainingDuration != null ? raw.trainingDuration
      : raw.second,
    ),
    calories: toNum(raw.calories != null ? raw.calories : raw.kcal != null ? raw.kcal : raw.calorie),
    steps: toNum(raw.steps != null ? raw.steps : raw.stepCount),
  };
}

function extractList(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.records)) return d.records;
    if (Array.isArray(d.logs)) return d.logs;
    if (Array.isArray(d.workouts)) return d.workouts;
  }
  return [];
}

function stableOriginalId(id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `keep:workout:${safe}`;
}

class KeepAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies ? new CookieAuth({ platform: "keep", cookies: opts.account.cookies }) : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider = typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._listUrl = typeof opts.listUrl === "string" && opts.listUrl.length > 0 ? opts.listUrl : null;
    this._liveConfigured = Boolean(this._listUrl && typeof opts.fetchFn === "function");

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
      "parse:keep-workout",
    ];
    this.extractMode = this._liveConfigured ? "web-api" : "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: ["keep:workout (type / distance / duration / calories / steps — outdoor carries GPS route)"],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { workout: true },
    };
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      try {
        this._deps.fs.accessSync(ctx.inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return { ok: false, reason: "INPUT_PATH_UNREADABLE", message: `snapshot not readable at ${ctx.inputPath}: ${err.message}` };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth && !this._liveConfigured) {
      return {
        ok: false,
        reason: "EXPLICIT_ENDPOINT_REQUIRED",
        message: "fitness-keep: cookie collection requires captured listUrl and fetchFn; snapshot import is ready",
      };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      return { ok: true, account: (this.account && this.account.userId) || null, mode: "cookie", unverified: true };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message: "fitness-keep.authenticate: needs opts.inputPath; custom live mode also requires cookies, listUrl, and fetchFn",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok ? { ok: true, lastChecked: Date.now(), unverified: true } : { ok: false, reason: r.reason, error: r.error };
    }
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (this._cookieAuth && this._liveConfigured) {
      yield* this._syncViaCookie(opts);
      return;
    }
    if (this._cookieAuth) {
      throw new Error("fitness-keep.sync: explicit listUrl and fetchFn required for custom cookie collection");
    }
    throw new Error("fitness-keep.sync: needs opts.inputPath (snapshot mode)");
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`fitness-keep.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`);
    }
    const fallback =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0 ? Math.floor(snapshot.snapshottedAt) : Date.now();
    const account = snapshot.account && typeof snapshot.account === "object" ? snapshot.account : null;
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object" || !VALID_SNAPSHOT_KINDS.includes(ev.kind)) continue;
      if (include[ev.kind] === false) continue;
      const rec = mapWorkout(ev);
      if (!rec) continue;
      const capturedAt = parseTime(ev.capturedAt) || rec.timeMs || fallback;
      yield {
        adapter: NAME,
        kind: KIND_WORKOUT,
        originalId: stableOriginalId(rec.workoutId),
        capturedAt,
        payload: { record: rec, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const include = opts.include || {};
    if (include[KIND_WORKOUT] === false) return;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    let emitted = 0;
    let page = 1;
    while (page <= maxPages) {
      const query = { page, pageSize: PAGE_SIZE };
      let sign = null;
      if (this._signProvider) sign = await this._signProvider({ url: this._listUrl, query, cookies });
      const resp = await this._fetchFn({ url: this._listUrl, cookies, query, sign });
      const items = extractList(resp);
      if (!items.length) break;
      for (const it of items) {
        const rec = mapWorkout(it);
        if (!rec) continue;
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_WORKOUT,
          originalId: stableOriginalId(rec.workoutId),
          capturedAt: rec.timeMs || Date.now(),
          payload: { record: rec, cookie: true },
        };
        emitted += 1;
      }
      if (items.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("KeepAdapter.normalize: payload.record missing");
    }
    const rec = raw.payload.record;
    const ingestedAt = Date.now();
    const occurredAt = rec.timeMs || raw.capturedAt || ingestedAt;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt || occurredAt,
      capturedBy: CAPTURED_BY.API,
    };
    const label = typeLabel(rec.type);
    const km = rec.distanceMeters != null && rec.distanceMeters > 0 ? (rec.distanceMeters / 1000).toFixed(2) : null;
    const minutes = rec.durationSec != null && rec.durationSec > 0 ? Math.round(rec.durationSec / 60) : null;
    let title;
    if (km != null) title = `运动: ${label} ${km} km`;
    else if (minutes != null) title = `运动: ${label} ${minutes} 分钟`;
    else title = `运动: ${label}`;
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.OTHER,
          occurredAt,
          actor: "person-self",
          content: { title, text: rec.name || label },
          ingestedAt,
          source,
          extra: {
            platform: "keep",
            kind: KIND_WORKOUT,
            workoutType: rec.type || null,
            workoutName: rec.name || null,
            distanceMeters: rec.distanceMeters,
            durationSec: rec.durationSec,
            calories: rec.calories,
            steps: rec.steps,
          },
        },
      ],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

async function defaultFetch(_opts) {
  throw new Error("fitness-keep: no fetchFn configured for cookie-api mode");
}

module.exports = {
  KeepAdapter,
  mapWorkout,
  extractList,
  toNum,
  typeLabel,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
