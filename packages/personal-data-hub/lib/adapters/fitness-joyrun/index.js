/**
 * §12.1 Phase 13+ — 悦跑圈 (Joyrun, co.runner.app) adapter, "跑步记录".
 * Device-discovered gap (2026-06-15), new `fitness-` category.
 *
 * Snapshot import is the supported path. Custom cookie collection is enabled
 * only with an explicit, user-captured listUrl and injected fetchFn; no guessed
 * Joyrun endpoint is selected by default.
 * Running records carry GPS/route info → sensitivity:"medium" (legalGate off,
 * like the travel adapters).
 *
 * One record kind: 跑步记录 (runs):
 *   { runId, time, distanceMeters, durationSec, paceSecPerKm, calories, steps }
 *   → EVENT(OTHER) "跑步 X.XX km".
 *
 * Snapshot schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1, "snapshottedAt": <ms>,
 *     "account": { "userId": "...", "name": "..." },
 *     "events": [
 *       { "kind": "run", "id": "r-<id>", "runId": "...", "time": <s|ms>,
 *         "distanceMeters": 5230, "durationSec": 1800, "paceSecPerKm": 344,
 *         "calories": 320, "steps": 6400 }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { CookieAuth } = require("../shopping-base");

const NAME = "fitness-joyrun";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_RUN = "run";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_RUN]);
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

function toNum(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapRun(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.runId || raw.run_id || raw.id || raw.fid || raw.postRunId;
  if (id == null) return null;
  // distance may arrive in meters or kilometers; meter field wins, else km*1000.
  let meters = toNum(
    raw.distanceMeters != null
      ? raw.distanceMeters
      : raw.meter != null
        ? raw.meter
        : raw.distance,
  );
  if (
    meters != null &&
    meters < 1000 &&
    raw.distanceMeters == null &&
    raw.meter == null
  ) {
    // looked like kilometers
    meters = meters * 1000;
  }
  return {
    runId: String(id),
    timeMs: parseTime(
      raw.time || raw.starttime || raw.start_time || raw.date || raw.utc,
    ),
    distanceMeters: meters,
    durationSec: toNum(
      raw.durationSec != null
        ? raw.durationSec
        : raw.second != null
          ? raw.second
          : raw.totaltime,
    ),
    paceSecPerKm: toNum(raw.paceSecPerKm != null ? raw.paceSecPerKm : raw.pace),
    calories: toNum(
      raw.calories != null
        ? raw.calories
        : raw.cal != null
          ? raw.cal
          : raw.dohas,
    ),
    steps: toNum(raw.steps != null ? raw.steps : raw.stepcount),
  };
}

function extractList(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.runs)) return d.runs;
    if (Array.isArray(d.records)) return d.records;
  }
  return [];
}

function stableOriginalId(id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `joyrun:run:${safe}`;
}

class JoyrunAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "joyrun", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._listUrl =
      typeof opts.listUrl === "string" && opts.listUrl.length > 0
        ? opts.listUrl
        : null;
    this._liveConfigured = Boolean(
      this._listUrl && typeof opts.fetchFn === "function",
    );

    this.name = NAME;
    this.version = VERSION;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.capabilities = [
      "sync:snapshot",
      ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
      "parse:joyrun-run",
    ];
    this.extractMode = this._liveConfigured ? "web-api" : "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "joyrun:run (distance / duration / pace / calories / steps — carries GPS route)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { run: true },
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
    if (this._cookieAuth && !this._liveConfigured) {
      return {
        ok: false,
        reason: "EXPLICIT_ENDPOINT_REQUIRED",
        message:
          "fitness-joyrun: cookie collection requires captured listUrl and fetchFn; snapshot import is ready",
      };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
        unverified: true,
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "fitness-joyrun.authenticate: needs opts.inputPath; custom live mode also requires cookies, listUrl, and fetchFn",
    };
  }

  async healthCheck(opts = {}) {
    if (this._cookieAuth) {
      const r = await this.authenticate(opts);
      return r.ok
        ? { ok: true, lastChecked: Date.now(), unverified: true }
        : { ok: false, reason: r.reason, error: r.error };
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
      throw new Error(
        "fitness-joyrun.sync: explicit listUrl and fetchFn required for custom cookie collection",
      );
    }
    throw new Error(
      "fitness-joyrun.sync: needs opts.inputPath (snapshot mode)",
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
        `fitness-joyrun.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallback =
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
      if (
        !ev ||
        typeof ev !== "object" ||
        !VALID_SNAPSHOT_KINDS.includes(ev.kind)
      )
        continue;
      if (include[ev.kind] === false) continue;
      const rec = mapRun(ev);
      if (!rec) continue;
      const capturedAt = parseTime(ev.capturedAt) || rec.timeMs || fallback;
      yield {
        adapter: NAME,
        kind: KIND_RUN,
        originalId: stableOriginalId(rec.runId),
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
    if (include[KIND_RUN] === false) {
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
      return;
    }
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : 0;

    let emitted = 0;
    let page = 1;
    let scanComplete = false;
    while (page <= maxPages) {
      const query = { page, pageSize: PAGE_SIZE };
      let sign = null;
      if (this._signProvider)
        sign = await this._signProvider({ url: this._listUrl, query, cookies });
      const resp = await this._fetchFn({
        url: this._listUrl,
        cookies,
        query,
        sign,
      });
      const items = extractList(resp);
      if (!items.length) {
        scanComplete = true;
        break;
      }
      let reachedWatermark = false;
      for (const it of items) {
        const rec = mapRun(it);
        if (!rec) continue;
        if (rec.timeMs && rec.timeMs < sinceMs) {
          reachedWatermark = true;
          break;
        }
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          kind: KIND_RUN,
          originalId: stableOriginalId(rec.runId),
          capturedAt: rec.timeMs || Date.now(),
          payload: { record: rec, cookie: true },
        };
        emitted += 1;
      }
      if (reachedWatermark || items.length < PAGE_SIZE) {
        scanComplete = true;
        break;
      }
      page += 1;
    }
    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("JoyrunAdapter.normalize: payload.record missing");
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
    const km =
      rec.distanceMeters != null
        ? (rec.distanceMeters / 1000).toFixed(2)
        : null;
    return {
      events: [
        {
          id: newId(),
          type: ENTITY_TYPES.EVENT,
          subtype: EVENT_SUBTYPES.OTHER,
          occurredAt,
          actor: "person-self",
          content: {
            title: km != null ? `跑步 ${km} km` : "跑步记录",
            text: "跑步记录",
          },
          ingestedAt,
          source,
          extra: {
            platform: "joyrun",
            kind: KIND_RUN,
            distanceMeters: rec.distanceMeters,
            durationSec: rec.durationSec,
            paceSecPerKm: rec.paceSecPerKm,
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
  throw new Error("fitness-joyrun: no fetchFn configured for cookie-api mode");
}

module.exports = {
  JoyrunAdapter,
  mapRun,
  extractList,
  toNum,
  parseTime,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
