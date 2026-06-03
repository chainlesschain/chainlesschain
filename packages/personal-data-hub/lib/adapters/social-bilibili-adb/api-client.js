"use strict";

/**
 * Phase 1b (Bilibili C 路径 — 2026-05-25): Node-side BilibiliApiClient.
 *
 * Byte-identical port of
 * `android-app/.../pdh/social/bilibili/BilibiliApiClient.kt`
 * for the desktop PC + ADB path. Keep them in lockstep — if a real-device
 * trap surfaces on Android (412 anti-spider / -101 / buvid3 / WBI key
 * rotation) the fix usually lands here too.
 *
 * Pipeline of a single sync (called by BilibiliAdbCollector):
 *   1. mintBuvid3() if not cached         → POST-onload anonymous endpoint
 *   2. ensureWbiMixinKey() if not cached  → nav handshake
 *   3. for each of {history, favourite, dynamic, follow}:
 *        prepareRequest(cookie, url)      → substitute buvid3 + sign URL
 *        doGetJson(url, cookie)           → browser-like headers
 *
 * Errors don't throw — endpoints that fail return [] and the collector
 * proceeds with whatever it got (partial sync better than no sync). The
 * UI surfaces `lastErrorCode` + `lastErrorMessage` so the user can tell
 * "412 anti-spider, wait a bit" from "-101 not logged in, relog".
 *
 * Test seams (mirrors Kotlin's `internal var` pattern):
 *   - opts.fetch       — substitute global fetch (default = global)
 *   - opts.now         — current epoch ms (default = Date.now)
 *   - opts.baseUrl     — override "https://api.bilibili.com/" (MockWebServer)
 *   - client.setMintedBuvid3ForTest(value)
 *   - client.setWbiMixinKeyForTest(value)
 */

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://api.bilibili.com/";

// Bilibili WBI signature mixin key reorder table — fixed 64-index list the
// web client uses to derive `mixin_key` from `img_key + sub_key`. Mirrors
// BilibiliApiClient.kt line 25-30. If these indexes change, the JS that
// builds w_rid has changed; refresh from a browser session.
const WBI_MIXIN_KEY_TABLE = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]);

// Chars Bilibili strips from query values before signing (matches their JS).
const WBI_FORBIDDEN_CHARS = new Set(["!", "'", "(", ")", "*"]);

// Pinned to Chrome 120 mobile UA — see BilibiliApiClient.kt:533 for why.
const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 14; ChainlessChain) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const BROWSER_HEADERS = Object.freeze({
  "User-Agent": BROWSER_UA,
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
});

/**
 * "https://i0.hdslb.com/bfs/wbi/abc123.png" → "abc123".
 * Mirrors BilibiliApiClient.kt:extractWbiKeyFromUrl.
 */
function extractWbiKeyFromUrl(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  const lastSlash = url.lastIndexOf("/");
  const lastDot = url.lastIndexOf(".");
  if (lastSlash < 0 || lastDot <= lastSlash) return null;
  const key = url.substring(lastSlash + 1, lastDot);
  return key.length > 0 ? key : null;
}

/**
 * Strip any existing `buvid3=...` from cookie and append the new one.
 * Mirrors BilibiliApiClient.kt:substituteBuvid3.
 */
function substituteBuvid3(cookie, newBuvid3) {
  const parts = cookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("buvid3="));
  if (parts.length === 0) return `buvid3=${newBuvid3}`;
  return parts.join("; ") + `; buvid3=${newBuvid3}`;
}

/** md5 hex digest of utf-8 input string. */
function md5Hex(input) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * URL-encode for WBI signature — same as encodeURIComponent except it
 * uses uppercase hex (some Bilibili JS variants check `%2F` not `%2f`).
 * Mirrors what `urlEncodeWbi` in Kotlin does via Java URLEncoder.
 */
function urlEncodeWbi(s) {
  return encodeURIComponent(String(s));
}

/**
 * Strip WBI_FORBIDDEN_CHARS from a value before signing.
 */
