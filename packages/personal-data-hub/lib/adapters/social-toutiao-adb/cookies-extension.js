"use strict";

/**
 * Phase 6c (Toutiao C 路径 — 2026-05-25): toutiao.cookies ADB extension factory.
 *
 * Mirror of `social-xiaohongshu-adb/cookies-extension.js` (P3c). Reads the
 * Chromium cookies SQLite from Toutiao Android app (com.ss.android.article.news)
 * via `su -c base64`. Returns Cookie header + pre-extracted uid (if present
 * in cookie) + a session-id liveness flag.
 *
 * Required cookies (without these, fetchProfile returns status_code != 0):
 *  - one of `passport_uid` / `multi_sids` / `__ac_uid` → uid identification
 *  - `sessionid` OR `sessionid_ss` → passport endpoint auth
 *
 * Either missing → TOUTIAO_COOKIES_INCOMPLETE so UI surfaces a "relog on
 * phone" banner. _signature endpoint cookies (msToken / __ac_nonce / ttwid)
 * rotate fast (5-15min) so we don't fail-fast on them — fetchProfile will
 * reveal whether they're stale.
 *
 * Returns:
 *   {
 *     cookie: string,
 *     uid: string|null,            // best-effort uid pre-extract (may be null
 *                                   // if cookie only has session — caller
 *                                   // falls back to api.fetchProfile)
 *     extractedAt: number,
 *     diagnostic: {
 *       cookieCount: number,
 *       hadEncrypted: boolean,
 *       cookieNames: string[],
 *     }
 *   }
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  readChromiumCookies,
} = require("../social-bilibili-adb/chromium-cookies-reader");

const TOUTIAO_PACKAGE = "com.ss.android.article.news";
const TOUTIAO_COOKIES_REMOTE_PATH =
  "/data/data/com.ss.android.article.news/app_webview/Default/Cookies";

const TOUTIAO_COOKIE_HOST_DOMAIN = "toutiao.com";

/**
 * Lenient — at least one of sessionid / sessionid_ss must be present, AND
 * at least one of the uid candidates. Toutiao's anti-bot cookies (msToken /
 * __ac_nonce / ttwid) rotate fast so we don't fail-fast on them.
 */
const TOUTIAO_SESSION_COOKIES = Object.freeze(["sessionid", "sessionid_ss"]);
const TOUTIAO_UID_COOKIES = Object.freeze([
  "passport_uid",
  "multi_sids",
  "__ac_uid",
  "tt_uid",
]);

