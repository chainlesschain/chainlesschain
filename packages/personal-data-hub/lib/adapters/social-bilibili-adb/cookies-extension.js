"use strict";

/**
 * Phase 1a (Bilibili C 路径 — 2026-05-25): bilibili.cookies ADB extension
 * factory.
 *
 * Plugs into the `opts.extensions` slot of `createHostAdbBridge` /
 * `createDesktopAdbBridge` (see Phase B0 plugin API). Pipeline:
 *
 *   1. ADB-pull /data/data/tv.danmaku.bili/app_webview/Default/Cookies
 *      to a host-side temp file via `su -c base64 ...` streaming. Bilibili
 *      release APKs are NOT debuggable, so `run-as` is not an option;
 *      base64-over-shell is the cross-vendor-safe path (avoids the
 *      MIUI/HyperOS FUSE label remap trap [[android-runas-loopback-selinux-split]]
 *      that hits stage-via-sdcard).
 *   2. Parse the chromium-shape sqlite via [chromium-cookies-reader].
 *   3. Filter to BILIBILI_COOKIE_NAMES, assemble a `Cookie:` header.
 *   4. Also derive `uid` from DedeUserID + `displayName` from
 *      decode-as-needed (Bilibili stores the UID in DedeUserID as a
 *      numeric string — no fetch needed).
 *
 * Returns:
 *   {
 *     cookie: string,            // full Cookie header
 *     uid: number,               // numeric DedeUserID
 *     extractedAt: number,       // epoch ms
 *     diagnostic: {
 *       cookieCount: number,     // total cookies in DB for bilibili.com
 *       hadEncrypted: boolean,   // any encrypted_value rows were skipped
 *     }
 *   }
 *
 * Failure modes (all throw HostAdbBridgeUnavailableError-class errors so
 * the caller's UI can surface a useful banner):
 *   - su not available / device not rooted
 *   - Bilibili App not installed (path doesn't exist)
 *   - cookies sqlite empty (user never logged into Bilibili App)
 *   - any required cookie missing (user logged out, or Keystore-wrapped
 *     value our parser can't decrypt yet)
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  readChromiumCookies,
  assembleBilibiliCookieHeader,
} = require("./chromium-cookies-reader");

const BILIBILI_COOKIES_REMOTE_PATH =
  "/data/data/tv.danmaku.bili/app_webview/Default/Cookies";

/**
 * Pull the Bilibili App's Chromium Cookies sqlite to a host-side temp file
 * via ADB `su -c base64`.
 *
 * Uses base64 streaming rather than stage-via-sdcard because:
 *  (a) avoids MIUI/HyperOS SELinux label-remap on /sdcard ([[android-runas-loopback-selinux-split]])
 *  (b) avoids leaving a copy in /sdcard if the host-side write fails
 *  (c) works identically across vendor ROMs since we never touch the FUSE
 *      layer
 *
 * Tradeoff: base64 has 33% size overhead. Bilibili's Cookies file is
 * typically 50-200 KB, so this is negligible (<300 KB over the wire vs
 * raw 200 KB).
 */