function stripForbiddenChars(value) {
  let out = "";
  for (const ch of String(value)) {
    if (!WBI_FORBIDDEN_CHARS.has(ch)) out += ch;
  }
  return out;
}

/**
 * Sign a URL by appending `wts` + `w_rid` query params derived from
 * [mixinKey]. Mirrors BilibiliApiClient.kt:signUrl byte-for-byte:
 *  - wts = floor(epoch_ms / 1000)
 *  - merge existing query params + wts into a Map (Java LinkedHashMap →
 *    Node Map preserves insertion order, but we sort by key next anyway)
 *  - sort entries by key alphabetically
 *  - for each (k, v): strip forbidden chars from v, encodeURIComponent both
 *  - join as `k=v&k=v&...`
 *  - w_rid = md5(joined + mixinKey)
 *
 * @param {URL} url  the URL to sign (Node URL object); will be mutated +
 *                   returned (caller can read the result via url.toString())
 * @param {string} mixinKey  32-char hex mixin key from ensureWbiMixinKey
 * @param {{now?: () => number}} [opts]  test seam for wts
 * @returns {URL}  same url object, with wts + w_rid appended
 */
function signUrl(url, mixinKey, opts = {}) {
  const now = opts.now || Date.now;
  const wts = Math.floor(now() / 1000);
  const params = new Map();
  // Iterate existing params in insertion order (URL preserves the order
  // we wrote them in).
  for (const [k, v] of url.searchParams) {
    params.set(k, v);
  }
  params.set("wts", String(wts));
  const sortedEntries = Array.from(params.entries()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  const sortedQuery = sortedEntries
    .map(([k, v]) => `${urlEncodeWbi(k)}=${urlEncodeWbi(stripForbiddenChars(v))}`)
    .join("&");
  const wRid = md5Hex(sortedQuery + mixinKey);
  // Rebuild searchParams atomically — appending wts + w_rid on top of the
  // existing ones (we already have wts in `params` above; URL keeps the
  // earlier copy too if we just append, so wipe and re-set).
  url.search = "";
  for (const [k, v] of params.entries()) {
    url.searchParams.append(k, v);
  }
  url.searchParams.append("w_rid", wRid);
  return url;
}

/**
 * Extract numeric uid from a Cookie header.
 *
 * "SESSDATA=...; DedeUserID=12345; ..." → 12345
 * "SESSDATA=...; DedeUserID=0; ..." → null  (logged-out marker)
 * No DedeUserID → null
 */
function extractUid(cookie) {
  if (typeof cookie !== "string") return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("DedeUserID=")) {
      const value = trimmed.substring("DedeUserID=".length);
      const n = parseInt(value, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return null;
}

class BilibiliApiClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    if (!this.baseUrl.endsWith("/")) this.baseUrl += "/";
    this._fetch = opts.fetch || globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new Error(
        "BilibiliApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
    }
    this._now = opts.now || Date.now;
    this._mintedBuvid3 = null;
    this._wbiMixinKey = null;
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
  }

  /** Test seams (lockstep with Kotlin internal var). */
  setMintedBuvid3ForTest(value) {
    this._mintedBuvid3 = value;
  }
  setWbiMixinKeyForTest(value) {
    this._wbiMixinKey = value;
  }

  /**
   * GET <baseUrl><path> with the cookie + browser headers. Returns parsed
   * JSON object on success, null on transport / API error. Failure sets
   * lastErrorCode + lastErrorMessage. Mirrors Kotlin doGetJson byte-for-byte.
   *
   * @param {URL} url  fully-built request URL (with query + signature)
   * @param {string} cookie  Cookie header value
   */
  async _doGetJson(url, cookie) {
    try {
      const resp = await this._fetch(url.toString(), {
        method: "GET",
        headers: { ...BROWSER_HEADERS, Cookie: cookie },
      });
      const body = await resp.text();
      if (!resp.ok) {
        this._setLastError(resp.status, `HTTP ${resp.status}`);
        return null;
      }
      let obj;
      try {
        obj = JSON.parse(body);
      } catch (e) {
        this._setLastError(-3, "parse: " + (e.message || String(e)));
        return null;
      }
      const code = typeof obj.code === "number" ? obj.code : 0;
      if (code !== 0) {
        const msg = (obj.message || "").toString();
        this._setLastError(code, msg);
        return null;
      }
      this._clearLastError();
      return obj;
    } catch (e) {
      this._setLastError(-2, "IO: " + (e.message || String(e)));
      return null;
    }
  }

  _setLastError(code, message) {
    this.lastErrorCode = code;
    this.lastErrorMessage = message;
  }
  _clearLastError() {
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
  }

  /**
   * Mint a fresh buvid3 via /x/frontend/finger/spi. Cached for the
   * process lifetime — buvid3 is a per-device fingerprint, not
   * session-scoped, so one mint suffices across re-logins.
   * Mirrors Kotlin mintBuvid3.
   */
  async _mintBuvid3() {
    if (this._mintedBuvid3) return this._mintedBuvid3;
    const url = new URL("x/frontend/finger/spi", this.baseUrl);
    try {
      const resp = await this._fetch(url.toString(), {
        method: "GET",
        headers: BROWSER_HEADERS,
      });
      if (!resp.ok) return null;
      const body = await resp.text();
      let obj;
      try {
        obj = JSON.parse(body);
      } catch {
        return null;
      }
      if (obj.code !== 0) return null;
      const b3 = obj.data && obj.data.b_3;
      if (typeof b3 === "string" && b3.length > 0) {
        this._mintedBuvid3 = b3;
        return b3;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch + cache the WBI mixin_key from /x/web-interface/nav. Returns
   * the 32-char mixin key on success, null on transport / format error.
   * Mirrors Kotlin ensureWbiMixinKey.
   */
  async _ensureWbiMixinKey() {
    if (this._wbiMixinKey) return this._wbiMixinKey;
    const url = new URL("x/web-interface/nav", this.baseUrl);
    let body;
    try {
      const resp = await this._fetch(url.toString(), {
        method: "GET",
        headers: BROWSER_HEADERS,
      });
      if (!resp.ok) return null;
      body = await resp.text();
    } catch {
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(body);
    } catch {
      return null;
    }
    // nav returns code=-101 for unauthenticated, but wbi_img is still in
    // `data` either way — don't gate on code.
    const wbiImg = obj.data && obj.data.wbi_img;
    if (!wbiImg) return null;
    const imgKey = extractWbiKeyFromUrl(wbiImg.img_url);
    const subKey = extractWbiKeyFromUrl(wbiImg.sub_url);
    if (!imgKey || !subKey) return null;
    const raw = imgKey + subKey;
    if (raw.length < 64) return null;
    let mixin = "";
    for (const i of WBI_MIXIN_KEY_TABLE) {
      if (i < raw.length) mixin += raw[i];
      if (mixin.length >= 32) break;
    }
    if (mixin.length < 32) return null;
    this._wbiMixinKey = mixin;
    return mixin;
  }

  /**
   * Compose buvid3 mint + WBI sign for a request URL. Returns
   * `{cookie, url}` where cookie has the minted buvid3 substituted and
   * url has wts + w_rid signature appended. If WBI key fetch fails,
   * returns the unsigned url (degraded mode — preserves buvid3-only path).
   */
  async _prepareRequest(cookie, url) {
    const b3 = await this._mintBuvid3();
    const effectiveCookie = b3 ? substituteBuvid3(cookie, b3) : cookie;
    const mixin = await this._ensureWbiMixinKey();
    if (!mixin) return { cookie: effectiveCookie, url };
    let signed;
    try {
      signed = signUrl(url, mixin, { now: this._now });
    } catch {
      signed = url;
    }
    return { cookie: effectiveCookie, url: signed };
  }

  /**
   * Fetch watch history. Real-device path is /x/web-interface/history/cursor
   * — Bilibili deprecated /x/v2/history/cursor in early 2026 (now returns
   * HTML 404). Mirrors Kotlin fetchHistory.
   *
   * @param {string} cookie  Cookie header value
   * @param {{limit?: number}} [opts]
   * @returns {Promise<Array<{bvid, avid, title, viewAt, duration, uploader, uploaderMid, part}>>}
   */
  async fetchHistory(cookie, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200;
    const rawUrl = new URL("x/web-interface/history/cursor", this.baseUrl);
    rawUrl.searchParams.set("ps", "30");
    rawUrl.searchParams.set("type", "archive");
    const { cookie: effectiveCookie, url } = await this._prepareRequest(cookie, rawUrl);
    const obj = await this._doGetJson(url, effectiveCookie);
    if (!obj) return [];
    const data = obj.data || {};
    const list = Array.isArray(data.list) ? data.list : [];
    const out = [];
    for (let i = 0; i < Math.min(limit, list.length); i++) {
      const item = list[i];
      if (!item) continue;
      const hist = item.history || {};
      const owner = item.owner || {};
      out.push({
        bvid: hist.bvid || null,
        avid: typeof hist.oid === "number" ? hist.oid : typeof item.oid === "number" ? item.oid : null,
        title: item.title && item.title.length > 0 ? item.title : "(no title)",
        viewAt: typeof item.view_at === "number" ? item.view_at : 0,
        duration: typeof item.duration === "number" ? item.duration : null,
        uploader: owner.name || null,
        uploaderMid: typeof owner.mid === "number" ? owner.mid : null,
        part: item.part || null,
      });
    }
    return out;
  }

  /**
   * Fetch favourites across all user-created folders. Two API calls per
   * folder (folder list + items per folder). Mirrors Kotlin fetchFavourites.
   *
   * @param {string} cookie
   * @param {number} uid  numeric DedeUserID
   * @param {{perFolderLimit?: number}} [opts]
   * @returns {Promise<Array<{bvid, title, savedAt, folderName, uploader}>>}
   */
  async fetchFavourites(cookie, uid, opts = {}) {
    const perFolderLimit =
      Number.isInteger(opts.perFolderLimit) && opts.perFolderLimit > 0
        ? opts.perFolderLimit
        : 50;
    const rawFoldersUrl = new URL("x/v3/fav/folder/created/list-all", this.baseUrl);
    rawFoldersUrl.searchParams.set("up_mid", String(uid));
    const { cookie: effectiveCookie, url: foldersUrl } = await this._prepareRequest(
      cookie,
      rawFoldersUrl,
    );
    const foldersJson = await this._doGetJson(foldersUrl, effectiveCookie);
    if (!foldersJson) return [];
    const foldersData = foldersJson.data || {};
    const folders = Array.isArray(foldersData.list) ? foldersData.list : [];
    const out = [];
    for (const folder of folders) {
      if (!folder) continue;
      const folderId = typeof folder.id === "number" ? folder.id : 0;
      if (folderId === 0) continue;
      const folderName = folder.title || null;
      const rawItemsUrl = new URL("x/v3/fav/resource/list", this.baseUrl);
      rawItemsUrl.searchParams.set("media_id", String(folderId));
      rawItemsUrl.searchParams.set("ps", String(perFolderLimit));
      rawItemsUrl.searchParams.set("pn", "1");
      // Real-device 2026-05-22: missing `platform=web` returns code=-400.
      rawItemsUrl.searchParams.set("platform", "web");
      // Sign the per-folder URL too (signature wraps each request).
      const itemsUrl = this._wbiMixinKey
        ? signUrl(rawItemsUrl, this._wbiMixinKey, { now: this._now })
        : rawItemsUrl;
      const itemsJson = await this._doGetJson(itemsUrl, effectiveCookie);
      if (!itemsJson) continue;
      const itemsData = itemsJson.data || {};
      const medias = Array.isArray(itemsData.medias) ? itemsData.medias : [];
      for (const m of medias) {
        if (!m) continue;
        const upper = m.upper || {};
        const favSec =
          typeof m.fav_time === "number" && m.fav_time > 0
            ? m.fav_time
            : typeof m.ctime === "number"
              ? m.ctime
              : 0;
        out.push({
          bvid: m.bvid || null,
          title: m.title && m.title.length > 0 ? m.title : "(no title)",
          savedAt: favSec * 1000,
          folderName,
          uploader: upper.name || null,
        });
      }
    }
    return out;
  }

  /**
   * Fetch dynamic feed. Mirrors Kotlin fetchDynamics — type=all +
   * platform=web + timezone_offset=-480 required, or anti-bot returns
   * code=0 + empty page.
   */
  async fetchDynamics(cookie, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
    const rawUrl = new URL("x/polymer/web-dynamic/v1/feed/all", this.baseUrl);
    rawUrl.searchParams.set("type", "all");
    rawUrl.searchParams.set("platform", "web");
    rawUrl.searchParams.set("timezone_offset", "-480");
    const { cookie: effectiveCookie, url } = await this._prepareRequest(cookie, rawUrl);
    const obj = await this._doGetJson(url, effectiveCookie);
    if (!obj) return [];
    const data = obj.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const out = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      const it = items[i];
      if (!it) continue;
      const modules = it.modules || {};
      const author = modules.module_author || {};
      const dyn = modules.module_dynamic || {};
      const desc = dyn.desc || {};
      const archive = (dyn.major || {}).archive || {};
      const summary =
        (typeof desc.text === "string" && desc.text.length > 0 && desc.text) ||
        archive.title ||
        "(no summary)";
      const rawType = typeof it.type === "string" ? it.type : "";
      const dynamicType =
        rawType.replace(/^DYNAMIC_TYPE_/, "").toLowerCase() || "unknown";
      out.push({
        rid: it.id_str || null,
        summary,
        dynamicType,
        publishedAt: (typeof author.pub_ts === "number" ? author.pub_ts : 0) * 1000,
        authorMid: typeof author.mid === "number" ? author.mid : null,
        authorName: author.name || null,
      });
    }
    return out;
  }

  /**
   * Fetch following list. Mirrors Kotlin fetchFollows.
   *
   * @param {string} cookie
   * @param {number} uid  numeric DedeUserID
   * @param {{limit?: number}} [opts]
   * @returns {Promise<Array<{mid, uname, face, sign, followedAt}>>}
   */
  async fetchFollows(cookie, uid, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200;
    const rawUrl = new URL("x/relation/followings", this.baseUrl);
    rawUrl.searchParams.set("vmid", String(uid));
    rawUrl.searchParams.set("ps", "50");
    rawUrl.searchParams.set("pn", "1");
    rawUrl.searchParams.set("order", "desc");
    rawUrl.searchParams.set("order_type", "attention");
    const { cookie: effectiveCookie, url } = await this._prepareRequest(cookie, rawUrl);
    const obj = await this._doGetJson(url, effectiveCookie);
    if (!obj) return [];
    const data = obj.data || {};
    const list = Array.isArray(data.list) ? data.list : [];
    const out = [];
    for (let i = 0; i < Math.min(limit, list.length); i++) {
      const it = list[i];
      if (!it) continue;
      const mid = typeof it.mid === "number" ? it.mid : 0;
      if (mid === 0) continue;
      out.push({
        mid,
        uname: it.uname && it.uname.length > 0 ? it.uname : "(unnamed)",
        face: it.face || null,
        sign: it.sign || null,
        // mtime is unix-seconds modified time of the follow row.
        followedAt: (typeof it.mtime === "number" ? it.mtime : 0) * 1000,
      });
    }
    return out;
  }
}

module.exports = {
  BilibiliApiClient,
  extractUid,
  // Exposed for tests + future reuse (Weibo/Xhs may share md5+UA pattern)
  _internals: {
    extractWbiKeyFromUrl,
    substituteBuvid3,
    md5Hex,
    urlEncodeWbi,
    stripForbiddenChars,
    signUrl,
    WBI_MIXIN_KEY_TABLE,
    WBI_FORBIDDEN_CHARS,
    BROWSER_UA,
    BROWSER_HEADERS,
  },
};
