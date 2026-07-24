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
 * Transport failures preserve the legacy partial-result path and set
 * `lastErrorCode` + `lastErrorMessage`. Parsed source envelopes fail closed:
 * explicit business errors and unrecognized list shapes throw SourcePageError
 * instead of being misreported as a legitimate empty page.
 *
 * Test seams (mirrors Kotlin's `internal var` pattern):
 *   - opts.fetch       — substitute global fetch (default = global)
 *   - opts.now         — current epoch ms (default = Date.now)
 *   - opts.baseUrl     — override "https://api.bilibili.com/" (MockWebServer)
 *   - client.setMintedBuvid3ForTest(value)
 *   - client.setWbiMixinKeyForTest(value)
 */

const crypto = require("node:crypto");
const { extractRecognizedArray } = require("../../source-page");

const DEFAULT_BASE_URL = "https://api.bilibili.com/";
const DEFAULT_MAX_PAGES = 10;

// Bilibili WBI signature mixin key reorder table — fixed 64-index list the
// web client uses to derive `mixin_key` from `img_key + sub_key`. Mirrors
// BilibiliApiClient.kt line 25-30. If these indexes change, the JS that
// builds w_rid has changed; refresh from a browser session.
const WBI_MIXIN_KEY_TABLE = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
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
    .map(
      ([k, v]) => `${urlEncodeWbi(k)}=${urlEncodeWbi(stripForbiddenChars(v))}`,
    )
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

  _extractSourceArray(response, paths, stream) {
    try {
      const items = extractRecognizedArray(response, paths, {
        source: "social-bilibili-adb",
        stream,
      });
      this._clearLastError();
      return items;
    } catch (error) {
      const code =
        response && typeof response.code === "number" && response.code !== 0
          ? response.code
          : -6;
      const message =
        response &&
        (response.message != null || response.msg != null) &&
        String(response.message != null ? response.message : response.msg);
      this._setLastError(code, message || error.message);
      throw error;
    }
  }

  /**
   * Mint a fresh buvid3 via /x/frontend/finger/spi. Cached for the
   * process lifetime — buvid3 is a per-device fingerprint, not
   * session-scoped, so one mint suffices across re-logins.
   * Mirrors Kotlin mintBuvid3.
   */
  async _mintBuvid3(beforeSourceRequest) {
    if (this._mintedBuvid3) return this._mintedBuvid3;
    const url = new URL("x/frontend/finger/spi", this.baseUrl);
    if (typeof beforeSourceRequest === "function") {
      await beforeSourceRequest({
        operation: "preflight-spi",
        page: 1,
      });
    }
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
  async _ensureWbiMixinKey(beforeSourceRequest) {
    if (this._wbiMixinKey) return this._wbiMixinKey;
    const url = new URL("x/web-interface/nav", this.baseUrl);
    let body;
    if (typeof beforeSourceRequest === "function") {
      await beforeSourceRequest({
        operation: "preflight-nav",
        page: 1,
      });
    }
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
  async _prepareRequest(cookie, url, opts = {}) {
    const b3 = await this._mintBuvid3(opts.beforeSourceRequest);
    const effectiveCookie = b3 ? substituteBuvid3(cookie, b3) : cookie;
    const mixin = await this._ensureWbiMixinKey(opts.beforeSourceRequest);
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
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let cursor = null;
    let previousCursorKey = null;
    const seenItems = new Set();
    const seenPages = new Set();

    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const rawUrl = new URL("x/web-interface/history/cursor", this.baseUrl);
      rawUrl.searchParams.set("ps", "30");
      rawUrl.searchParams.set("type", "archive");
      if (cursor) {
        rawUrl.searchParams.set("max", String(cursor.max));
        rawUrl.searchParams.set("view_at", String(cursor.viewAt));
        if (cursor.business) {
          rawUrl.searchParams.set("business", String(cursor.business));
        }
      }
      const prepared = await this._prepareRequest(cookie, rawUrl, {
        beforeSourceRequest: opts.beforeSourceRequest,
      });
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "history",
          page,
          cursor,
        });
      }
      const obj = await this._doGetJson(prepared.url, prepared.cookie);
      if (!obj) return out;
      const list = this._extractSourceArray(obj, [["data", "list"]], "history");
      if (isRepeatedPage(seenPages, list, bilibiliHistoryKey)) break;
      for (const item of list) {
        if (out.length >= limit) break;
        if (!item) continue;
        const hist = item.history || {};
        const owner = item.owner || {};
        const itemKey = bilibiliHistoryKey(item);
        if (itemKey && seenItems.has(itemKey)) continue;
        if (itemKey) seenItems.add(itemKey);
        out.push({
          bvid: hist.bvid || null,
          avid:
            typeof hist.oid === "number"
              ? hist.oid
              : typeof item.oid === "number"
                ? item.oid
                : null,
          title:
            item.title && item.title.length > 0 ? item.title : "(no title)",
          viewAt: typeof item.view_at === "number" ? item.view_at : 0,
          duration: typeof item.duration === "number" ? item.duration : null,
          uploader: owner.name || null,
          uploaderMid: typeof owner.mid === "number" ? owner.mid : null,
          part: item.part || null,
        });
      }
      if (list.length === 0 || out.length >= limit) break;
      const next = obj.data && obj.data.cursor;
      const nextMax = next && Number(next.max);
      const nextViewAt = next && Number(next.view_at);
      if (
        !next ||
        (!Number.isFinite(nextMax) && !Number.isFinite(nextViewAt)) ||
        (nextMax <= 0 && nextViewAt <= 0)
      ) {
        break;
      }
      const nextCursor = {
        max: Number.isFinite(nextMax) ? nextMax : 0,
        viewAt: Number.isFinite(nextViewAt) ? nextViewAt : 0,
        business:
          typeof next.business === "string" && next.business.length > 0
            ? next.business
            : null,
      };
      const cursorKey = JSON.stringify(nextCursor);
      if (cursorKey === previousCursorKey) break;
      previousCursorKey = cursorKey;
      cursor = nextCursor;
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
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const rawFoldersUrl = new URL(
      "x/v3/fav/folder/created/list-all",
      this.baseUrl,
    );
    rawFoldersUrl.searchParams.set("up_mid", String(uid));
    const { cookie: effectiveCookie, url: foldersUrl } =
      await this._prepareRequest(cookie, rawFoldersUrl, {
        beforeSourceRequest: opts.beforeSourceRequest,
      });
    if (typeof opts.beforeSourceRequest === "function") {
      await opts.beforeSourceRequest({
        operation: "favourites-folders",
        page: 1,
      });
    }
    const foldersJson = await this._doGetJson(foldersUrl, effectiveCookie);
    if (!foldersJson) return [];
    const folders = this._extractSourceArray(
      foldersJson,
      [["data", "list"]],
      "favourites-folders",
    );
    const out = [];
    const seenItems = new Set();
    for (const folder of folders) {
      if (!folder) continue;
      const folderId = typeof folder.id === "number" ? folder.id : 0;
      if (folderId === 0) continue;
      const folderName = folder.title || null;
      let folderItems = 0;
      let folderRowsSeen = 0;
      const seenPages = new Set();
      for (
        let page = 1;
        page <= maxPages && folderItems < perFolderLimit;
        page += 1
      ) {
        const rawItemsUrl = new URL("x/v3/fav/resource/list", this.baseUrl);
        rawItemsUrl.searchParams.set("media_id", String(folderId));
        rawItemsUrl.searchParams.set("ps", String(perFolderLimit));
        rawItemsUrl.searchParams.set("pn", String(page));
        // Real-device 2026-05-22: missing `platform=web` returns code=-400.
        rawItemsUrl.searchParams.set("platform", "web");
        // Sign the per-folder URL too (signature wraps each request).
        const itemsUrl = this._wbiMixinKey
          ? signUrl(rawItemsUrl, this._wbiMixinKey, { now: this._now })
          : rawItemsUrl;
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({
            operation: "favourites",
            page,
            folderId,
          });
        }
        const itemsJson = await this._doGetJson(itemsUrl, effectiveCookie);
        if (!itemsJson) break;
        const medias = this._extractSourceArray(
          itemsJson,
          [["data", "medias"]],
          "favourites",
        );
        if (
          isRepeatedPage(seenPages, medias, (media) =>
            bilibiliFavouriteKey(folderId, media),
          )
        ) {
          break;
        }
        folderRowsSeen += medias.length;
        for (const m of medias) {
          if (folderItems >= perFolderLimit) break;
          if (!m) continue;
          const itemKey = bilibiliFavouriteKey(folderId, m);
          if (itemKey && seenItems.has(itemKey)) continue;
          if (itemKey) seenItems.add(itemKey);
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
          folderItems += 1;
        }
        if (
          medias.length === 0 ||
          folderItems >= perFolderLimit ||
          !hasNextPage(itemsJson.data, {
            page,
            pageSize: perFolderLimit,
            pageItemCount: medias.length,
            seenCount: folderRowsSeen,
          })
        ) {
          break;
        }
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
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let offset = null;
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const rawUrl = new URL("x/polymer/web-dynamic/v1/feed/all", this.baseUrl);
      rawUrl.searchParams.set("type", "all");
      rawUrl.searchParams.set("platform", "web");
      rawUrl.searchParams.set("timezone_offset", "-480");
      if (offset != null) rawUrl.searchParams.set("offset", offset);
      const prepared = await this._prepareRequest(cookie, rawUrl, {
        beforeSourceRequest: opts.beforeSourceRequest,
      });
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "dynamics",
          page,
          cursor: offset,
        });
      }
      const obj = await this._doGetJson(prepared.url, prepared.cookie);
      if (!obj) return out;
      const items = this._extractSourceArray(
        obj,
        [["data", "items"]],
        "dynamics",
      );
      if (isRepeatedPage(seenPages, items, bilibiliDynamicKey)) break;
      for (const it of items) {
        if (out.length >= limit) break;
        if (!it) continue;
        const itemKey = bilibiliDynamicKey(it);
        if (itemKey && seenItems.has(itemKey)) continue;
        if (itemKey) seenItems.add(itemKey);
        const modules = it.modules || {};
        const author = modules.module_author || {};
        const dyn = modules.module_dynamic || {};
        const desc = dyn.desc || {};
        const archive = (dyn.major || {}).archive || {};
        const summary =
          (typeof desc.text === "string" &&
            desc.text.length > 0 &&
            desc.text) ||
          archive.title ||
          "(no summary)";
        const rawType = typeof it.type === "string" ? it.type : "";
        const dynamicType =
          rawType.replace(/^DYNAMIC_TYPE_/, "").toLowerCase() || "unknown";
        out.push({
          rid: it.id_str || null,
          summary,
          dynamicType,
          publishedAt:
            (typeof author.pub_ts === "number" ? author.pub_ts : 0) * 1000,
          authorMid: typeof author.mid === "number" ? author.mid : null,
          authorName: author.name || null,
        });
      }
      if (items.length === 0 || out.length >= limit) break;
      const data = obj.data || {};
      const nextOffset =
        typeof data.offset === "string" && data.offset.length > 0
          ? data.offset
          : null;
      if (data.has_more !== true || !nextOffset || nextOffset === offset) {
        break;
      }
      offset = nextOffset;
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
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    const pageSize = 50;
    let rowsSeen = 0;
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const rawUrl = new URL("x/relation/followings", this.baseUrl);
      rawUrl.searchParams.set("vmid", String(uid));
      rawUrl.searchParams.set("ps", String(pageSize));
      rawUrl.searchParams.set("pn", String(page));
      rawUrl.searchParams.set("order", "desc");
      rawUrl.searchParams.set("order_type", "attention");
      const prepared = await this._prepareRequest(cookie, rawUrl, {
        beforeSourceRequest: opts.beforeSourceRequest,
      });
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "follows",
          page,
        });
      }
      const obj = await this._doGetJson(prepared.url, prepared.cookie);
      if (!obj) return out;
      const list = this._extractSourceArray(obj, [["data", "list"]], "follows");
      if (isRepeatedPage(seenPages, list, bilibiliFollowKey)) break;
      rowsSeen += list.length;
      for (const it of list) {
        if (out.length >= limit) break;
        if (!it) continue;
        const mid = typeof it.mid === "number" ? it.mid : 0;
        if (mid === 0) continue;
        const itemKey = bilibiliFollowKey(it);
        if (itemKey && seenItems.has(itemKey)) continue;
        if (itemKey) seenItems.add(itemKey);
        out.push({
          mid,
          uname: it.uname && it.uname.length > 0 ? it.uname : "(unnamed)",
          face: it.face || null,
          sign: it.sign || null,
          // mtime is unix-seconds modified time of the follow row.
          followedAt: (typeof it.mtime === "number" ? it.mtime : 0) * 1000,
        });
      }
      if (
        list.length === 0 ||
        out.length >= limit ||
        !hasNextPage(obj.data, {
          page,
          pageSize,
          pageItemCount: list.length,
          seenCount: rowsSeen,
        })
      ) {
        break;
      }
    }
    return out;
  }
}

