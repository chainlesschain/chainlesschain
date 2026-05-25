"use strict";

/**
 * Phase 3a (Weibo C 路径 — 2026-05-25): weibo.cookies ADB extension factory.
 *
 * Mirror of `social-bilibili-adb/cookies-extension.js` (P1a). Pipeline:
 *
 *   1. ADB-pull /data/data/com.sina.weibo/app_webview/Default/Cookies
 *      via `su -c "base64 ..."` streaming (avoids MIUI FUSE SELinux trap)
 *   2. Parse the chromium-shape sqlite via the shared
 *      chromium-cookies-reader (Phase 1a generic module)
 *   3. Filter to host_key match `m.weibo.cn` (Weibo's actual API host;
 *      `weibo.com` chromium cookies exist on desktop but not on the
 *      mobile App where chromium-cookies lives)
 *   4. Validate at minimum SUB cookie present (the session cookie —
 *      without it /api/config returns "not logged in")
 *   5. Assemble Cookie header from all m.weibo.cn cookies (Weibo's API
 *      doesn't enforce a strict required-cookie list like Bilibili's
 *      5-cookie requirement; pass everything through and let the server
 *      pick what it needs)
 *
 * Returns:
 *   {
 *     cookie: string,             // full Cookie header
 *     extractedAt: number,
 *     diagnostic: {
 *       cookieCount: number,
 *       hadEncrypted: boolean,
 *       hasSub: boolean,
 *       cookieNames: string[],
 *     }
 *   }
 *
 * Failure modes (all throw, UI maps the typed reason to a banner):
 *   - WEIBO_NOT_INSTALLED — package not on device
 *   - WEIBO_NO_ROOT — su not available
 *   - WEIBO_COOKIES_EMPTY — base64 stream returned 0 bytes
 *   - WEIBO_COOKIES_TRUNCATED — decoded file too small
 *   - WEIBO_NOT_SQLITE — magic header check failed
 *   - WEIBO_COOKIES_INCOMPLETE — SUB cookie missing (user logged out
 *     on the Weibo App or app uses a non-standard storage path)
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  readChromiumCookies,
} = require("../social-bilibili-adb/chromium-cookies-reader");

const WEIBO_COOKIES_REMOTE_PATH =
  "/data/data/com.sina.weibo/app_webview/Default/Cookies";

const WEIBO_COOKIE_HOST_DOMAIN = "m.weibo.cn";

/** Minimum required cookie name — without SUB, /api/config returns login=false. */
const WEIBO_REQUIRED_COOKIE = "SUB";

