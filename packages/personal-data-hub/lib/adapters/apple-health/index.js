"use strict";

/**
 * Apple Health adapter — file-import of the standard HealthKit `export.xml`.
 *
 * This is the MOST reliable health source: the user exports their own data
 * from the iOS 健康 app ("头像 → 导出所有健康数据" → a zip containing
 * `export.xml`), unzips, and points the adapter at the XML. The format is a
 * stable, documented HealthKit schema — no device hacking, no decryption, no
 * signing. Pure file-import (like local-files / git-activity).
 *
 * `export.xml` shape:
 *   <HealthData ...>
 *     <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone"
 *             unit="count" startDate="2024-01-15 08:30:00 +0800"
 *             endDate="..." value="123"/>
 *     <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleep" .../>
 *     <Workout workoutActivityType="HKWorkoutActivityTypeRunning"
 *              duration="30" durationUnit="min" totalDistance="5"
 *              totalDistanceUnit="km" startDate="..." endDate="..."/>
 *     ...
 *   </HealthData>
 *
 * Each Record/Workout is one line in practice, so we parse line-by-line and
 * pull attributes with a small regex — robust against attribute reordering
 * and avoids a heavy XML dependency. `export.xml` can be large (100s of MB);
 * v1 reads the whole file with a `maxRecords` cap. (A streaming reader is a
 * later optimization; flagged via diagnostic when the cap truncates.)
 *
 * Metrics → EVENT subtype "other" (extra carries metric/value/unit).
 * Workouts → EVENT subtype "trip" (a bounded activity with duration/distance).
 */

const fs = require("node:fs");
const { newId } = require("../../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../../constants");

const NAME = "apple-health";
const VERSION = "0.1.0";

const KIND_RECORD = "record";
const KIND_WORKOUT = "workout";

// Whitelist of high-value metric types → short label. Anything not listed is
// still ingested (label = the raw type minus the HK prefix) so the user never
// silently loses a metric; the whitelist just gives nice names for the common
// ones. null value = skip (too noisy / not useful for a personal profile).
const METRIC_LABELS = Object.freeze({
  HKQuantityTypeIdentifierStepCount: "步数",
  HKQuantityTypeIdentifierDistanceWalkingRunning: "步行跑步距离",
  HKQuantityTypeIdentifierFlightsClimbed: "爬楼层数",
  HKQuantityTypeIdentifierActiveEnergyBurned: "活动能量",
  HKQuantityTypeIdentifierBasalEnergyBurned: "静息能量",
  HKQuantityTypeIdentifierHeartRate: "心率",
  HKQuantityTypeIdentifierRestingHeartRate: "静息心率",
  HKQuantityTypeIdentifierBodyMass: "体重",
  HKQuantityTypeIdentifierHeight: "身高",
  HKCategoryTypeIdentifierSleepAnalysis: "睡眠",
  HKQuantityTypeIdentifierOxygenSaturation: "血氧",
  HKQuantityTypeIdentifierBodyMassIndex: "BMI",
  HKQuantityTypeIdentifierDietaryWater: "饮水",
});

function metricLabel(type) {
  if (METRIC_LABELS[type]) return METRIC_LABELS[type];
  if (typeof type !== "string") return "未知指标";
  return type
    .replace(/^HKQuantityTypeIdentifier/, "")
    .replace(/^HKCategoryTypeIdentifier/, "")
    .replace(/^HK/, "");
}

