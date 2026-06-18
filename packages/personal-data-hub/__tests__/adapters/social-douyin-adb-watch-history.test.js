/**
 * Douyin watch-history local-DB reader + collector tests (real-device-driven
 * 2026-06-11, device 5lhyaqu8lbwstc6x: video_record.db record_<uid> = 900 rows).
 *
 * Validates the plaintext video_record.db path that sidesteps the encrypted IM
 * db + X-Bogus signing. adb + sqlite injected (no device / native driver).
 */
"use strict";

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const {
  createDouyinWatchExtension,
  watchHistoryToVault,
  VIDEO_RECORD_DB_REMOTE_PATH,
  _internals,
} = require("../../lib/adapters/social-douyin-adb/watch-history-reader");
const {
  collectWatchHistory,
} = require("../../lib/adapters/social-douyin-adb/collector");
const { DouyinAdapter } = require("../../lib/adapters/social-douyin");
const { partitionBatch } = require("../../lib/batch");

// ── readDouyinWatchHistory (injected Database) ────────────────────────
function makeFakeDb(tablesToRows) {
  return class FakeDb {
    constructor() {}
    prepare(sql) {
      return {
        all: () => {
          if (/sqlite_master/.test(sql)) {
            return Object.keys(tablesToRows).map((name) => ({ name }));
          }
          const tm = /FROM "([^"]+)"/.exec(sql);
          if (tm && /table_info/.test(sql) === false && /COUNT/.test(sql) === false) {
            return tablesToRows[tm[1]] || [];
          }
          if (/table_info/.test(sql)) {
            return [
              { name: "aid" },
              { name: "view_time_timestamp" },
              { name: "enter_from" },
            ];
          }
          return [];
        },
        get: () => {
          const tm = /FROM "([^"]+)"/.exec(sql);
          if (/COUNT/.test(sql) && tm) return { c: (tablesToRows[tm[1]] || []).length };
          return undefined;
        },
      };
    }
    close() {}
  };
}

describe("readDouyinWatchHistory", () => {
  it("merges record_0 + record_<uid>, attributes uid to the largest uid table, parses rows → ms", () => {
    const Db = makeFakeDb({
      record_0: [{ aid: "xrec0", view_time_timestamp: 1, enter_from: "a" }],
      record_92585448288: [
        { aid: "7480000000000000001", view_time_timestamp: 1717800000, enter_from: "homepage_hot" },
        { aid: "7480000000000000002", view_time_timestamp: 1717800600, enter_from: "homepage_follow" },
      ],
    });
    const r = _internals.readDouyinWatchHistory("x.db", { _databaseClass: Db });
    expect(r.uid).toBe("92585448288");
    // record_0 is no longer dropped: 1 (record_0) + 2 (uid) = 3 merged records.
    expect(r.records).toHaveLength(3);
    // Most-recent first.
    expect(r.records[0]).toEqual({
      awemeId: "7480000000000000002",
      capturedAt: 1717800600 * 1000,
      enterFrom: "homepage_follow",
    });
    const ids = r.records.map((x) => x.awemeId);
    expect(ids).toContain("xrec0"); // the formerly-lost record_0 row
    const rec0 = r.records.find((x) => x.awemeId === "xrec0");
    expect(rec0).toEqual({ awemeId: "xrec0", capturedAt: 1000, enterFrom: "a" });
  });

  it("recovers history from record_0 alone (uid:null) — the bulk-in-record_0 device case", () => {
    const Db = makeFakeDb({
      record_0: [
        { aid: "a1", view_time_timestamp: 1717800000, enter_from: "homepage_hot" },
        { aid: "a2", view_time_timestamp: 1717800600, enter_from: "homepage_hot" },
      ],
    });
    const r = _internals.readDouyinWatchHistory("x.db", { _databaseClass: Db });
    expect(r.uid).toBe(null); // no logged-in account table → no attribution
    expect(r.records).toHaveLength(2); // but the watch history is still recovered
    expect(r.records.map((x) => x.awemeId).sort()).toEqual(["a1", "a2"]);
  });

  it("dedups the same (aid, timestamp) appearing in two record_* tables", () => {
    const Db = makeFakeDb({
      record_0: [{ aid: "dup", view_time_timestamp: 1717800000, enter_from: "homepage_hot" }],
      record_111: [{ aid: "dup", view_time_timestamp: 1717800000, enter_from: "homepage_hot" }],
    });
    const r = _internals.readDouyinWatchHistory("x.db", { _databaseClass: Db });
    expect(r.records).toHaveLength(1);
  });

  it("toEpochMs treats >1e12 as ms, else seconds; rejects junk", () => {
    expect(_internals.toEpochMs(1717800000)).toBe(1717800000000);
    expect(_internals.toEpochMs(1717800000000)).toBe(1717800000000);
    expect(_internals.toEpochMs(0)).toBe(null);
    expect(_internals.toEpochMs("nope")).toBe(null);
  });
});