async function pullCookiesViaSu(adb, serial, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 60_000 };
  // Probe existence first — gives a cleaner error than a base64-of-missing-file
  // attempt (which would spit "No such file" to stdout).
  const lsOut = await adb(
    [
      "shell",
      "su",
      "-c",
      `ls ${BILIBILI_COOKIES_REMOTE_PATH} 2>/dev/null || echo NOT_FOUND`,
    ],
    adbOpts,
  );
  const lsLine = lsOut.replace(/\r+$/gm, "").trim();
  if (lsLine === "NOT_FOUND" || lsLine === "") {
    throw new Error(
      "BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN: " +
        BILIBILI_COOKIES_REMOTE_PATH +
        " not found. Install Bilibili App + log in once on the phone, then retry.",
    );
  }
  // su availability — `su -c id -u` returns "0" or "uid=0(root)..." on rooted
  // phones; non-zero/non-root → throw a clear error.
  const idOut = await adb(["shell", "su", "-c", "id -u"], adbOpts);
  const idLine = idOut.replace(/\r+$/gm, "").trim();
  if (idLine !== "0" && !idLine.includes("uid=0")) {
    throw new Error(
      "BILIBILI_NO_ROOT: this phone isn't rooted (su returned `" +
        idLine.substring(0, 60) +
        "`). Bilibili release APK isn't debuggable, so root is required to read its Cookies DB.",
    );
  }
  // Base64-stream the file. We pipe through `tr -d '\n'` so the host side
  // sees a single base64 string with no embedded whitespace artifacts (some
  // Android `base64` impls wrap at 76 columns).
  const b64 = await adb(
    [
      "shell",
      "su",
      "-c",
      `base64 ${BILIBILI_COOKIES_REMOTE_PATH} | tr -d '\\n\\r'`,
    ],
    { ...adbOpts, timeoutMs: opts?.timeoutMs || 60_000 },
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error(
      "BILIBILI_COOKIES_EMPTY: base64 stream returned 0 bytes. su exec may have silently failed (MIUI ROM?), retry or check `adb logcat`.",
    );
  }
  let buf;
  try {
    buf = Buffer.from(b64Clean, "base64");
  } catch (e) {
    throw new Error(
      "BILIBILI_BASE64_PARSE: stream from device wasn't valid base64 (" +
        (e.message || String(e)) +
        "). Possible MIUI ROM corrupting stdout — try plug-in via `adb pull` instead.",
    );
  }
  if (buf.length < 1024) {
    // Chromium Cookies sqlite is >=4KB even when empty (page size + magic
    // header). <1KB means truncation.
    throw new Error(
      "BILIBILI_COOKIES_TRUNCATED: decoded file is only " +
        buf.length +
        " bytes — expected ≥4KB sqlite. Possible su silent fail; check `adb logcat`.",
    );
  }
  // Verify sqlite magic header to catch any kind of corruption early.
  // Magic: "SQLite format 3\0" (16 bytes).
  const magic = buf.subarray(0, 16).toString("latin1");
  if (!magic.startsWith("SQLite format 3")) {
    throw new Error(
      "BILIBILI_NOT_SQLITE: decoded file lacks `SQLite format 3` magic header. Got bytes: " +
        buf.subarray(0, 16).toString("hex"),
    );
  }
  // Write to a unique temp path. Use crypto.randomUUID for collision safety
  // when two desktop bridges run in parallel.
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `cc-bilibili-cookies-${crypto.randomUUID()}.db`,
  );
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/**
 * Factory: returns an extension handler suitable for the `opts.extensions`
 * map of `createHostAdbBridge` / `createDesktopAdbBridge`. Wiring:
 *
 *   const ext = createBilibiliCookiesExtension();
 *   const bridge = createHostAdbBridge({
 *     extensions: { "bilibili.cookies": ext },
 *   });
 *   await bridge.invoke("bilibili.cookies");  // → {cookie, uid, ...}
 *
 * The handler is stateless — no closure-captured device serial / cache.
 * Each invocation pulls a fresh Cookies DB (Bilibili cookies rotate
 * ~weekly; caching across a hub-restart would be brittle).
 *
 * @param {object} [factoryOpts]
 * @param {number} [factoryOpts.timeoutMs=60000]  per-adb-call timeout
 * @param {(path: string) => void} [factoryOpts.onCleanupFailed]
 *   callback for non-fatal temp-file cleanup errors (default = swallow)
 * @returns {(params: object, ctx: object) => Promise<object>}
 */
function createBilibiliCookiesExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});

  return async function bilibiliCookiesHandler(_params, ctx) {
    if (!ctx || typeof ctx.adb !== "function" || typeof ctx.pickDevice !== "function") {
      throw new TypeError(
        "bilibili.cookies extension: ctx must provide {adb, pickDevice} (got " +
          typeof ctx +
          ")",
      );
    }
    const serial = await ctx.pickDevice();
    let tmpFile = null;
    try {
      tmpFile = await pullCookiesViaSu(ctx.adb, serial, { timeoutMs });
      const cookies = readChromiumCookies(tmpFile, "bilibili.com");
      const cookieCount = cookies.length;
      const hadEncrypted = (cookies._skippedEncryptedCount || 0) > 0;
      const { header, missing } = assembleBilibiliCookieHeader(cookies);
      if (header === null) {
        throw new Error(
          "BILIBILI_COOKIES_INCOMPLETE: missing required cookies " +
            JSON.stringify(missing) +
            ". User probably logged out, or Bilibili App version uses Keystore-wrapped values (hadEncrypted=" +
            hadEncrypted +
            "). Tell user to relog on phone.",
        );
      }
      // Derive uid from DedeUserID (we parse it again here because the
      // assembled header has it but the caller may not want to split the
      // header string themselves).
      const dedeRow = cookies.find((c) => c.name === "DedeUserID");
      const uid = dedeRow ? parseInt(dedeRow.value, 10) : null;
      if (!Number.isFinite(uid) || uid <= 0) {
        throw new Error(
          "BILIBILI_INVALID_UID: DedeUserID=" +
            (dedeRow ? dedeRow.value : "<missing>") +
            " is not a positive integer.",
        );
      }
      return {
        cookie: header,
        uid,
        extractedAt: Date.now(),
        diagnostic: {
          cookieCount,
          hadEncrypted,
        },
      };
    } finally {
      // Best-effort cleanup. Leaving a stale temp file isn't a security
      // issue (we wrote it ourselves; nothing else has the path), but it's
      // unhygienic over time.
      if (tmpFile) {
        try {
          fs.unlinkSync(tmpFile);
        } catch (e) {
          onCleanupFailed(tmpFile);
        }
      }
    }
  };
}

module.exports = {
  createBilibiliCookiesExtension,
  BILIBILI_COOKIES_REMOTE_PATH,
  // Exposed for tests
  _internals: {
    pullCookiesViaSu,
  },
};