async function pullCookiesViaSu(adb, serial, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 60_000 };
  const lsOut = await adb(
    [
      "shell",
      "su",
      "-c",
      `ls ${WEIBO_COOKIES_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`,
    ],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    throw new Error(
      "WEIBO_NOT_INSTALLED: " +
        WEIBO_COOKIES_REMOTE_PATH +
        " not found. Install Weibo App + log in once on the phone, then retry. (Some Weibo App versions store cookies in a non-default WebView profile dir; if Weibo is installed but the path is missing, file a bug to track the actual path.)",
    );
  }
  // Probe root.
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "WEIBO_NO_ROOT: this phone isn't rooted (su returned `" +
        idLine.substring(0, 60) +
        "`). Weibo release APK isn't debuggable, so root is required to read its Cookies DB.",
    );
  }
  // Stream base64 (avoids MIUI FUSE label remap trap).
  const b64 = await adb(
    [
      "shell",
      "su",
      "-c",
      `base64 ${WEIBO_COOKIES_REMOTE_PATH} | tr -d '\\n\\r'`,
    ],
    { ...adbOpts, timeoutMs: opts?.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error(
      "WEIBO_COOKIES_EMPTY: base64 stream returned 0 bytes (su exec may have silently failed on MIUI / OEM ROM, retry or check `adb logcat`)",
    );
  }
  let buf;
  try {
    buf = Buffer.from(b64Clean, "base64");
  } catch (e) {
    throw new Error(
      "WEIBO_BASE64_PARSE: stream wasn't valid base64 (" +
        (e.message || String(e)) +
        ")",
    );
  }
  if (buf.length < 1024) {
    throw new Error(
      "WEIBO_COOKIES_TRUNCATED: decoded file is only " +
        buf.length +
        " bytes — expected ≥4KB sqlite. Possible MIUI silent su fail; check `adb logcat`.",
    );
  }
  const magic = buf.subarray(0, 16).toString("latin1");
  if (!magic.startsWith("SQLite format 3")) {
    throw new Error(
      "WEIBO_NOT_SQLITE: decoded file lacks `SQLite format 3` magic header. Got bytes: " +
        buf.subarray(0, 16).toString("hex"),
    );
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `cc-weibo-cookies-${crypto.randomUUID()}.db`,
  );
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Build a Cookie header from the chromium-cookies array. Weibo doesn't
 * have a strict required-cookie list like Bilibili's 5 — but SUB must
 * be present (it's the session cookie). Everything else is best-effort
 * passthrough.
 */
function assembleWeiboCookieHeader(cookies) {
  if (!Array.isArray(cookies)) {
    throw new TypeError("assembleWeiboCookieHeader: cookies must be an array");
  }
  const byName = new Map();
  for (const c of cookies) {
    // Most-recently-set wins on duplicate names; prefer more-specific host
    if (
      !byName.has(c.name) ||
      c.hostKey.length > (byName.get(c.name).hostKey || "").length
    ) {
      byName.set(c.name, c);
    }
  }
  const hasSub = byName.has(WEIBO_REQUIRED_COOKIE);
  if (!hasSub) {
    return {
      header: null,
      present: new Set(byName.keys()),
      missing: [WEIBO_REQUIRED_COOKIE],
      hasSub: false,
    };
  }
  // Pass everything through — Weibo's m.weibo.cn API picks what it needs
  // (SUB / SUBP / _T_WM / MLOGIN / WEIBOCN_FROM / etc.)
  const header = Array.from(byName.values())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return {
    header,
    present: new Set(byName.keys()),
    missing: [],
    hasSub: true,
  };
}

/**
 * Factory: returns the extension handler. Same contract as Bilibili
 * Phase 1a — stateless, no closure-captured device serial.
 */
function createWeiboCookiesExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});

  return async function weiboCookiesHandler(_params, ctx) {
    if (
      !ctx ||
      typeof ctx.adb !== "function" ||
      typeof ctx.pickDevice !== "function"
    ) {
      throw new TypeError(
        "weibo.cookies extension: ctx must provide {adb, pickDevice} (got " +
          typeof ctx +
          ")",
      );
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullCookiesViaSu(ctx.adb, serial, { timeoutMs });
      const cookies = readChromiumCookies(tmpFile, WEIBO_COOKIE_HOST_DOMAIN);
      const cookieCount = cookies.length;
      const hadEncrypted = (cookies._skippedEncryptedCount || 0) > 0;
      const { header, missing, present, hasSub } =
        assembleWeiboCookieHeader(cookies);
      if (header === null) {
        throw new Error(
          "WEIBO_COOKIES_INCOMPLETE: missing required cookie " +
            JSON.stringify(missing) +
            ". User probably logged out, or Weibo App uses a non-default WebView storage path (hadEncrypted=" +
            hadEncrypted +
            "). Tell user to relog on phone.",
        );
      }
      return {
        cookie: header,
        extractedAt: Date.now(),
        diagnostic: {
          cookieCount,
          hadEncrypted,
          hasSub,
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
  createWeiboCookiesExtension,
  WEIBO_COOKIES_REMOTE_PATH,
  WEIBO_COOKIE_HOST_DOMAIN,
  WEIBO_REQUIRED_COOKIE,
  assembleWeiboCookieHeader,
  // Exposed for tests
  _internals: {
    pullCookiesViaSu,
  },
};