// ── pullVideoRecordDbViaSu (injected adb) ─────────────────────────────
function makeAdb({ ls, pm, id, b64 }) {
  return async (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("pm list packages")) return pm || "";
    if (cmd.includes("ls ")) return ls;
    if (cmd.includes("id -u")) return id;
    if (cmd.includes("base64 ")) return b64;
    throw new Error("fake adb: unexpected " + cmd);
  };
}

describe("pullVideoRecordDbViaSu — diagnosis", () => {
  it("path constant points at video_record.db", () => {
    expect(VIDEO_RECORD_DB_REMOTE_PATH).toBe(
      "/data/data/com.ss.android.ugc.aweme/databases/video_record.db",
    );
  });

  it("missing db + installed → DOUYIN_VIDEO_RECORD_MISSING", async () => {
    const adb = makeAdb({ ls: "NOT_FOUND\r\n", pm: "package:com.ss.android.ugc.aweme\r\n" });
    await expect(_internals.pullVideoRecordDbViaSu(adb, "s", {})).rejects.toThrow(
      /DOUYIN_VIDEO_RECORD_MISSING/,
    );
  });

  it("missing db + not installed → DOUYIN_NOT_INSTALLED", async () => {
    const adb = makeAdb({ ls: "NOT_FOUND\r\n", pm: "" });
    await expect(_internals.pullVideoRecordDbViaSu(adb, "s", {})).rejects.toThrow(
      /DOUYIN_NOT_INSTALLED/,
    );
  });

  it("non-root → DOUYIN_NO_ROOT", async () => {
    const adb = makeAdb({ ls: VIDEO_RECORD_DB_REMOTE_PATH, id: "2000\r\n" });
    await expect(_internals.pullVideoRecordDbViaSu(adb, "s", {})).rejects.toThrow(/DOUYIN_NO_ROOT/);
  });

  it("non-sqlite payload → DOUYIN_VIDEO_RECORD_NOT_SQLITE", async () => {
    const buf = Buffer.alloc(2048, 0x41);
    const adb = makeAdb({ ls: VIDEO_RECORD_DB_REMOTE_PATH, id: "uid=0(root)", b64: buf.toString("base64") });
    await expect(_internals.pullVideoRecordDbViaSu(adb, "s", {})).rejects.toThrow(
      /DOUYIN_VIDEO_RECORD_NOT_SQLITE/,
    );
  });
});