async function pullCookiesViaSu(adb, serial, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 60_000 };
  const lsOut = await adb(
    [
      "shell",
      "su",
      "-c",
      `ls ${TOUTIAO_COOKIES_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`,
    ],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    // Distinguish "app not installed" from "installed but no webview cookie
    // store yet" (logged out / never opened an in-app WebView). Both leave the
    // Cookies file absent, but the user action differs — so probe pm.
    const pmOut = await adb(
      ["shell", "su", "-c", `pm list packages ${TOUTIAO_PACKAGE}`],
      adbOpts,
    );
    const installed = pmOut
      .replace(/\r/g, "")
      .includes(`package:${TOUTIAO_PACKAGE}`);
    if (installed) {
      throw new Error(
        "TOUTIAO_NO_WEBVIEW_COOKIES: 今日头条 App 已安装但无 WebView cookie 库 (" +
          TOUTIAO_COOKIES_REMOTE_PATH +
          " 不存在)。请在 App 内登录，并打开任意文章/网页（触发内置 WebView 写 cookie）后重试。注意：极速版 (.lite) 是另一个包，不支持。",
      );
    }
    throw new Error(
      "TOUTIAO_NOT_INSTALLED: " +
        TOUTIAO_COOKIES_REMOTE_PATH +
        " not found and package " +
        TOUTIAO_PACKAGE +
        " is not installed. Install Toutiao App (今日头条 com.ss.android.article.news) + log in once, then retry. Note: 极速版 (.lite) uses a different package — only the standard app is supported.",
    );
  }
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "TOUTIAO_NO_ROOT: this phone isn't rooted (su returned `" +
        idLine.substring(0, 60) +
        "`). Toutiao release APK isn't debuggable, so root is required to read the Chromium cookies DB.",
    );
  }
  const b64 = await adb(
    [
      "shell",
      "su",
      "-c",
      `base64 ${TOUTIAO_COOKIES_REMOTE_PATH} | tr -d '\\n\\r'`,
    ],
    { ...adbOpts, timeoutMs: opts?.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error(
      "TOUTIAO_COOKIES_EMPTY: base64 stream returned 0 bytes (su exec may have silently failed on MIUI / OEM ROM)",
    );
  }
  let buf;
  try {
    buf = Buffer.from(b64Clean, "base64");
  } catch (e) {
    throw new Error(
      "TOUTIAO_BASE64_PARSE: stream wasn't valid base64 (" +
        (e.message || String(e)) +
        ")",
    );
  }
  if (buf.length < 1024) {
    throw new Error(
      "TOUTIAO_COOKIES_TRUNCATED: decoded file is only " +
        buf.length +
        " bytes — expected ≥4KB sqlite",
    );
  }
  const magic = buf.subarray(0, 16).toString("latin1");
  if (!magic.startsWith("SQLite format 3")) {
    throw new Error(
      "TOUTIAO_NOT_SQLITE: decoded file lacks `SQLite format 3` magic header",
    );
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `cc-toutiao-cookies-${crypto.randomUUID()}.db`,
  );
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Build a Cookie header from a chromium-cookies array. Picks the
 * longest hostKey when multiple entries share a name (mirror of Xhs +
 * Weibo logic — handles .toutiao.com vs www.toutiao.com duplicates).
 *
 * Extracts uid best-effort: passport_uid > multi_sids first segment >
 * __ac_uid > tt_uid. Returns null uid if no candidate present.
 */
function assembleToutiaoCookieHeader(cookies) {
  if (!Array.isArray(cookies)) {
    throw new TypeError(
      "assembleToutiaoCookieHeader: cookies must be an array",
    );
  }
  const byName = new Map();
  for (const c of cookies) {
    if (
      !byName.has(c.name) ||
      c.hostKey.length > (byName.get(c.name).hostKey || "").length
    ) {
      byName.set(c.name, c);
    }
  }
  const hasSession = TOUTIAO_SESSION_COOKIES.some((n) => byName.has(n));
  const uid = pickUidFromCookieMap(byName);
  const present = new Set(byName.keys());
  if (!hasSession) {
    return {
      header: null,
      uid: null,
      present,
      missing: TOUTIAO_SESSION_COOKIES.filter((n) => !byName.has(n)),
    };
  }
  const header = Array.from(byName.values())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return { header, uid, present, missing: [] };
}

function pickUidFromCookieMap(byName) {
  const passport = byName.get("passport_uid")?.value;
  if (passport && /^\d+$/.test(passport) && passport !== "0") {
    return passport;
  }
  const multi = byName.get("multi_sids")?.value;
  if (multi) {
    // Format "12345:abcd;67890:efgh" — pick first uid segment
    const firstUid = multi.split(";")[0].split(":")[0].trim();
    if (firstUid && /^\d+$/.test(firstUid) && firstUid !== "0") {
      return firstUid;
    }
  }
  const acUid = byName.get("__ac_uid")?.value;
  if (acUid && /^\d+$/.test(acUid) && acUid !== "0") {
    return acUid;
  }
  const ttUid = byName.get("tt_uid")?.value;
  if (ttUid && /^\d+$/.test(ttUid) && ttUid !== "0") {
    return ttUid;
  }
  return null;
}

function createToutiaoCookiesExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});

  return async function toutiaoCookiesHandler(_params, ctx) {
    if (
      !ctx ||
      typeof ctx.adb !== "function" ||
      typeof ctx.pickDevice !== "function"
    ) {
      throw new TypeError(
        "toutiao.cookies extension: ctx must provide {adb, pickDevice}",
      );
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullCookiesViaSu(ctx.adb, serial, { timeoutMs });
      const cookies = readChromiumCookies(tmpFile, TOUTIAO_COOKIE_HOST_DOMAIN);
      const cookieCount = cookies.length;
      const hadEncrypted = (cookies._skippedEncryptedCount || 0) > 0;
      const { header, uid, missing, present } =
        assembleToutiaoCookieHeader(cookies);
      if (header === null) {
        throw new Error(
          "TOUTIAO_COOKIES_INCOMPLETE: missing required session cookies " +
            JSON.stringify(missing) +
            ". Likely the user logged out, or has never logged in via the Toutiao app's WebView (open any article link to populate). hadEncrypted=" +
            hadEncrypted +
            ".",
        );
      }
      return {
        cookie: header,
        uid,
        extractedAt: Date.now(),
        diagnostic: {
          cookieCount,
          hadEncrypted,
          cookieNames: Array.from(present),
        },
      };
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
  createToutiaoCookiesExtension,
  TOUTIAO_COOKIES_REMOTE_PATH,
  TOUTIAO_COOKIE_HOST_DOMAIN,
  TOUTIAO_SESSION_COOKIES,
  TOUTIAO_UID_COOKIES,
  assembleToutiaoCookieHeader,
  _internals: {
    pullCookiesViaSu,
    pickUidFromCookieMap,
  },
};
