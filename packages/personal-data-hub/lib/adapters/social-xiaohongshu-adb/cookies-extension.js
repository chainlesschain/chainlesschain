"use strict";

/**
 * Phase 3c (Xhs C 路径 — 2026-05-25): xhs.cookies ADB extension factory.
 *
 * Mirror of `social-weibo-adb/cookies-extension.js` (P3a) but for
 * com.xingin.xhs (Xiaohongshu) — same chromium-cookies-reader reuse,
 * different package + cookie name requirements.
 *
 * Required cookies (without these, X-S signing or auth fails):
 *  - `a1`           — anti-bot fingerprint, REQUIRED for X-S sig input
 *  - `web_session`  — login session token
 *
 * Either of the two missing → WEIBO_COOKIES_INCOMPLETE-style error code
 * (XHS_COOKIES_INCOMPLETE) so UI surfaces a "relog on phone" banner.
 *
 * Returns:
 *   {
 *     cookie: string,             // full Cookie header value
 *     a1: string,                 // pre-extracted a1 (saves caller parsing)
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

const XHS_PACKAGE = "com.xingin.xhs";
const XHS_COOKIES_REMOTE_PATH =
  "/data/data/com.xingin.xhs/app_webview/Default/Cookies";

const XHS_COOKIE_HOST_DOMAIN = "xiaohongshu.com";

const XHS_REQUIRED_COOKIES = Object.freeze(["a1", "web_session"]);

async function pullCookiesViaSu(adb, serial, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 60_000 };
  const lsOut = await adb(
    [
      "shell",
      "su",
      "-c",
      `ls ${XHS_COOKIES_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`,
    ],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    // Distinguish "app not installed" from "installed but no webview cookie
    // store yet" (logged out / never opened an in-app WebView). Both leave the
    // Cookies file absent, but the user action differs — so probe pm.
    const pmOut = await adb(
      ["shell", "su", "-c", `pm list packages ${XHS_PACKAGE}`],
      adbOpts,
    );
    const installed = pmOut.replace(/\r/g, "").includes(`package:${XHS_PACKAGE}`);
    if (installed) {
      throw new Error(
        "XHS_NO_WEBVIEW_COOKIES: Xiaohongshu App 已安装但无 WebView cookie 库 (" +
          XHS_COOKIES_REMOTE_PATH +
          " 不存在)。请在 App 内登录，并打开任意笔记/网页（触发内置 WebView 写 cookie）后重试。",
      );
    }
    throw new Error(
      "XHS_NOT_INSTALLED: " +
        XHS_COOKIES_REMOTE_PATH +
        " not found and package " +
        XHS_PACKAGE +
        " is not installed. Install Xiaohongshu App + log in once on the phone, then retry.",
    );
  }
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "XHS_NO_ROOT: this phone isn't rooted (su returned `" +
        idLine.substring(0, 60) +
        "`). Xiaohongshu release APK isn't debuggable, so root is required.",
    );
  }
  const b64 = await adb(
    [
      "shell",
      "su",
      "-c",
      `base64 ${XHS_COOKIES_REMOTE_PATH} | tr -d '\\n\\r'`,
    ],
    { ...adbOpts, timeoutMs: opts?.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error(
      "XHS_COOKIES_EMPTY: base64 stream returned 0 bytes (su exec may have silently failed on MIUI / OEM ROM)",
    );
  }
  let buf;
  try {
    buf = Buffer.from(b64Clean, "base64");
  } catch (e) {
    throw new Error(
      "XHS_BASE64_PARSE: stream wasn't valid base64 (" +
        (e.message || String(e)) +
        ")",
    );
  }
  if (buf.length < 1024) {
    throw new Error(
      "XHS_COOKIES_TRUNCATED: decoded file is only " +
        buf.length +
        " bytes — expected ≥4KB sqlite",
    );
  }
  const magic = buf.subarray(0, 16).toString("latin1");
  if (!magic.startsWith("SQLite format 3")) {
    throw new Error(
      "XHS_NOT_SQLITE: decoded file lacks `SQLite format 3` magic header",
    );
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `cc-xhs-cookies-${crypto.randomUUID()}.db`);
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Build a Cookie header + extract a1 from a chromium-cookies array.
 *
 * Xhs requires BOTH a1 and web_session — without either, X-S signing
 * fails (a1) or auth fails (web_session).
 */
function assembleXhsCookieHeader(cookies) {
  if (!Array.isArray(cookies)) {
    throw new TypeError("assembleXhsCookieHeader: cookies must be an array");
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
  const missing = XHS_REQUIRED_COOKIES.filter((n) => !byName.has(n));
  const present = new Set(byName.keys());
  if (missing.length > 0) {
    return { header: null, a1: null, present, missing };
  }
  const header = Array.from(byName.values())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const a1 = byName.get("a1")?.value || null;
  return { header, a1, present, missing: [] };
}

function createXhsCookiesExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});

  return async function xhsCookiesHandler(_params, ctx) {
    if (
      !ctx ||
      typeof ctx.adb !== "function" ||
      typeof ctx.pickDevice !== "function"
    ) {
      throw new TypeError(
        "xhs.cookies extension: ctx must provide {adb, pickDevice}",
      );
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullCookiesViaSu(ctx.adb, serial, { timeoutMs });
      const cookies = readChromiumCookies(tmpFile, XHS_COOKIE_HOST_DOMAIN);
      const cookieCount = cookies.length;
      const hadEncrypted = (cookies._skippedEncryptedCount || 0) > 0;
      const { header, a1, missing, present } = assembleXhsCookieHeader(cookies);
      if (header === null) {
        throw new Error(
          "XHS_COOKIES_INCOMPLETE: missing required cookies " +
            JSON.stringify(missing) +
            ". User probably logged out (relog on phone) or Xhs version uses non-default WebView storage path (hadEncrypted=" +
            hadEncrypted +
            ").",
        );
      }
      return {
        cookie: header,
        a1,
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
  createXhsCookiesExtension,
  XHS_COOKIES_REMOTE_PATH,
  XHS_COOKIE_HOST_DOMAIN,
  XHS_REQUIRED_COOKIES,
  assembleXhsCookieHeader,
  _internals: {
    pullCookiesViaSu,
  },
};
