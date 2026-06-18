/**
 * Douyin on-device usage-profile reader — recovers the user's app-usage
 * baseline (active hours / session count / total time-on-app) from the local
 * `1128_feature_engineering.db` table `FEInternalUserActivityTable`, a plaintext
 * SQLite table the app keeps for its own client-side feature store.
 *
 * Why this exists (real-device 2026-06-18, user's exported plaintext DB):
 *   - `FEInternalUserActivityTable` rows are per-session aggregates:
 *       { timestamp(sec), start/end_timestamp_ms, open_app_count,
 *         launch_hour_0..23, total_duration(ms) }
 *   - 81 rows spanning ~31 days = "how the user uses Douyin": ~175 opens,
 *     ~108 hours total, peak 12–17h. This behavioral baseline is exactly what a
 *     personal-AI should know, and it's plaintext (no signing/encryption).
 *
 * This module is the testable core (reader + pure summarizer + vault-event
 * builder). The device pull/collector wiring (mirroring watch-history-reader's
 * pullVideoRecordDbViaSu) is a follow-up; the remote db sub-path must be
 * confirmed on a device first.
 *
 * Authorization: only on your own device/account.
 */
"use strict";

const { newId } = require("../../ids");
const {
  _internals: { loadDatabaseClass },
} = require("../social-bilibili-adb/chromium-cookies-reader");

const USAGE_TABLE = "FEInternalUserActivityTable";
const PROFILE_VERSION = "usage-profile-0.1";
const HOUR_BUCKETS = Object.freeze([
  { label: "0-5h", from: 0, to: 5 },
  { label: "6-11h", from: 6, to: 11 },
  { label: "12-17h", from: 12, to: 17 },
  { label: "18-23h", from: 18, to: 23 },
]);

/** seconds-or-ms epoch → ms (heuristic: > 1e12 ⇒ already ms). */
function toEpochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

/**
 * Read per-session usage rows from FEInternalUserActivityTable and aggregate
 * them into a usage profile. Pure once a Database class is injected.
 *
 * @returns {{
 *   sessions: number, days: number, from: number|null, to: number|null,
 *   totalOpens: number, totalDurationMs: number,
 *   hourHistogram: number[], peakHour: number|null,
 *   peakBucket: string|null, bucketTotals: Record<string,number>
 * }}
 */
function readDouyinUsageProfile(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const db = new Database(dbPath, { readonly: true });
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(USAGE_TABLE);
    if (!exists) return emptyProfile();

    const cols = new Set(
      db.prepare(`PRAGMA table_info("${USAGE_TABLE}")`).all().map((c) => c.name),
    );
    const hourCols = [];
    for (let h = 0; h < 24; h++) {
      hourCols.push(cols.has(`launch_hour_${h}`) ? `launch_hour_${h}` : null);
    }
    const hasOpen = cols.has("open_app_count");
    const hasDur = cols.has("total_duration");
    const hasTs = cols.has("timestamp");

    const rows = db.prepare(`SELECT * FROM "${USAGE_TABLE}"`).all();
    const histogram = new Array(24).fill(0);
    const days = new Set();
    let totalOpens = 0;
    let totalDurationMs = 0;
    let from = null;
    let to = null;

    for (const r of rows) {
      if (hasOpen) totalOpens += Number(r.open_app_count) || 0;
      if (hasDur) totalDurationMs += Number(r.total_duration) || 0;
      for (let h = 0; h < 24; h++) {
        if (hourCols[h]) histogram[h] += Number(r[hourCols[h]]) || 0;
      }
      const tsMs = hasTs ? toEpochMs(r.timestamp) : null;
      if (tsMs != null) {
        if (from == null || tsMs < from) from = tsMs;
        if (to == null || tsMs > to) to = tsMs;
        // local-day bucket (UTC day is fine for a coarse "distinct days" count)
        days.add(Math.floor(tsMs / 86_400_000));
      }
    }

    let peakHour = null;
    let peakVal = -1;
    for (let h = 0; h < 24; h++) {
      if (histogram[h] > peakVal) {
        peakVal = histogram[h];
        peakHour = h;
      }
    }
    if (peakVal <= 0) peakHour = null;

    const bucketTotals = {};
    let peakBucket = null;
    let peakBucketVal = -1;
    for (const b of HOUR_BUCKETS) {
      let sum = 0;
      for (let h = b.from; h <= b.to; h++) sum += histogram[h];
      bucketTotals[b.label] = sum;
      if (sum > peakBucketVal) {
        peakBucketVal = sum;
        peakBucket = b.label;
      }
    }
    if (peakBucketVal <= 0) peakBucket = null;

    return {
      sessions: rows.length,
      days: days.size,
      from,
      to,
      totalOpens,
      totalDurationMs,
      hourHistogram: histogram,
      peakHour,
      peakBucket,
      bucketTotals,
    };
  } finally {
    try {
      db.close();
    } catch (_e) {
      /* best-effort */
    }
  }
}