// ── collectWatchHistory + normalize round-trip ────────────────────────
describe("collectWatchHistory → social-douyin history events", () => {
  it("builds a snapshot of history events; normalize → valid BROWSE batch with enterFrom", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const bridge = {
      invoke: vi.fn(async (m) => {
        if (m === "douyin.watch-history") {
          return {
            uid: "92585448288",
            records: [
              { awemeId: "7480000000000000001", capturedAt: 1717800000000, enterFrom: "homepage_hot" },
              { awemeId: "7480000000000000002", capturedAt: 1717800600000, enterFrom: "homepage_follow" },
            ],
          };
        }
        throw new Error("unknown " + m);
      }),
    };
    const r = await collectWatchHistory(bridge, { stagingDir: os.tmpdir(), now: () => 1717900000000 });
    expect(r.uid).toBe("92585448288");
    expect(r.eventCounts.history).toBe(2);
    // The written snapshot ingests through the real adapter normalize.
    const snap = JSON.parse(fs.readFileSync(r.snapshotPath, "utf-8"));
    try {
      expect(snap.events).toHaveLength(2);
      expect(snap.events[0].kind).toBe("history");
      const a = new DouyinAdapter();
      const batch = a.normalize({
        adapter: "social-douyin",
        kind: "history",
        originalId: "douyin:history:1",
        capturedAt: 1717800000000,
        payload: { ...snap.events[0], account: snap.account },
      });
      expect(partitionBatch(batch).invalidReasons).toHaveLength(0);
      expect(batch.events[0].subtype).toBe("browse");
      expect(batch.events[0].extra.awemeId).toBe("7480000000000000001");
      expect(batch.events[0].extra.enterFrom).toBe("homepage_hot");
    } finally {
      fs.unlinkSync(r.snapshotPath);
    }
  });

  it("throws on malformed bridge payload (no records array)", async () => {
    const bridge = { invoke: vi.fn(async () => ({ uid: "1" })) };
    await expect(collectWatchHistory(bridge, {})).rejects.toThrow(/malformed payload/);
  });
});

describe("createDouyinWatchExtension contract", () => {
  it("rejects when ctx lacks {adb, pickDevice}", async () => {
    await expect(createDouyinWatchExtension()({}, {})).rejects.toThrow(/ctx must provide/);
  });
});

// ── watchHistoryToVault: local-db → canonical BROWSE events → vault ────
describe("watchHistoryToVault — real sqlite + real vault", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { LocalVault } = require("../../lib/vault");
  const { generateKeyHex } = require("../../lib/key-providers");
  let dir, dbPath, vdir, vault;

  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dy-watch-"));
    dbPath = path.join(dir, "video_record.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE record_0 (aid TEXT, view_time_timestamp INTEGER, enter_from TEXT)");
    db.exec("CREATE TABLE record_92585448288 (aid TEXT, view_time_timestamp INTEGER, enter_from TEXT)");
    db.prepare("INSERT INTO record_0 VALUES (?,?,?)").run("7644480728574545765", 1781706182375, "homepage_hot");
    db.prepare("INSERT INTO record_92585448288 VALUES (?,?,?)").run("7480000000000000002", 1717800600000, "others_homepage");
    db.close();

    vdir = fs.mkdtempSync(path.join(os.tmpdir(), "dy-watch-vault-"));
    vault = new LocalVault({ path: path.join(vdir, "v.db"), key: generateKeyHex() });
    vault.open();
  });

  afterAll(() => {
    try { vault.close(); } catch (_e) { /* best-effort */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  });

  it("merges record_0 + uid table and ingests canonical BROWSE events", () => {
    const r = watchHistoryToVault(vault, dbPath, { now: 1781900000000 });
    expect(r.records).toBe(2); // record_0 row no longer dropped
    expect(r.ingested).toBe(2);
    expect(r.uid).toBe("92585448288");
    const events = vault.queryEvents({ limit: 100 }) || [];
    const browse = events.filter(
      (e) => e.subtype === "browse" && e.source.adapter === "social-douyin",
    );
    expect(browse.length).toBe(2);
    expect(browse.some((e) => e.extra.awemeId === "7644480728574545765")).toBe(true);
    expect(browse.some((e) => e.extra.enterFrom === "homepage_hot")).toBe(true);
  });

  it("re-ingest dedups on the per-record originalId", () => {
    watchHistoryToVault(vault, dbPath, { now: 1781999999999 });
    const events = vault.queryEvents({ limit: 100 }) || [];
    const browse = events.filter(
      (e) => e.subtype === "browse" && e.source.adapter === "social-douyin",
    );
    expect(browse.length).toBe(2); // still two
  });
});
