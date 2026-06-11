/**
 * Toutiao on-device account reader — recovers the numeric uid + nickname from
 * the app's local `account_db` (table `login_info`), a plaintext SQLite DB.
 *
 * Why this exists (real-device 2026-06-11, device 5lhyaqu8lbwstc6x):
 *   - The web profile endpoint `passport/account/info/v2` returns error_code 16
 *     "该应用无权限" even when fully logged in — so it can't supply the uid.
 *   - The www.toutiao.com WebView cookie jar carries NO numeric uid cookie
 *     (only hashed `uid_tt`/`sid_tt`; no passport_uid/multi_sids/__ac_uid).
 *   - But `/data/data/com.ss.android.article.news/databases/account_db` stores
 *     `login_info { uid, screen_name, sec_uid, ... }` in PLAINTEXT sqlite.
 * Reading it gives the uid that the signed collection/search endpoints need,
 * with no permission/signature/cookie-drift fragility.
 *
 * Pull mechanism mirrors cookies-extension.pullCookiesViaSu (su base64 stream,
 * MIUI-safe). DB read reuses the bilibili chromium-cookies-reader dual-load
 * (bs3mc ABI 140 under Electron / better-sqlite3 under Node test).
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  _internals: { loadDatabaseClass },
} = require("../social-bilibili-adb/chromium-cookies-reader");

const TOUTIAO_PACKAGE = "com.ss.android.article.news";
const ACCOUNT_DB_REMOTE_PATH =
  "/data/data/com.ss.android.article.news/databases/account_db";

/**
 * Pull the account_db sqlite via `su base64` into a host tmp file.
 * @param {(args: string[], opts?: object) => Promise<string>} adb
 * @param {string} serial
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<string>} tmp file path (caller deletes)
 */
async function pullAccountDbViaSu(adb, serial, opts = {}) {
  const adbOpts = { serial, timeoutMs: opts.timeoutMs || 60_000 };
  const lsOut = await adb(
    ["shell", "su", "-c", `ls ${ACCOUNT_DB_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    const pmOut = await adb(
      ["shell", "su", "-c", `pm list packages ${TOUTIAO_PACKAGE}`],
      adbOpts,
    );
    const installed = pmOut.replace(/\r/g, "").includes(`package:${TOUTIAO_PACKAGE}`);
    throw new Error(
      installed
        ? "TOUTIAO_ACCOUNT_DB_MISSING: 今日头条已安装但无 account_db（未登录账号？）— " +
          ACCOUNT_DB_REMOTE_PATH +
          " 不存在。"
        : "TOUTIAO_NOT_INSTALLED: " +
          ACCOUNT_DB_REMOTE_PATH +
          " not found and package not installed.",
    );
  }
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "TOUTIAO_NO_ROOT: su not uid 0 (`" + idLine.substring(0, 60) + "`); root required to read account_db.",
    );
  }
  const b64 = await adb(
    ["shell", "su", "-c", `base64 ${ACCOUNT_DB_REMOTE_PATH} | tr -d '\\n\\r'`],
    { ...adbOpts, timeoutMs: opts.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error("TOUTIAO_ACCOUNT_DB_EMPTY: base64 stream returned 0 bytes (su may have silently failed on MIUI).");
  }
  const buf = Buffer.from(b64Clean, "base64");
  if (buf.length < 1024 || !buf.subarray(0, 15).toString("latin1").startsWith("SQLite format 3")) {
    throw new Error("TOUTIAO_ACCOUNT_DB_NOT_SQLITE: decoded file lacks `SQLite format 3` magic (" + buf.length + " bytes).");
  }
  const tmpFile = path.join(os.tmpdir(), `cc-toutiao-account-${crypto.randomUUID()}.db`);
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Read the best login_info row from a pulled account_db.
 * @param {string} dbPath
 * @param {{_databaseClass?: any}} [opts]
 * @returns {{uid: string, nickname: string|null, secUid: string|null}|null}
 */
function readToutiaoAccount(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const db = new Database(dbPath, { readonly: true });
  try {
    let info;
    try {
      info = db.prepare("PRAGMA table_info(login_info)").all();
    } catch (_e) {
      return null;
    }
    if (!Array.isArray(info) || info.length === 0) return null;
    const cols = new Set(info.map((c) => c.name));
    if (!cols.has("uid")) return null;
    const hasTime = cols.has("time");
    // Prefer the most-recently-written numeric-uid row (multi-account safe).
    const rows = db
      .prepare(
        `SELECT * FROM login_info${hasTime ? " ORDER BY time DESC" : ""}`,
      )
      .all();
    for (const r of rows) {
      const uid = r.uid != null ? String(r.uid) : "";
      if (/^\d+$/.test(uid) && uid !== "0") {
        return {
          uid,
          nickname:
            (r.screen_name && String(r.screen_name)) ||
            (r.platform_screen_name && String(r.platform_screen_name)) ||
            null,
          secUid: r.sec_uid ? String(r.sec_uid) : null,
        };
      }
    }
    return null;
  } finally {
    try {
      db.close();
    } catch (_e) {
      /* best-effort */
    }
  }
}

/**
 * Bridge handler factory: `bridge.invoke("toutiao.account")` → account or
 * throws. Mirrors createToutiaoCookiesExtension's ctx contract.
 */
function createToutiaoAccountExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});
  return async function toutiaoAccountHandler(_params, ctx) {
    if (!ctx || typeof ctx.adb !== "function" || typeof ctx.pickDevice !== "function") {
      throw new TypeError("toutiao.account extension: ctx must provide {adb, pickDevice}");
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullAccountDbViaSu(ctx.adb, serial, { timeoutMs });
      const account = readToutiaoAccount(tmpFile);
      if (!account) {
        throw new Error(
          "TOUTIAO_ACCOUNT_DB_NO_UID: login_info has no numeric-uid row (logged out?).",
        );
      }
      return { ...account, extractedAt: Date.now() };
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
  createToutiaoAccountExtension,
  ACCOUNT_DB_REMOTE_PATH,
  TOUTIAO_PACKAGE,
  _internals: {
    pullAccountDbViaSu,
    readToutiaoAccount,
  },
};
