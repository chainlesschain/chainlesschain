/**
 * Douyin on-device watch-history reader — recovers the user's video view
 * history from the app's local `video_record.db` (table `record_<uid>`), a
 * plaintext SQLite DB.
 *
 * Why this exists (real-device 2026-06-11, device 5lhyaqu8lbwstc6x):
 *   - Douyin's DM db is SQLCipher-encrypted (needs frida) and the web watch-
 *     history endpoint needs X-Bogus signing — both heavy/fragile.
 *   - But `/data/data/com.ss.android.ugc.aweme/databases/video_record.db`
 *     stores `record_<uid> { aid, view_time_timestamp, enter_from, ... }` in
 *     PLAINTEXT — 900 rows on the test device. This is "what/when the user
 *     watched", the core family-guard signal, with zero signing/encryption.
 *
 * Emits snapshot `history` events ({kind, awemeId, capturedAt, enterFrom}) the
 * social-douyin adapter already understands (KIND_HISTORY → BROWSE event), so
 * normalize is reused. Title/author aren't local (would need a web lookup);
 * the behavioral signal (which aweme, when, from which surface) is the value.
 *
 * Pull mirrors social-toutiao-adb/account-reader.pullAccountDbViaSu (su base64
 * stream, MIUI-safe). DB read reuses the bilibili dual-load sqlite open.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  _internals: { loadDatabaseClass },
} = require("../social-bilibili-adb/chromium-cookies-reader");
const { DouyinAdapter } = require("../social-douyin");

const DOUYIN_PACKAGE = "com.ss.android.ugc.aweme";
const VIDEO_RECORD_DB_REMOTE_PATH =
  "/data/data/com.ss.android.ugc.aweme/databases/video_record.db";

/** seconds-or-ms epoch → ms (heuristic: > 1e12 ⇒ already ms). */
function toEpochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

