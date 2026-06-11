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

const DEFAULT_BASE_URL = "https://www.toutiao.com/";

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
    if (
      passportMatch &&
      passportMatch[1] &&
      passportMatch[1] !== "0"
    ) {
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

  async _doGetJson(url, cookie, requireSign, purpose) {
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
    const ok = statusCode === 0 || (statusCode == null && message === "success");
    if (!ok) {
      if (data && Number.isFinite(data.error_code)) {
        // passport v2 error envelope — the actionable code + 中文 description.
        this._setLastError(
          data.error_code,
          String(data.description || data.error_description || `error_code=${data.error_code}`),
        );
      } else if (statusCode != null) {
        this._setLastError(
          statusCode,
          String(obj.status_msg || message || obj.error_description || `status_code=${statusCode}`),
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
      (Number.isFinite(data.user_id_str) && data.user_id_str > 0 &&
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
      nickname:
        data.screen_name ||
        data.name ||
        data.nickname ||
        "(unnamed)",
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
   * Requires _signature. Returns FeedItem[] (empty on failure).
   */
  async fetchFeed(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
    const url = new URL("api/news/feed/v90/", this.baseUrl);
    url.searchParams.set("category", "__all__");
    url.searchParams.set("aid", AID_TOUTIAO_WEB);
    url.searchParams.set("client_extra_params", "{}");
    url.searchParams.set("count", String(limit));
    const obj = await this._doGetJson(url, cookie, true, "feed");
    if (!obj) return [];
    const arr = Array.isArray(obj.data) ? obj.data : [];
    const out = [];
    const cap = Math.min(limit, arr.length);
    for (let i = 0; i < cap; i++) {
      const raw = arr[i];
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
    return out;
  }

  /**
   * Fetch /article/v2/tab_comments/ — "tab_comments" is misleading; this
   * is the user's saved-articles list. Requires _signature.
   */
  async fetchCollection(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200;
    const url = new URL("article/v2/tab_comments/", this.baseUrl);
    url.searchParams.set("aid", AID_TOUTIAO_WEB);
    url.searchParams.set("count", String(limit));
    const obj = await this._doGetJson(url, cookie, true, "comments");
    if (!obj) return [];
    const arr = Array.isArray(obj.data) ? obj.data : [];
    const out = [];
    const cap = Math.min(limit, arr.length);
    for (let i = 0; i < cap; i++) {
      const item = arr[i];
      if (!item || typeof item !== "object") continue;
      const id =
        (item.group_id && String(item.group_id)) ||
        (item.item_id && String(item.item_id)) ||
        null;
      if (!id) continue;
      out.push({
        itemId: id,
        title: item.title || "(no title)",
        category: item.category || null,
        author:
          (item.user_info && item.user_info.name) || item.source || null,
        savedAt: normalizeMs(item.behot_time || item.create_time || 0),
      });
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
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 100;
    const url = new URL("api/search/content/", this.baseUrl);
    url.searchParams.set("aid", AID_TOUTIAO_WEB);
    url.searchParams.set("keyword", "");
    url.searchParams.set("count", String(limit));
    const obj = await this._doGetJson(url, cookie, true, "search");
    if (!obj) return [];
    const data = obj.data;
    if (!data || typeof data !== "object") return [];
    const arr = Array.isArray(data.user_search_history)
      ? data.user_search_history
      : Array.isArray(data.search_history)
        ? data.search_history
        : [];
    const out = [];
    const cap = Math.min(limit, arr.length);
    const now = this._now();
    for (let i = 0; i < cap; i++) {
      const raw = arr[i];
      let keyword = null;
      let ts = 0;
      if (raw && typeof raw === "object") {
        keyword = raw.keyword || raw.query || null;
        ts = normalizeMs(raw.time || raw.search_time || 0);
      } else if (typeof raw === "string") {
        keyword = raw;
        ts = now - i * 1000;
      }
      if (!keyword) continue;
      out.push({ keyword, searchedAt: ts });
    }
    return out;
  }
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