function parseAttrs(line) {
  const attrs = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function parseAppleDate(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function stableOriginalId(kind, parts) {
  const safe = parts.filter(Boolean).join("|") || `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `apple-health:${kind}:${safe}`;
}

class AppleHealthAdapter {
  constructor(opts = {}) {
    this._inputPath = opts.inputPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:file-import",
      "parse:healthkit-record",
      "parse:healthkit-workout",
    ];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "apple-health:records (步数 / 心率 / 睡眠 / 体重 / 距离 / 能量 …)",
        "apple-health:workouts (运动类型 / 时长 / 距离 / 能量)",
      ],
      sensitivity: "high",
      legalGate: false,
    };

    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && ctx.readinessOnly) {
      return {
        ok: false,
        reason: "NO_FILE",
        message:
          "apple-health: 从 iOS 健康 App 导出 export.xml 后，选择该文件即可采集",
      };
    }
    const inputPath = (ctx && ctx.inputPath) || this._inputPath;
    if (inputPath) {
      try {
        this._deps.fs.accessSync(inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `apple-health: export.xml not readable at ${inputPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "file-import" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message: "apple-health.authenticate: needs opts.inputPath (export.xml)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const inputPath = opts.inputPath || this._inputPath;
    if (!inputPath) {
      throw new Error("apple-health.sync: needs opts.inputPath (export.xml)");
    }
    if (!this._deps.fs.existsSync(inputPath)) return;

    const maxRecords =
      Number.isInteger(opts.maxRecords) && opts.maxRecords > 0 ? opts.maxRecords : 200_000;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const include = opts.include || {};

    const content = this._deps.fs.readFileSync(inputPath, "utf-8");
    const lines = content.split("\n");
    let emitted = 0;
    let seen = 0;
    let truncated = false;

    for (const line of lines) {
      if (emitted >= limit) break;
      const trimmed = line.trimStart();
      const isRecord = trimmed.startsWith("<Record ");
      const isWorkout = trimmed.startsWith("<Workout ");
      if (!isRecord && !isWorkout) continue;
      seen += 1;
      if (seen > maxRecords) {
        truncated = true;
        break;
      }
      const attrs = parseAttrs(trimmed);

      if (isRecord && include[KIND_RECORD] !== false) {
        const occurredAt =
          parseAppleDate(attrs.startDate) || parseAppleDate(attrs.creationDate);
        yield {
          adapter: NAME,
          kind: KIND_RECORD,
          originalId: stableOriginalId(KIND_RECORD, [
            attrs.type,
            attrs.startDate,
            attrs.value,
          ]),
          capturedAt: occurredAt || Date.now(),
          payload: { kind: KIND_RECORD, ...attrs },
        };
        emitted += 1;
      } else if (isWorkout && include[KIND_WORKOUT] !== false) {
        const occurredAt =
          parseAppleDate(attrs.startDate) || parseAppleDate(attrs.creationDate);
        yield {
          adapter: NAME,
          kind: KIND_WORKOUT,
          originalId: stableOriginalId(KIND_WORKOUT, [
            attrs.workoutActivityType,
            attrs.startDate,
            attrs.duration,
          ]),
          capturedAt: occurredAt || Date.now(),
          payload: { kind: KIND_WORKOUT, ...attrs },
        };
        emitted += 1;
      }
    }

    if (truncated && typeof opts.onProgress === "function") {
      try {
        opts.onProgress({
          phase: "truncated",
          adapter: NAME,
          maxRecords,
          message: `export.xml 超过 ${maxRecords} 条，已截断（提高 maxRecords 可全量导入）`,
        });
      } catch (_e) { /* best-effort */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("AppleHealthAdapter.normalize: payload missing");
    }
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_RECORD) return normalizeRecord(raw.payload, raw, ingestedAt);
    if (kind === KIND_WORKOUT) return normalizeWorkout(raw.payload, raw, ingestedAt);
    throw new Error(`AppleHealthAdapter.normalize: unknown kind ${kind}`);
  }
}

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.EXPORT,
  };
}

function normalizeRecord(p, raw, ingestedAt) {
  const occurredAt =
    parseAppleDate(p.startDate) || parseAppleDate(p.creationDate) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const label = metricLabel(p.type);
  const value = p.value != null ? p.value : "";
  const unit = p.unit || "";
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.OTHER,
      occurredAt,
      actor: "person-self",
      content: {
        title: `${label}: ${value}${unit ? " " + unit : ""}`.trim(),
        text: `${label} ${value} ${unit}`.trim(),
      },
      ingestedAt,
      source,
      extra: {
        platform: "apple-health",
        category: "health",
        metric: p.type || null,
        metricLabel: label,
        value: value || null,
        unit: unit || null,
        sourceName: p.sourceName || null,
        endDate: parseAppleDate(p.endDate),
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeWorkout(p, raw, ingestedAt) {
  const occurredAt =
    parseAppleDate(p.startDate) || parseAppleDate(p.creationDate) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const activity =
    typeof p.workoutActivityType === "string"
      ? p.workoutActivityType.replace(/^HKWorkoutActivityType/, "")
      : "Workout";
  const duration = p.duration ? `${p.duration}${p.durationUnit || ""}` : "";
  const distance = p.totalDistance ? `${p.totalDistance}${p.totalDistanceUnit || ""}` : "";
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.TRIP,
      occurredAt,
      actor: "person-self",
      content: {
        title: `运动: ${activity}${duration ? " " + duration : ""}${distance ? " " + distance : ""}`.trim(),
        text: `${activity} ${duration} ${distance}`.trim(),
      },
      ingestedAt,
      source,
      extra: {
        platform: "apple-health",
        category: "workout",
        activityType: activity,
        duration: p.duration || null,
        durationUnit: p.durationUnit || null,
        totalDistance: p.totalDistance || null,
        totalDistanceUnit: p.totalDistanceUnit || null,
        totalEnergyBurned: p.totalEnergyBurned || null,
        endDate: parseAppleDate(p.endDate),
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

module.exports = {
  AppleHealthAdapter,
  NAME,
  VERSION,
  _internals: { parseAttrs, parseAppleDate, metricLabel },
};