function emptyProfile() {
  const bucketTotals = {};
  for (const b of HOUR_BUCKETS) bucketTotals[b.label] = 0;
  return {
    sessions: 0,
    days: 0,
    from: null,
    to: null,
    totalOpens: 0,
    totalDurationMs: 0,
    hourHistogram: new Array(24).fill(0),
    peakHour: null,
    peakBucket: null,
    bucketTotals,
  };
}

/** Human-readable one-line summary of a usage profile (pure). */
function summarizeUsageProfile(profile) {
  if (!profile || profile.sessions === 0) return "抖音使用画像：无数据";
  const hours = Math.round((profile.totalDurationMs / 3_600_000) * 10) / 10;
  const peak = profile.peakBucket ? `，高峰时段 ${profile.peakBucket}` : "";
  return (
    `抖音使用画像：${profile.days} 天内 ${profile.sessions} 个会话、` +
    `${profile.totalOpens} 次启动、累计约 ${hours} 小时${peak}`
  );
}

/**
 * Build a single rolling "app-usage baseline" vault event from a profile.
 * Stable originalId → re-ingest UPDATES rather than duplicates. Tagged
 * `extra.kind = "app-usage-profile"` so analysis.timeline can exclude it (it's
 * a baseline, not a timeline activity) while overview/interests can use it.
 *
 * @returns {{events: object[]}}
 */
function buildUsageProfileEvents(profile, opts = {}) {
  if (!profile || profile.sessions === 0) return { events: [] };
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const occurredAt = Number.isFinite(profile.to) ? profile.to : now;
  const text = summarizeUsageProfile(profile);
  const event = {
    id: newId(),
    type: "event",
    subtype: "other",
    occurredAt,
    actor: "person-self",
    content: { title: text, text },
    ingestedAt: now,
    source: {
      adapter: "social-douyin",
      adapterVersion: PROFILE_VERSION,
      originalId: "social-douyin:usage-profile",
      capturedAt: occurredAt,
      capturedBy: "sqlite",
    },
    extra: {
      platform: "douyin",
      kind: "app-usage-profile",
      days: profile.days,
      sessions: profile.sessions,
      totalOpens: profile.totalOpens,
      totalDurationMs: profile.totalDurationMs,
      hourHistogram: profile.hourHistogram,
      peakHour: profile.peakHour,
      peakBucket: profile.peakBucket,
      bucketTotals: profile.bucketTotals,
      rangeFrom: profile.from,
      rangeTo: profile.to,
    },
  };
  return { events: [event] };
}

/**
 * Read a feature-engineering db and write the usage-profile baseline event into
 * the vault. Returns counts.
 *
 * @param {object} vault LocalVault (must expose putBatch)
 * @param {string} dbPath path to 1128_feature_engineering.db
 */
function usageProfileToVault(vault, dbPath, opts = {}) {
  if (!vault || typeof vault.putBatch !== "function") {
    throw new TypeError("usageProfileToVault: vault with putBatch required");
  }
  if (typeof dbPath !== "string" || !dbPath) {
    throw new TypeError("usageProfileToVault: dbPath required");
  }
  const profile = readDouyinUsageProfile(dbPath, opts);
  const built = buildUsageProfileEvents(profile, opts);
  const res = built.events.length
    ? vault.putBatch({ events: built.events })
    : { events: 0 };
  return {
    ingested: res.events || 0,
    sessions: profile.sessions,
    days: profile.days,
    summary: summarizeUsageProfile(profile),
  };
}

module.exports = {
  USAGE_TABLE,
  HOUR_BUCKETS,
  readDouyinUsageProfile,
  summarizeUsageProfile,
  buildUsageProfileEvents,
  usageProfileToVault,
  _internals: { toEpochMs, emptyProfile },
};
