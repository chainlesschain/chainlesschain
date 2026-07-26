"use strict";

/**
 * Phase 6c (Toutiao C 路径 — 2026-05-25): Node-side ToutiaoApiClient.
 *
 * Byte-parity port of ToutiaoApiClient.kt. Endpoints:
 *   - `/passport/account/info/v2/?aid=24`     — cookies-only, no _signature
 *   - `/api/news/feed/v90/?category=__all__`  — needs _signature
 *   - `/article/v2/tab_comments/`             — needs _signature
 *   - `/api/search/content/`                  — needs _signature
 *
 * **signProvider injection (Phase 6c)**: defaults to NULL_SIGN_PROVIDER —
 * signedUrl returns null, so the 3 signed endpoints short-circuit and set
 * lastErrorCode=-99. Desktop wiring injects ToutiaoSignBridge which runs
 * Toutiao's own acrawler.js → ~100% hit rate.
 *
 * **Anti-bot signal**: User-Agent must be desktop Chrome 120+. Referer +
 * Origin = https://www.toutiao.com/. Without ttwid + __ac_nonce + msToken
 * cookies the endpoints may return 412/403 HTML — surfaced as
 * lastErrorCode=resp.status.
 */

const { NULL_SIGN_PROVIDER } = require("../../sign-providers");
const { extractRecognizedArray } = require("../../source-page");

const DEFAULT_BASE_URL = "https://www.toutiao.com/";
const DEFAULT_MAX_PAGES = Number.POSITIVE_INFINITY;
const FEED_PAGE_SIZE = 50;
const COLLECTION_PAGE_SIZE = 200;
const SEARCH_PAGE_SIZE = 100;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BROWSER_HEADERS = Object.freeze({
  "User-Agent": BROWSER_UA,
  Referer: "https://www.toutiao.com/",
  Origin: "https://www.toutiao.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
});

/** Toutiao web client id (Douyin web = 2906). */
const AID_TOUTIAO_WEB = "24";

function normalizeMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return v > 1e12 ? v : v * 1000;
}

class ToutiaoApiClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    if (!this.baseUrl.endsWith("/")) this.baseUrl += "/";
    this._fetch = opts.fetch || globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new Error(
        "ToutiaoApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
    }
    this._now = opts.now || Date.now;
    // Phase 6c: signProvider injectable. Desktop wiring injects
    // ToutiaoSignBridge (Electron WebContentsView running acrawler.js).
    // CLI / tests get NULL_SIGN_PROVIDER → signUrl returns null → 3
    // signed endpoints short-circuit with lastErrorCode=-99 (mirror of
    // Android NullSignProvider behavior).
    this.signProvider = opts.signProvider || NULL_SIGN_PROVIDER;
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
    // Diagnostic counters — collector reads to surface "bridge upgrade
    // succeeded" in the report. Each signed endpoint hits the bridge
    // exactly once.
    this._bridgeHits = 0;
    this._fallbackHits = 0;
  }

  /**
   * Extract uid from cookie header. Mirror of Kotlin extractUid:
   * passport_uid first, then multi_sids first segment, then __ac_uid /
   * tt_uid legacy fallback. Returns null if none present (cookie
   * anonymous or login incomplete).
   */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const passportMatch = /(?:^|; ?)passport_uid=(\d+)/.exec(cookie);
    if (passportMatch && passportMatch[1] && passportMatch[1] !== "0") {
      this._clearLastError();
      return passportMatch[1];
    }
    const multiMatch = /(?:^|; ?)multi_sids=([^;]+)/.exec(cookie);
    if (multiMatch && multiMatch[1]) {
      const firstUid = multiMatch[1].split(";")[0].split(":")[0].trim();
      if (firstUid && /^\d+$/.test(firstUid) && firstUid !== "0") {
        this._clearLastError();
        return firstUid;
      }
    }
    const legacyMatch = /(?:^|; ?)(?:__ac_uid|tt_uid)=(\d+)/.exec(cookie);
    if (legacyMatch && legacyMatch[1] && legacyMatch[1] !== "0") {
      this._clearLastError();
      return legacyMatch[1];
    }
    this._setLastError(
      -7,
      "cookie 缺 passport_uid / multi_sids / __ac_uid — 登录未完成或仅游客态",
    );
    return null;
  }

  async _doGetJson(
    url,
    cookie,
    requireSign,
    purpose,
    { returnErrorResponse = false } = {},
  ) {
    let finalUrl = url;
    if (requireSign) {
      // Phase 6c: ask bridge to sign URL. NULL_SIGN_PROVIDER returns null
      // → endpoint short-circuits with -99. Tests can inject a fake
      // provider that returns a mutated URL.
      const signed = await this.signProvider.signUrl(url, purpose);
      if (!signed) {
        this._setLastError(
          -99,
          "_signature unavailable (signProvider returned null — bridge not warm or rotated)",
        );
        this._fallbackHits += 1;
        return null;
      }
      finalUrl = signed;
      this._bridgeHits += 1;
    }
    const headers = { ...BROWSER_HEADERS, Cookie: cookie };
    try {
      const resp = await this._fetch(finalUrl.toString(), {
        method: "GET",
        headers,
      });
      const body = await resp.text();
      if (!resp.ok) {
        this._setLastError(resp.status, `HTTP ${resp.status}`);
        return null;
      }
      const trimmed = body.trimStart();
      if (!trimmed.startsWith("{")) {
        this._setLastError(
          -4,
          "non-json (cookie expired or anti-bot triggered)",
        );
        return null;
      }
      let obj;
      try {
        obj = JSON.parse(body);
      } catch (e) {
        this._setLastError(-3, "parse: " + (e.message || String(e)));
        return null;
      }
      // Toutiao web endpoints signal failure via `err_no != 0` + `message`
      // while still returning HTTP 200 and an empty `data:[]` — without this
      // check that error is silently masked as "0 results" (real-device
      // 2026-06-11: tab_comments → {err_no:1,"message":"params illegal"}).
      if (typeof obj.err_no === "number" && obj.err_no !== 0) {
        this._setLastError(
          obj.err_no,
          String(obj.message || obj.err_tips || `err_no=${obj.err_no}`),
        );
        if (returnErrorResponse) return obj;
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

  _extractSourceArray(response, paths, stream) {
    const message =
      response && typeof response.message === "string"
        ? response.message.trim().toLowerCase()
        : "";
    const sourceResponse =
      message === "error" || message === "failed" || message === "fail"
        ? { ...response, error: response.message }
        : response;
    try {
      const items = extractRecognizedArray(sourceResponse, paths, {
        source: "social-toutiao-adb",
        stream,
        codeKeys: [
          "err_no",
          "status_code",
          "code",
          "errno",
          "errorCode",
          "error_code",
        ],
      });
      this._clearLastError();
      return items;
    } catch (error) {
      const code =
        firstNonZeroNumber(
          response && response.err_no,
          response && response.status_code,
          response && response.code,
          response && response.error_code,
        ) ?? -6;
      const detail =
        response &&
        (response.message ||
          response.err_tips ||
          response.status_msg ||
          response.error_description);
      this._setLastError(code, detail ? String(detail) : error.message);
      throw error;
    }
  }

  /**
   * Fetch /passport/account/info/v2/?aid=24 — cookies-only, no _signature
   * required. Returns ProfileInfo or null on failure.
   */
  async fetchProfile(cookie) {
    const url = new URL("passport/account/info/v2/", this.baseUrl);
    url.searchParams.set("aid", AID_TOUTIAO_WEB);
    const obj = await this._doGetJson(url, cookie, false, "profile");
    if (!obj) return null;
    // Two envelope shapes seen in the wild (real-device 2026-06-11):
    //   legacy:      { status_code: 0, data: {...} }
    //   passport v2: { message: "success", data: {...} }
    //                { message: "error", data: { error_code, description } }
    // The old code only understood status_code and mis-reported the v2
    // envelope as "missing status_code" — masking the real error (e.g.
    // error_code 16 "该应用无权限"). Parse both, surface the specific error.
    const statusCode =
      typeof obj.status_code === "number" ? obj.status_code : null;
    const message = typeof obj.message === "string" ? obj.message : null;
    const data = obj.data && typeof obj.data === "object" ? obj.data : null;
    const ok =
      statusCode === 0 || (statusCode == null && message === "success");
    if (!ok) {
      if (data && Number.isFinite(data.error_code)) {
        // passport v2 error envelope — the actionable code + 中文 description.
        this._setLastError(
          data.error_code,
          String(
            data.description ||
              data.error_description ||
              `error_code=${data.error_code}`,
          ),
        );
      } else if (statusCode != null) {
        this._setLastError(
          statusCode,
          String(
            obj.status_msg ||
              message ||
              obj.error_description ||
              `status_code=${statusCode}`,
          ),
        );
      } else {
        this._setLastError(
          -5,
          `passport/info/v2 unrecognized envelope (message=${message}, keys=[${Object.keys(obj).join(",")}])`,
        );
      }
      return null;
    }
    if (!data) {
      this._setLastError(-6, "profile ok but no `data` object");
      return null;
    }
    const rawUid =
      (data.user_id && String(data.user_id)) ||
      (Number.isFinite(data.user_id_str) &&
        data.user_id_str > 0 &&
        String(data.user_id_str)) ||
      null;
    if (!rawUid) {
      this._setLastError(
        -7,
        `ok but data lacks user_id (cookie missing sessionid?); dataKeys=[${Object.keys(data).join(",")}]`,
      );
      return null;
    }
    return {
      uid: rawUid,
      nickname: data.screen_name || data.name || data.nickname || "(unnamed)",
      avatarUrl: data.avatar_url || data.avatar_thumb || null,
      mobile: data.mobile || null,
      description: data.description || data.signature || null,
      followingCount: Number.isFinite(data.following_count)
        ? data.following_count
        : 0,
      followerCount: Number.isFinite(data.followers_count)
        ? data.followers_count
        : 0,
      mediaId:
        data.media_id != null && String(data.media_id) !== "0"
          ? String(data.media_id)
          : null,
    };
  }

  /**
   * Fetch /api/news/feed/v90/?category=__all__ — recommended feed.
   * Requires _signature. Transport failures retain the partial-result path;
   * parsed source errors and unknown list envelopes fail closed.
   */
  async fetchFeed(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const pageSize = Math.min(limit, FEED_PAGE_SIZE);
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let cursor = null;
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/news/feed/v90/", this.baseUrl);
      url.searchParams.set("category", "__all__");
      url.searchParams.set("aid", AID_TOUTIAO_WEB);
      url.searchParams.set("client_extra_params", "{}");
      url.searchParams.set("count", String(pageSize));
      if (cursor != null) {
        url.searchParams.set("max_behot_time", String(cursor));
      }
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "feed",
          page,
          cursor,
        });
      }
      const obj = await this._doGetJson(url, cookie, true, "feed", {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const arr = this._extractSourceArray(obj, [["data"]], "feed");
      if (isRepeatedPage(seenPages, arr, toutiaoItemKey)) break;
      for (const raw of arr) {
        if (out.length >= limit) break;
        if (!raw || typeof raw !== "object") continue;
        // Some feed cells have the real article nested under raw_data
        // (encoded JSON string); others are top-level.
        let item = raw;
        if (typeof raw.raw_data === "string") {
          try {
            item = JSON.parse(raw.raw_data);
          } catch {
            item = raw;
          }
        }
        const id =
          (item.group_id && String(item.group_id)) ||
          (item.item_id && String(item.item_id)) ||
          null;
        if (!id) continue;
        if (seenItems.has(id)) continue;
        seenItems.add(id);
        out.push({
          itemId: id,
          title: item.title || "(no title)",
          category: item.category || raw.category || null,
          author:
            (item.user_info && item.user_info.name) || item.source || null,
          publishedAt: normalizeMs(item.behot_time || item.publish_time || 0),
          readDuration: Number.isFinite(item.read_duration)
            ? item.read_duration
            : 0,
          source: item.source || null,
        });
      }
      if (arr.length === 0 || out.length >= limit) break;
      const nextCursor = toutiaoFeedCursor(obj);
      if (nextCursor == null || String(nextCursor) === String(cursor)) break;
      cursor = nextCursor;
    }
    return out;
  }

  /**
   * Fetch /article/v2/tab_comments/ — "tab_comments" is misleading; this
   * is the user's saved-articles list. Requires _signature.
   */
  async fetchCollection(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const pageSize = Math.min(limit, COLLECTION_PAGE_SIZE);
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let offset = 0;
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("article/v2/tab_comments/", this.baseUrl);
      url.searchParams.set("aid", AID_TOUTIAO_WEB);
      url.searchParams.set("count", String(pageSize));
      if (page > 1) url.searchParams.set("offset", String(offset));
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "collection",
          page,
          offset,
        });
      }
      const obj = await this._doGetJson(url, cookie, true, "comments", {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const arr = this._extractSourceArray(obj, [["data"]], "collection");
      if (isRepeatedPage(seenPages, arr, toutiaoItemKey)) break;
      for (const item of arr) {
        if (out.length >= limit) break;
        if (!item || typeof item !== "object") continue;
        const id =
          (item.group_id && String(item.group_id)) ||
          (item.item_id && String(item.item_id)) ||
          null;
        if (!id) continue;
        if (seenItems.has(id)) continue;
        seenItems.add(id);
        out.push({
          itemId: id,
          title: item.title || "(no title)",
          category: item.category || null,
          author:
            (item.user_info && item.user_info.name) || item.source || null,
          savedAt: normalizeMs(item.behot_time || item.create_time || 0),
        });
      }
      if (arr.length === 0 || out.length >= limit) break;
      const nextOffset = toutiaoNextOffset(obj, offset, arr.length);
      if (nextOffset == null || nextOffset <= offset) break;
      offset = nextOffset;
    }
    return out;
  }

  /**
   * Fetch /api/search/content/ — search history. Requires _signature.
   * Two response shapes observed (data.user_search_history vs
   * data.search_history); we try both.
   */
  async fetchSearchHistory(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const pageSize = Math.min(limit, SEARCH_PAGE_SIZE);
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let offset = 0;
    const scanStartedAt = this._now();
    let syntheticIndex = 0;
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/search/content/", this.baseUrl);
      url.searchParams.set("aid", AID_TOUTIAO_WEB);
      url.searchParams.set("keyword", "");
      url.searchParams.set("count", String(pageSize));
      if (page > 1) url.searchParams.set("offset", String(offset));
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "search-history",
          page,
          offset,
        });
      }
      const obj = await this._doGetJson(url, cookie, true, "search", {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const arr = this._extractSourceArray(
        obj,
        [
          ["data", "user_search_history"],
          ["data", "search_history"],
        ],
        "search-history",
      );
      if (isRepeatedPage(seenPages, arr, toutiaoSearchKey)) break;
      for (const raw of arr) {
        if (out.length >= limit) break;
        let keyword = null;
        let ts = 0;
        if (raw && typeof raw === "object") {
          keyword = raw.keyword || raw.query || null;
          ts = normalizeMs(raw.time || raw.search_time || 0);
        } else if (typeof raw === "string") {
          keyword = raw;
          ts = scanStartedAt - syntheticIndex * 1000;
          syntheticIndex += 1;
        }
        if (!keyword) continue;
        const itemKey = `${keyword}:${ts}`;
        if (seenItems.has(itemKey)) continue;
        seenItems.add(itemKey);
        out.push({ keyword, searchedAt: ts });
      }
      if (arr.length === 0 || out.length >= limit) break;
      const nextOffset = toutiaoNextOffset(obj, offset, arr.length);
      if (nextOffset == null || nextOffset <= offset) break;
      offset = nextOffset;
    }
    return out;
  }
}

function firstNonZeroNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
      return value;
    }
  }
  return null;
}

function hasMore(value) {
  return value === true || value === 1 || value === "1";
}

function toutiaoFeedCursor(response) {
  if (!response || typeof response !== "object") return null;
  if (response.has_more === false || response.hasMore === false) return null;
  const next =
    response.next && typeof response.next === "object" ? response.next : {};
  const cursor =
    next.max_behot_time ??
    next.maxBehotTime ??
    response.max_behot_time ??
    response.next_max_behot_time;
  if (cursor == null || cursor === "") return null;
  if (
    !hasMore(response.has_more) &&
    !hasMore(response.hasMore) &&
    Object.keys(next).length === 0 &&
    response.next_max_behot_time == null
  ) {
    return null;
  }
  return cursor;
}

function toutiaoNextOffset(response, currentOffset, itemCount) {
  if (!response || typeof response !== "object") return null;
  if (response.has_more === false || response.hasMore === false) return null;
  const next =
    response.next && typeof response.next === "object" ? response.next : {};
  const explicit = next.offset ?? response.next_offset ?? response.nextOffset;
  if (explicit != null && Number.isFinite(Number(explicit))) {
    return Number(explicit);
  }
  if (hasMore(response.has_more) || hasMore(response.hasMore)) {
    return currentOffset + itemCount;
  }
  return null;
}

function isRepeatedPage(seenPages, items, keyForItem) {
  const pageKey = JSON.stringify(
    items.map((item) => keyForItem(item) || JSON.stringify(item)),
  );
  if (seenPages.has(pageKey)) return true;
  seenPages.add(pageKey);
  return false;
}

function toutiaoItemKey(raw) {
  if (!raw || typeof raw !== "object") return null;
  let item = raw;
  if (typeof raw.raw_data === "string") {
    try {
      item = JSON.parse(raw.raw_data);
    } catch {
      item = raw;
    }
  }
  const id = item.group_id || item.item_id;
  return id == null ? null : String(id);
}

function toutiaoSearchKey(item) {
  if (typeof item === "string") return `string:${item}`;
  if (!item || typeof item !== "object") return null;
  const keyword = item.keyword || item.query;
  if (!keyword) return null;
  return `${keyword}:${item.time || item.search_time || 0}`;
}

module.exports = {
  ToutiaoApiClient,
  _internals: {
    AID_TOUTIAO_WEB,
    BROWSER_UA,
    BROWSER_HEADERS,
    normalizeMs,
  },
};
