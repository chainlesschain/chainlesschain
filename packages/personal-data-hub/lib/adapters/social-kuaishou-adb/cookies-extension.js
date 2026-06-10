"use strict";

/**
 * Phase 6d (Kuaishou C 路径 — 2026-05-25): kuaishou.cookies ADB extension factory.
 *
 * Mirror of `social-toutiao-adb/cookies-extension.js` (P6c). Reads the
 * Chromium cookies SQLite from Kuaishou Android app (com.smile.gifmaker)
 * via `su -c base64`. Returns Cookie header + best-effort pre-extracted
 * uid (from userId direct cookie OR kuaishou.web.cp.api_ph nested JSON).
 *
 * **Required cookies**: at least one of `userId` / `kuaishou.web.cp.api_ph`
 * (login state). The api_ph payload also carries nickname / avatar /
 * kuaishou_id, so api-client can extract profile from cookie alone — no
 * HTTP for profile call.
 *
 * Returns:
 *   {
 *     cookie: string,
 *     uid: string|null,
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
const {
  _internals: { apiPhDecodeCandidates },
} = require("./api-client");

const KUAISHOU_COOKIES_REMOTE_PATH =
  "/data/data/com.smile.gifmaker/app_webview/Default/Cookies";

const KUAISHOU_COOKIE_HOST_DOMAIN = "kuaishou.com";

/**
 * At least one of these must be present for the cookie to be considered
 * "logged in". userId is the simplest signal; api_ph carries richer
 * profile data but isn't always written.
 */
const KUAISHOU_LOGIN_COOKIES = Object.freeze([
  "userId",
  "kuaishou.web.cp.api_ph",
]);

async function pullCookiesViaSu(adb, serial, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 60_000 };
  const lsOut = await adb(
    [
      "shell",
      "su",
      "-c",
      `ls ${KUAISHOU_COOKIES_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`,
    ],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    throw new Error(
      "KUAISHOU_NOT_INSTALLED: " +
        KUAISHOU_COOKIES_REMOTE_PATH +
        " not found. Install Kuaishou App (快手 com.smile.gifmaker) + log in once, then open any video to populate the WebView cookies, then retry. Note: 极速版 (com.kuaishou.nebula) uses a different package — only the standard app is supported.",
    );
  }
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "KUAISHOU_NO_ROOT: this phone isn't rooted (su returned `" +
        idLine.substring(0, 60) +
        "`). Kuaishou release APK isn't debuggable, so root is required to read the Chromium cookies DB.",
    );
  }
  const b64 = await adb(
    [
      "shell",
      "su",
      "-c",
      `base64 ${KUAISHOU_COOKIES_REMOTE_PATH} | tr -d '\\n\\r'`,
    ],
    { ...adbOpts, timeoutMs: opts?.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error(
      "KUAISHOU_COOKIES_EMPTY: base64 stream returned 0 bytes (su exec may have silently failed on MIUI / OEM ROM)",
    );
  }
  let buf;
  try {
    buf = Buffer.from(b64Clean, "base64");
  } catch (e) {
    throw new Error(
      "KUAISHOU_BASE64_PARSE: stream wasn't valid base64 (" +
        (e.message || String(e)) +
        ")",
    );
  }
  if (buf.length < 1024) {
    throw new Error(
      "KUAISHOU_COOKIES_TRUNCATED: decoded file is only " +
        buf.length +
        " bytes — expected ≥4KB sqlite",
    );
  }
  const magic = buf.subarray(0, 16).toString("latin1");
  if (!magic.startsWith("SQLite format 3")) {
    throw new Error(
      "KUAISHOU_NOT_SQLITE: decoded file lacks `SQLite format 3` magic header",
    );
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `cc-kuaishou-cookies-${crypto.randomUUID()}.db`,
  );
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Extract uid from a chromium-cookies array. Priority:
 *   1. Direct `userId` cookie (numeric, !=0)
 *   2. Nested user_id inside `kuaishou.web.cp.api_ph` URL-encoded JSON
 */
function pickUidFromCookieMap(byName) {
  const direct = byName.get("userId")?.value;
  if (direct && /^\d+$/.test(direct) && direct !== "0") {
    return direct;
  }
  const cpRaw = byName.get("kuaishou.web.cp.api_ph")?.value;
  if (cpRaw) {
    // Try nested user_id / uid / userId regex (don't require strict JSON
    // — api_ph format isn't documented and varies). v0.3: candidates
    // include the base64-decoded form for newer Kuaishou builds that
    // write api_ph as base64(JSON).
    for (const decoded of apiPhDecodeCandidates(cpRaw)) {
      for (const pat of [
        /"?user_id"?\s*:\s*"?(\d+)"?/,
        /"?uid"?\s*:\s*"?(\d+)"?/,
        /"?userId"?\s*:\s*"?(\d+)"?/,
      ]) {
        const m = pat.exec(decoded);
        if (m && m[1] && m[1] !== "0") {
          return m[1];
        }
      }
    }
  }
  return null;
}

function assembleKuaishouCookieHeader(cookies) {
  if (!Array.isArray(cookies)) {
    throw new TypeError(
      "assembleKuaishouCookieHeader: cookies must be an array",
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
  const hasLogin = KUAISHOU_LOGIN_COOKIES.some((n) => byName.has(n));
  const uid = pickUidFromCookieMap(byName);
  const present = new Set(byName.keys());
  if (!hasLogin) {
    return {
      header: null,
      uid: null,
      present,
      missing: [...KUAISHOU_LOGIN_COOKIES],
    };
  }
  const header = Array.from(byName.values())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return { header, uid, present, missing: [] };
}

function createKuaishouCookiesExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});

  return async function kuaishouCookiesHandler(_params, ctx) {
    if (
      !ctx ||
      typeof ctx.adb !== "function" ||
      typeof ctx.pickDevice !== "function"
    ) {
      throw new TypeError(
        "kuaishou.cookies extension: ctx must provide {adb, pickDevice}",
      );
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullCookiesViaSu(ctx.adb, serial, { timeoutMs });
      const cookies = readChromiumCookies(
        tmpFile,
        KUAISHOU_COOKIE_HOST_DOMAIN,
      );
      const cookieCount = cookies.length;
      const hadEncrypted = (cookies._skippedEncryptedCount || 0) > 0;
      const { header, uid, missing, present } =
        assembleKuaishouCookieHeader(cookies);
      if (header === null) {
        throw new Error(
          "KUAISHOU_COOKIES_INCOMPLETE: missing required login cookies " +
            JSON.stringify(missing) +
            ". Likely the user logged out, or has never logged in via the Kuaishou app + browsed (open any video to populate WebView). hadEncrypted=" +
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
  createKuaishouCookiesExtension,
  KUAISHOU_COOKIES_REMOTE_PATH,
  KUAISHOU_COOKIE_HOST_DOMAIN,
  KUAISHOU_LOGIN_COOKIES,
  assembleKuaishouCookieHeader,
  _internals: {
    pullCookiesViaSu,
    pickUidFromCookieMap,
  },
};