async function pullVideoRecordDbViaSu(adb, serial, opts = {}) {
  const adbOpts = { serial, timeoutMs: opts.timeoutMs || 60_000 };
  const lsOut = await adb(
    ["shell", "su", "-c", `ls ${VIDEO_RECORD_DB_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    const pmOut = await adb(
      ["shell", "su", "-c", `pm list packages ${DOUYIN_PACKAGE}`],
      adbOpts,
    );
    const installed = pmOut.replace(/\r/g, "").includes(`package:${DOUYIN_PACKAGE}`);
    throw new Error(
      installed
        ? "DOUYIN_VIDEO_RECORD_MISSING: 抖音已安装但无 video_record.db（未观看过视频？）— " +
          VIDEO_RECORD_DB_REMOTE_PATH +
          " 不存在。"
        : "DOUYIN_NOT_INSTALLED: " + VIDEO_RECORD_DB_REMOTE_PATH + " not found and package not installed.",
    );
  }
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "DOUYIN_NO_ROOT: su not uid 0 (`" + idLine.substring(0, 60) + "`); root required to read video_record.db.",
    );
  }
  const b64 = await adb(
    ["shell", "su", "-c", `base64 ${VIDEO_RECORD_DB_REMOTE_PATH} | tr -d '\\n\\r'`],
    { ...adbOpts, timeoutMs: opts.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error("DOUYIN_VIDEO_RECORD_EMPTY: base64 stream returned 0 bytes (su may have silently failed on MIUI).");
  }
  const buf = Buffer.from(b64Clean, "base64");
  if (buf.length < 1024 || !buf.subarray(0, 15).toString("latin1").startsWith("SQLite format 3")) {
    throw new Error("DOUYIN_VIDEO_RECORD_NOT_SQLITE: decoded file lacks `SQLite format 3` magic (" + buf.length + " bytes).");
  }
  const tmpFile = path.join(os.tmpdir(), `cc-douyin-vrec-${crypto.randomUUID()}.db`);
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Read watch records from video_record.db. Tables are named `record_<uid>`
 * (per-account) plus a default `record_0`. We MERGE every `record_*` table
 * (record_0 included) and dedup by (awemeId, capturedAt), because the watch
 * history is split across tables and which one holds the bulk varies by device:
 *
 *   - real-device 2026-06-11 (5lhyaqu8lbwstc6x): record_<uid> = 900 rows.
 *   - real-device 2026-06-18: record_0 = 223 rows vs record_<uid> = 9 — the
 *     anonymous/default bucket held 96% of the history.
 *
 * The earlier "skip record_0, pick the largest uid table" logic silently
 * dropped the record_0 rows and lost most of the history on the 2nd device.
 * Attribution `uid` is still the largest non-zero `record_<uid>` table (the
 * logged-in account), or null when only record_0 exists.
 *
 * @returns {{uid: string|null, records: Array<{awemeId,capturedAt,enterFrom}>}}
 */
function readDouyinWatchHistory(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5000;
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'record\\_%' ESCAPE '\\'")
      .all()
      .map((t) => t.name)
      .filter((name) => /^record_\d+$/.test(name));
    if (tables.length === 0) return { uid: null, records: [] };

    let bestUid = null; // largest non-zero record_<uid> table → attribution
    const merged = new Map(); // dedupKey → record (first-seen wins)
    for (const name of tables) {
      const m = /^record_(\d+)$/.exec(name);
      let count = 0;
      try {
        count = db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c;
      } catch (_e) {
        continue;
      }
      if (m && m[1] !== "0" && (!bestUid || count > bestUid.count)) {
        bestUid = { uid: m[1], count };
      }
      const cols = new Set(
        db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name),
      );
      const hasEnter = cols.has("enter_from");
      const hasTs = cols.has("view_time_timestamp");
      let rows;
      try {
        rows = db
          .prepare(
            `SELECT aid${hasTs ? ", view_time_timestamp" : ""}${hasEnter ? ", enter_from" : ""} ` +
              `FROM "${name}"${hasTs ? " ORDER BY view_time_timestamp DESC" : ""} LIMIT ${limit}`,
          )
          .all();
      } catch (_e) {
        continue;
      }
      for (const r of rows) {
        const awemeId = r.aid != null ? String(r.aid) : null;
        if (!awemeId) continue;
        const capturedAt = hasTs ? toEpochMs(r.view_time_timestamp) : null;
        const key = `${awemeId}@${capturedAt == null ? "" : capturedAt}`;
        if (merged.has(key)) continue;
        merged.set(key, {
          awemeId,
          capturedAt,
          enterFrom: hasEnter ? r.enter_from || null : null,
        });
      }
    }
    // Most-recent first (null timestamps sink to the end), then cap.
    const records = Array.from(merged.values())
      .sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0))
      .slice(0, limit);
    return { uid: bestUid ? bestUid.uid : null, records };
  } finally {
    try {
      db.close();
    } catch (_e) {
      /* best-effort */
    }
  }
}

/**
 * Read watch records from a local video_record.db and write them straight into
 * the vault as canonical BROWSE events (via DouyinAdapter.normalize, so they
 * match exactly what the device-bridge collector path produces). Stable
 * per-record originalId → re-ingest UPDATES rather than duplicates.
 *
 * @param {object} vault LocalVault (must expose putBatch)
 * @param {string} dbPath path to video_record.db
 */
function buildWatchHistoryEvents(dbPath, opts = {}) {
  const { uid, records } = readDouyinWatchHistory(dbPath, opts);
  const adapter = opts._adapter || new DouyinAdapter();
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const events = [];
  for (const r of records) {
    if (!r.awemeId) continue;
    const occurredAt =
      Number.isFinite(r.capturedAt) && r.capturedAt > 0 ? r.capturedAt : now;
    const batch = adapter.normalize({
      adapter: "social-douyin",
      kind: "history",
      originalId: `social-douyin:history:${r.awemeId}:${occurredAt}`,
      capturedAt: occurredAt,
      payload: {
        kind: "history",
        awemeId: r.awemeId,
        capturedAt: occurredAt,
        enterFrom: r.enterFrom,
      },
    });
    for (const ev of batch.events) events.push(ev);
  }
  return { events, records: records.length, uid };
}

function watchHistoryToVault(vault, dbPath, opts = {}) {
  if (!vault || typeof vault.putBatch !== "function") {
    throw new TypeError("watchHistoryToVault: vault with putBatch required");
  }
  if (typeof dbPath !== "string" || !dbPath) {
    throw new TypeError("watchHistoryToVault: dbPath required");
  }
  const { events, records, uid } = buildWatchHistoryEvents(dbPath, opts);
  const res = events.length ? vault.putBatch({ events }) : { events: 0 };
  return { ingested: res.events || 0, records, uid };
}

/** Bridge handler factory: `bridge.invoke("douyin.watch-history")` → {uid, records}. */
function createDouyinWatchExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});
  return async function douyinWatchHandler(params, ctx) {
    if (!ctx || typeof ctx.adb !== "function" || typeof ctx.pickDevice !== "function") {
      throw new TypeError("douyin.watch-history extension: ctx must provide {adb, pickDevice}");
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullVideoRecordDbViaSu(ctx.adb, serial, { timeoutMs });
      const result = readDouyinWatchHistory(tmpFile, {
        limit: params && params.limit,
      });
      return { ...result, extractedAt: Date.now() };
    } finally {
      if (tmpFile) {
        try {
          fs.unlinkSync(tmpFile);
        } catch (_e) {
          onCleanupFailed(tmpFile);
        }
      }
    }
  };
}

module.exports = {
  createDouyinWatchExtension,
  buildWatchHistoryEvents,
  watchHistoryToVault,
  VIDEO_RECORD_DB_REMOTE_PATH,
  DOUYIN_PACKAGE,
  _internals: {
    pullVideoRecordDbViaSu,
    readDouyinWatchHistory,
    toEpochMs,
  },
};
