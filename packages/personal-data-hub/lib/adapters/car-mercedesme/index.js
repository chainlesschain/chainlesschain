/**
 * §12.1 Phase 13+ — 奔驰 Mercedes me (com.daimler.ris.mercedesme.cn.android)
 * adapter, "车辆行程". Device-discovered gap (2026-06-15), new `car-` category
 * (own-vehicle telematics, distinct from ride-hailing travel-didi).
 *
 * Mercedes me uses OAuth over a proprietary OEM API. JSON file import is
 * supported; no endpoint is selected by default. The custom live seam is
 * enabled only with a caller-supplied URL and fetchFn. Each trip maps
 * onto the vendor-neutral car TravelRecord (travel-base). sensitivity:"medium"
 * (trip start/end addresses = location history).
 *
 * Snapshot/file shape (JSON array or {trips:[...]}):
 *   { "tripId":"...", "startTime":<s|ms>, "endTime":<s|ms>, "startAddress":"...",
 *     "endAddress":"...", "distanceKm":12.4, "durationSec":1400, "plate":"..." }
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  normalizeTravelRecord,
  parseChineseDateTime,
} = require("../travel-base");
const { CookieAuth } = require("../shopping-base");

const NAME = "car-mercedesme";
const VERSION = "0.2.0";

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 10;

function toMs(n) {
  return n >= 1e12 ? n : n >= 1e9 ? n * 1000 : n;
}
function numberOrParse(v) {
  if (Number.isFinite(v)) return toMs(v);
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return toMs(parseInt(v, 10));
    return parseChineseDateTime(v);
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

function tripToRecord(t, opts = {}) {
  if (!t || typeof t !== "object") return null;
  const recordId = t.tripId || t.trip_id || t.id || t.tripID;
  if (!recordId) return null;
  let distanceKm = toNum(t.distanceKm != null ? t.distanceKm : t.distance_km);
  if (distanceKm == null) {
    const meters = toNum(
      t.distanceMeters != null
        ? t.distanceMeters
        : t.distance_m != null
          ? t.distance_m
          : t.distance,
    );
    if (meters != null) distanceKm = meters / 1000;
  }
  const fromAddr =
    t.startAddress || t.start_address || t.fromAddress || t.startLocation;
  const toAddr = t.endAddress || t.end_address || t.toAddress || t.endLocation;
  return {
    vendorId: "mercedesme",
    recordId: String(recordId),
    vehicleType: "car",
    from: fromAddr ? { name: fromAddr } : null,
    to: toAddr ? { name: toAddr } : null,
    departureMs: numberOrParse(t.startTime || t.start_time || t.beginTime),
    arrivalMs: numberOrParse(t.endTime || t.end_time || t.finishTime),
    carrier: "Mercedes me",
    vehicleNumber: t.plate || t.licensePlate || t.fin || t.vin || null,
    totalCost: null,
    traveler: null,
    confirmationCode: null,
    bookedAt: numberOrParse(t.startTime || t.start_time),
    extras: {
      type: "car",
      ...(distanceKm != null
        ? { distanceKm: Math.round(distanceKm * 100) / 100 }
        : {}),
      ...(t.durationSec != null ? { durationSec: toNum(t.durationSec) } : {}),
      ...(opts.capturedVia ? { capturedVia: opts.capturedVia } : {}),
    },
  };
}

function parseTrips(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_e) {
    raw = text
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l));
  }
  const trips = Array.isArray(raw) ? raw : raw.trips || raw.list || [];
  return trips.map((t) => tripToRecord(t)).filter(Boolean);
}

function extractTrips(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.trips)) return resp.trips;
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.trips)) return d.trips;
    if (Array.isArray(d.list)) return d.list;
  }
  return [];
}

class MercedesMeAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._dataPath = opts.dataPath || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({
            platform: "mercedesme",
            cookies: opts.account.cookies,
          })
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
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "import:json",
      "sync:snapshot",
      ...(this._liveConfigured ? ["sync:custom-cookie-api"] : []),
      "parse:mercedesme-trips",
    ];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "mercedesme:tripId / startAddress / endAddress / startTime / endTime / distanceKm",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    const filePath = (ctx && ctx.inputPath) || ctx.dataPath || this._dataPath;
    if (filePath) {
      try {
        this._deps.fs.accessSync(filePath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `not readable at ${filePath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth && !this._liveConfigured) {
      return {
        ok: false,
        reason: "EXPLICIT_ENDPOINT_REQUIRED",
        message:
          "car-mercedesme: live collection requires a captured listUrl and fetchFn; JSON import is ready",
      };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok)
        return { ok: false, reason: "INVALID_COOKIE", error: "token missing" };
      return {
        ok: true,
        account: (this.account && this.account.userId) || null,
        mode: "cookie",
        unverified: true,
      };
    }
    return {
      ok: false,
      reason: "NO_FILE",
      message: "Select an exported Mercedes me trip JSON file",
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
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (dataPath) {
      if (!this._deps.fs.existsSync(dataPath)) return;
      const text = this._deps.fs.readFileSync(dataPath, "utf-8");
      let records;
      try {
        records = parseTrips(text);
      } catch (err) {
        throw new Error(`MercedesMeAdapter: parse failed: ${err.message}`);
      }
      for (const r of records) {
        yield {
          adapter: NAME,
          originalId: r.recordId,
          capturedAt: r.departureMs || r.bookedAt || Date.now(),
          payload: { record: r },
        };
      }
      return;
    }
    if (this._cookieAuth && this._liveConfigured) {
      yield* this._syncViaCookie(opts);
      return;
    }
    if (this._cookieAuth) {
      throw new Error(
        "car-mercedesme.sync: explicit listUrl and fetchFn required for custom live collection",
      );
    }
    throw new Error("car-mercedesme.sync: inputPath or dataPath is required");
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : 0;
    const pageSize = Number.isFinite(opts.pageSize)
      ? opts.pageSize
      : DEFAULT_PAGE_SIZE;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    let emitted = 0;
    let page = 1;
    let scanComplete = false;
    while (page <= maxPages) {
      const query = { page, pageSize };
      let sign = null;
      if (this._signProvider)
        sign = await this._signProvider({ url: this._listUrl, query, cookies });
      const resp = await this._fetchFn({
        url: this._listUrl,
        cookies,
        query,
        sign,
      });
      const trips = extractTrips(resp);
      if (!trips.length) break;
      let reachedWatermark = false;
      for (const raw of trips) {
        const rec = tripToRecord(raw, { capturedVia: "cookie-api" });
        if (!rec) continue;
        const ts = rec.departureMs || null;
        if (sinceMs && ts && ts < sinceMs) {
          reachedWatermark = true;
          break;
        }
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          originalId: rec.recordId,
          capturedAt: ts || Date.now(),
          payload: { record: rec },
        };
        emitted += 1;
      }
      if (reachedWatermark || trips.length < pageSize) {
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
      throw new Error(
        "MercedesMeAdapter.normalize: raw.payload.record missing",
      );
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

async function defaultFetch(_opts) {
  throw new Error("car-mercedesme: no fetchFn configured for cookie-api mode");
}

module.exports = {
  MercedesMeAdapter,
  tripToRecord,
  parseTrips,
  extractTrips,
  NAME,
  VERSION,
};