function hasNextPage(data, { page, pageSize, pageItemCount, seenCount }) {
  if (!data || typeof data !== "object") return false;
  if (
    data.has_more === false ||
    data.has_more === 0 ||
    data.has_more === "0" ||
    data.hasMore === false
  ) {
    return false;
  }
  if (
    data.has_more === true ||
    data.has_more === 1 ||
    data.has_more === "1" ||
    data.hasMore === true
  ) {
    return true;
  }
  const total = Number(data.total ?? (data.info && data.info.media_count));
  if (Number.isFinite(total)) {
    const consumed = Number.isFinite(seenCount) ? seenCount : page * pageSize;
    return consumed < total;
  }
  return Number.isFinite(pageItemCount) && pageItemCount > 0;
}

function isRepeatedPage(seenPages, items, keyForItem) {
  const pageKey = JSON.stringify(
    items.map((item) => keyForItem(item) || JSON.stringify(item)),
  );
  if (seenPages.has(pageKey)) return true;
  seenPages.add(pageKey);
  return false;
}

function bilibiliHistoryKey(item) {
  if (!item || typeof item !== "object") return null;
  const history = item.history || {};
  const bvid = history.bvid || item.bvid;
  if (bvid) return `bvid:${bvid}`;
  const oid =
    typeof history.oid === "number"
      ? history.oid
      : typeof item.oid === "number"
        ? item.oid
        : null;
  return oid == null ? null : `oid:${oid}`;
}

function bilibiliFavouriteKey(folderId, item) {
  if (!item || typeof item !== "object") return null;
  const id = item.bvid || item.id;
  return id == null ? null : `${folderId}:${id}`;
}

function bilibiliDynamicKey(item) {
  if (!item || typeof item !== "object") return null;
  const id = item.id_str || item.id;
  return id == null ? null : String(id);
}

function bilibiliFollowKey(item) {
  if (!item || typeof item !== "object") return null;
  return typeof item.mid === "number" && item.mid > 0 ? String(item.mid) : null;
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
