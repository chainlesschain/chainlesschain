/**
 * Douyin usage-profile reader tests (real-device-driven 2026-06-18: the user's
 * exported 1128_feature_engineering.db has FEInternalUserActivityTable = 81
 * rows ≈ 24 days, 175 opens, ~108h, peak 12-17h).
 *
 * Two layers:
 *  - pure aggregation via an injected fake Database (no native driver needed);
 *  - a real better-sqlite3 db + real LocalVault round-trip proving the
 *    hand-built event passes schema validation, is searchable, and re-ingest
 *    dedups on the stable originalId.
 */
"use strict";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { LocalVault } = require("../../lib/vault");
const { generateKeyHex } = require("../../lib/key-providers");
const {
  USAGE_TABLE,
  readDouyinUsageProfile,
  summarizeUsageProfile,
  buildUsageProfileEvents,
  usageProfileToVault,
  _internals,
} = require("../../lib/adapters/social-douyin-adb/usage-profile-reader");

// ── pure aggregation with an injected fake Database ───────────────────
function makeFakeDb(rows, { table = USAGE_TABLE } = {}) {
  const cols = [
    "id",
    "timestamp",
    "open_app_count",
    "total_duration",
    ...Array.from({ length: 24 }, (_v, h) => `launch_hour_${h}`),
  ];
  return class FakeDb {
    constructor() {}
    prepare(sql) {
      return {
        get: (arg) => {
          if (/sqlite_master/.test(sql)) {
            return arg === table ? { name: table } : undefined;
          }
          return undefined;
        },
        all: () => {
          if (/table_info/.test(sql)) return cols.map((name) => ({ name }));
          if (/FROM "/.test(sql)) return rows;
          return [];
        },
      };
    }
    close() {}
  };
}

function row({ ts, opens = 1, durMs = 0, hours = {} }) {
  const r = { id: 1, timestamp: ts, open_app_count: opens, total_duration: durMs };
  for (let h = 0; h < 24; h++) r[`launch_hour_${h}`] = hours[h] || 0;
  return r;
}

const DAY = 86_400_000;

describe("readDouyinUsageProfile (injected fake db)", () => {
  it("aggregates opens, duration, hour histogram, peak hour + bucket, distinct days", () => {
    const base = Math.floor(1781000000000 / 1000); // seconds epoch
    const Db = makeFakeDb([
      row({ ts: base, opens: 2, durMs: 3_600_000, hours: { 13: 3, 9: 1 } }),
      row({ ts: base + 86_400, opens: 1, durMs: 1_800_000, hours: { 14: 2, 20: 1 } }),
    ]);
    const p = readDouyinUsageProfile("x.db", { _databaseClass: Db });
    expect(p.sessions).toBe(2);
    expect(p.days).toBe(2);
    expect(p.totalOpens).toBe(3);
    expect(p.totalDurationMs).toBe(5_400_000);
    expect(p.hourHistogram[13]).toBe(3);
    expect(p.hourHistogram[14]).toBe(2);
    expect(p.peakHour).toBe(13); // 3 launches is the single max hour
    expect(p.peakBucket).toBe("12-17h"); // 13+14 = 5 dominates
    expect(p.bucketTotals["12-17h"]).toBe(5);
    expect(p.bucketTotals["18-23h"]).toBe(1);
    expect(p.from).toBe(base * 1000);
    expect(p.to).toBe((base + 86_400) * 1000);
  });

  it("returns an empty profile when the table is absent", () => {
    const Db = makeFakeDb([], { table: "SomeOtherTable" });
    const p = readDouyinUsageProfile("x.db", { _databaseClass: Db });
    expect(p.sessions).toBe(0);
    expect(p.peakBucket).toBe(null);
    expect(p.hourHistogram).toHaveLength(24);
    expect(p.totalDurationMs).toBe(0);
  });

  it("counts the same calendar day once even across multiple sessions", () => {
    const base = Math.floor(1781000000000 / 1000);
    const Db = makeFakeDb([
      row({ ts: base, hours: { 10: 1 } }),
      row({ ts: base + 3600, hours: { 11: 1 } }), // same UTC day
    ]);
    const p = readDouyinUsageProfile("x.db", { _databaseClass: Db });
    expect(p.days).toBe(1);
    expect(p.sessions).toBe(2);
  });

  it("toEpochMs treats >1e12 as ms else seconds; rejects junk", () => {
    expect(_internals.toEpochMs(1781000000)).toBe(1781000000000);
    expect(_internals.toEpochMs(1781000000000)).toBe(1781000000000);
    expect(_internals.toEpochMs(0)).toBe(null);
    expect(_internals.toEpochMs("nope")).toBe(null);
  });
});

describe("summarizeUsageProfile + buildUsageProfileEvents", () => {
  it("summary is empty-safe and renders hours + peak", () => {
    expect(summarizeUsageProfile(null)).toMatch(/无数据/);
    expect(summarizeUsageProfile({ sessions: 0 })).toMatch(/无数据/);
    const txt = summarizeUsageProfile({
      sessions: 81,
      days: 24,
      totalOpens: 175,
      totalDurationMs: 388_440_000, // 107.9h
      peakBucket: "12-17h",
    });
    expect(txt).toMatch(/24 天/);
    expect(txt).toMatch(/175 次启动/);
    expect(txt).toMatch(/107\.9 小时/);
    expect(txt).toMatch(/12-17h/);
  });

  it("builds no events for an empty profile", () => {
    expect(buildUsageProfileEvents({ sessions: 0 }).events).toHaveLength(0);
    expect(buildUsageProfileEvents(null).events).toHaveLength(0);
  });

  it("builds one app-usage-profile event with stable originalId + histogram in extra", () => {
    const profile = {
      sessions: 81, days: 24, from: 1, to: 1781800000000,
      totalOpens: 175, totalDurationMs: 388_440_000,
      hourHistogram: new Array(24).fill(0), peakHour: 13, peakBucket: "12-17h",
      bucketTotals: { "0-5h": 1, "6-11h": 81, "12-17h": 107, "18-23h": 75 },
    };
    const { events } = buildUsageProfileEvents(profile, { now: 1781900000000 });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.subtype).toBe("other");
    expect(e.source.adapter).toBe("social-douyin");
    expect(e.source.originalId).toBe("social-douyin:usage-profile");
    expect(e.source.capturedBy).toBe("sqlite");
    expect(e.occurredAt).toBe(1781800000000); // profile.to
    expect(e.extra.kind).toBe("app-usage-profile");
    expect(e.extra.peakBucket).toBe("12-17h");
    expect(e.extra.bucketTotals["12-17h"]).toBe(107);
    expect(Array.isArray(e.extra.hourHistogram)).toBe(true);
  });
});

