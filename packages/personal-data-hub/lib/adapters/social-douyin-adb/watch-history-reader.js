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
 * (per-account) plus an anonymous `record_0`. Picks the numeric-uid table with
 * the most rows (the logged-in account); records carry aid + view timestamp +
 * enter_from surface.
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
      .map((t) => t.name);
    // Candidate uid tables: record_<digits>, uid != 0. Pick the largest.
    let best = null;
    for (const name of tables) {
      const m = /^record_(\d+)$/.exec(name);
      if (!m || m[1] === "0") continue;
      let count = 0;
      try {
        count = db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c;
      } catch (_e) {
        continue;
      }
      if (!best || count > best.count) best = { name, uid: m[1], count };
    }
    if (!best) return { uid: null, records: [] };
    const cols = new Set(
      db.prepare(`PRAGMA table_info("${best.name}")`).all().map((c) => c.name),
    );
    const hasEnter = cols.has("enter_from");
    const hasTs = cols.has("view_time_timestamp");
    const rows = db
      .prepare(
        `SELECT aid${hasTs ? ", view_time_timestamp" : ""}${hasEnter ? ", enter_from" : ""} ` +
          `FROM "${best.name}"${hasTs ? " ORDER BY view_time_timestamp DESC" : ""} LIMIT ${limit}`,
      )
      .all();
    const records = [];
    for (const r of rows) {
      const awemeId = r.aid != null ? String(r.aid) : null;
      if (!awemeId) continue;
      records.push({
        awemeId,
        capturedAt: hasTs ? toEpochMs(r.view_time_timestamp) : null,
        enterFrom: hasEnter ? r.enter_from || null : null,
      });
    }
    return { uid: best.uid, records };
  } finally {
    try {
      db.close();
    } catch (_e) {
      /* best-effort */
    }
  }
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
  VIDEO_RECORD_DB_REMOTE_PATH,
  DOUYIN_PACKAGE,
  _internals: {
    pullVideoRecordDbViaSu,
    readDouyinWatchHistory,
    toEpochMs,
  },
};