// ── real db + real vault round-trip (schema validation + dedup) ───────
describe("usageProfileToVault — real sqlite + real vault", () => {
  let dir, dbPath, vdir, vault;

  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-usage-"));
    dbPath = path.join(dir, "1128_feature_engineering.db");
    const db = new Database(dbPath);
    const hourCols = Array.from({ length: 24 }, (_v, h) => `launch_hour_${h} INTEGER`).join(", ");
    db.exec(
      `CREATE TABLE "${USAGE_TABLE}" (id INTEGER, timestamp INTEGER, ` +
        `start_timestamp_ms INTEGER, end_timestamp_ms INTEGER, ` +
        `open_app_count INTEGER, ${hourCols}, total_duration INTEGER)`,
    );
    const hzero = Array.from({ length: 24 }, () => 0);
    const insCols = ["id", "timestamp", "start_timestamp_ms", "end_timestamp_ms", "open_app_count",
      ...Array.from({ length: 24 }, (_v, h) => `launch_hour_${h}`), "total_duration"];
    const ph = insCols.map(() => "?").join(",");
    const ins = db.prepare(`INSERT INTO "${USAGE_TABLE}" (${insCols.join(",")}) VALUES (${ph})`);
    const baseSec = Math.floor(1781000000000 / 1000);
    // two sessions on two different days; 13h is the peak hour
    const h1 = [...hzero]; h1[13] = 3; h1[9] = 1;
    const h2 = [...hzero]; h2[14] = 2;
    ins.run(1, baseSec, baseSec * 1000, baseSec * 1000 + 1000, 2, ...h1, 3_600_000);
    ins.run(2, baseSec + 86_400, 0, 0, 1, ...h2, 1_800_000);
    db.close();

    vdir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-usage-vault-"));
    vault = new LocalVault({ path: path.join(vdir, "v.db"), key: generateKeyHex() });
    vault.open();
  });

  afterAll(() => {
    try { vault.close(); } catch (_e) { /* best-effort */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  });

  it("reads the real table, aggregates, and ingests one valid event", () => {
    const profile = readDouyinUsageProfile(dbPath, {});
    expect(profile.sessions).toBe(2);
    expect(profile.days).toBe(2);
    expect(profile.peakHour).toBe(13);
    expect(profile.peakBucket).toBe("12-17h");

    const r = usageProfileToVault(vault, dbPath, { now: 1781900000000 });
    expect(r.ingested).toBe(1); // proves the hand-built event passed schema validation
    expect(r.sessions).toBe(2);

    const events = vault.queryEvents({ limit: 100 }) || [];
    const mine = events.filter(
      (e) => e.extra && e.extra.kind === "app-usage-profile",
    );
    expect(mine.length).toBe(1);
    expect(mine[0].source.adapter).toBe("social-douyin");
  });

  it("re-ingest dedups on the stable originalId (no duplicate baseline)", () => {
    usageProfileToVault(vault, dbPath, { now: 1781999999999 });
    const events = vault.queryEvents({ limit: 100 }) || [];
    const mine = events.filter(
      (e) => e.extra && e.extra.kind === "app-usage-profile",
    );
    expect(mine.length).toBe(1); // still one — updated, not duplicated
  });
});
