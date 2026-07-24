"use strict";

/**
 * Phase 3a (Weibo C 路径 — 2026-05-25): Node-side WeiboApiClient.
 *
 * Byte-parity port of
 * `android-app/.../pdh/social/weibo/WeiboApiClient.kt` for the desktop
 * PC + ADB path. Same m.weibo.cn endpoints, same headers, same JSON
 * parse shape. Lockstep with the Kotlin version — if a real-device trap
 * surfaces fix both sides.
 *
 * **Key differences from Bilibili Phase 1b**:
 *  1. **No WBI signing** — m.weibo.cn mobile API requires cookie + UA +
 *     XHR header but no signature. Simpler client, no /nav handshake.
 *  2. **UID via /api/config** — Weibo cookie has no DedeUserID equivalent;
 *     fetchUid() must do an HTTP roundtrip and persist the result.
 *  3. **Time field is ISO 8601** — "Sun Jan 12 13:45:00 +0800 2026"
 *     format (not unix seconds like Bilibili). Java's SimpleDateFormat
 *     parses it; Node's Date can too once we know the format.
 *  4. **Timeline endpoint via containerid** — user posts go through
 *     /api/container/getIndex?containerid=107603<uid>, not a dedicated
 *     /api/posts.
 *  5. **Anti-bot signal**: missing `X-Requested-With: XMLHttpRequest` +
 *     `MWeibo-Pwa: 1` → 30x redirect to login HTML.
 *
 * 4 endpoints:
 *   - config     /api/config (fetchUid + login state check)
 *   - posts      /api/container/getIndex?type=uid&value=<uid>&containerid=107603<uid>
 *   - favourites /api/favorites?page=1
 *   - follows    /api/friendships/friends?uid=<uid>&page=1
 *
 * Transport failures keep the legacy partial-result diagnostics. Parsed list
 * responses fail closed on explicit source errors or unknown envelope shapes,
 * so they cannot be mistaken for a real empty page.
 */

const { extractRecognizedArray } = require("../../source-page");

const DEFAULT_BASE_URL = "https://m.weibo.cn/";
const DEFAULT_MAX_PAGES = 10;

// Pinned Chrome 120 mobile UA — must look like a browser, default
// `node-fetch/x.y.z` returns -100 silentband.
const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 14; ChainlessChain) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const BROWSER_HEADERS = Object.freeze({
  "User-Agent": BROWSER_UA,
  Referer: "https://m.weibo.cn/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  // m.weibo.cn anti-bot: missing these → HTML redirect, not JSON
  "X-Requested-With": "XMLHttpRequest",
  "MWeibo-Pwa": "1",
});

/**
 * Parse Weibo's ISO-8601-ish timestamp.
 *   "Sun Jan 12 13:45:00 +0800 2026" → epoch ms
 *   "1716383021"                     → epoch ms (× 1000 since it's < 1e12)
 *   "1716383021000"                  → epoch ms (verbatim)
 *
 * Mirrors WeiboApiClient.kt:parseWeiboTime.
 */
function parseWeiboTime(raw) {
  if (typeof raw !== "string" || raw.length === 0) return 0;
  // Digits-only fallback — Weibo occasionally serves unix-seconds verbatim
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return n > 1e12 ? n : n * 1000;
  }
  // "EEE MMM dd HH:mm:ss Z yyyy" — JS Date.parse handles this in V8 / Node.
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Strip HTML from Weibo's `text` field (contains <a>, <span>, &nbsp; etc.).
 * Mirrors WeiboApiClient.kt:stripHtml.
 */
function stripHtml(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "";
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

class WeiboApiClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    if (!this.baseUrl.endsWith("/")) this.baseUrl += "/";
    this._fetch = opts.fetch || globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new Error(
        "WeiboApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
    }
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
  }

  /**
   * GET <url> with browser-like headers. Mirrors Kotlin doGetJson —
   * including the non-JSON-body check (Weibo redirects to login HTML
   * when cookie expired).
   */
  async _doGetJson(url, cookie, { returnErrorResponse = false } = {}) {
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
      const trimmed = body.trimStart();
      if (!trimmed.startsWith("{")) {
        // Login redirect / anti-bot HTML — cookie expired or anti-spider hit
        this._setLastError(-4, "non-json (cookie expired?)");
        return null;
      }
      let obj;
      try {
        obj = JSON.parse(body);
      } catch (e) {
        this._setLastError(-3, "parse: " + (e.message || String(e)));
        return null;
      }
      const ok = typeof obj.ok === "number" ? obj.ok : 1;
      if (ok !== 1) {
        this._setLastError(ok, (obj.msg || "").toString());
        if (returnErrorResponse) return obj;
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
    const explicitFailure =
      response && response.ok != null && Number(response.ok) !== 1;
    const sourceResponse = explicitFailure
      ? { ...response, error: response.msg || `ok=${response.ok}` }
      : response;
    try {
      const items = extractRecognizedArray(sourceResponse, paths, {
        source: "social-weibo-adb",
        stream,
      });
      this._clearLastError();
      return items;
    } catch (error) {
      const code =
        response && typeof response.ok === "number" && response.ok !== 1
          ? response.ok || -5
          : -6;
      this._setLastError(
        code,
        (response && response.msg && String(response.msg)) || error.message,
      );
      throw error;
    }
  }

  /**
   * Fetch /api/config to get UID + validate login state. Returns numeric
   * UID on success, null on failure (cookie expired / not logged in).
   * Mirrors WeiboApiClient.kt:fetchUid.
   */
  async fetchUid(cookie) {
    const url = new URL("api/config", this.baseUrl);
    const obj = await this._doGetJson(url, cookie);
    if (!obj) return null;
    const data = obj.data || {};
    if (!data.login) return null;
    const uidStr = data.uid;
    const uid = parseInt(uidStr, 10);
    if (!Number.isFinite(uid) || uid <= 0) return null;
    this._clearLastError();
    return uid;
  }

  /**
   * Fetch the user's own posts (timeline). Mirrors fetchPosts —
   * containerid=107603<uid> is the magic "user's own mblog" container.
   */
  async fetchPosts(cookie, uid, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 100;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const containerid = `107603${uid}`;
    const out = [];
    let cursor = null;
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/container/getIndex", this.baseUrl);
      url.searchParams.set("type", "uid");
      url.searchParams.set("value", String(uid));
      url.searchParams.set("containerid", containerid);
      url.searchParams.set("page", String(page));
      if (cursor != null) url.searchParams.set("since_id", String(cursor));
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "posts",
          page,
          cursor,
        });
      }
      const obj = await this._doGetJson(url, cookie, {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const cards = this._extractSourceArray(obj, [["data", "cards"]], "posts");
      if (isRepeatedPage(seenPages, cards, weiboPostKey)) break;
      for (const card of cards) {
        if (out.length >= limit) break;
        if (!card || card.card_type !== 9) continue; // card_type=9 = mblog
        const blog = card.mblog;
        if (!blog) continue;
        const mid =
          (blog.mid && String(blog.mid)) || (blog.id && String(blog.id));
        if (!mid) continue;
        if (seenItems.has(mid)) continue;
        seenItems.add(mid);
        out.push({
          mid,
          text: stripHtml(blog.text),
          createdAt: parseWeiboTime(blog.created_at),
          source: blog.source || null,
          repostsCount:
            typeof blog.reposts_count === "number" ? blog.reposts_count : 0,
          commentsCount:
            typeof blog.comments_count === "number" ? blog.comments_count : 0,
          likesCount:
            typeof blog.attitudes_count === "number" ? blog.attitudes_count : 0,
          picCount: typeof blog.pic_num === "number" ? blog.pic_num : 0,
        });
      }
      if (cards.length === 0 || out.length >= limit) break;
      const nextCursor = weiboPostsCursor(obj);
      if (nextCursor == null) {
        if (!weiboHasNextPage(obj.data, page)) break;
        cursor = null;
      } else if (String(nextCursor) === String(cursor)) {
        break;
      } else {
        cursor = nextCursor;
      }
    }
    return out;
  }

  /** Mirrors fetchFavourites. */
  async fetchFavourites(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 100;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/favorites", this.baseUrl);
      url.searchParams.set("page", String(page));
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "favourites",
          page,
        });
      }
      const obj = await this._doGetJson(url, cookie, {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const favs = this._extractSourceArray(
        obj,
        [["data", "favorites"]],
        "favourites",
      );
      if (isRepeatedPage(seenPages, favs, weiboFavouriteKey)) break;
      for (const fav of favs) {
        if (out.length >= limit) break;
        if (!fav) continue;
        const status = fav.status;
        if (!status) continue;
        const mid =
          (status.mid && String(status.mid)) ||
          (status.id && String(status.id));
        if (!mid) continue;
        if (seenItems.has(mid)) continue;
        seenItems.add(mid);
        const author = status.user || {};
        const favAt =
          parseWeiboTime(fav.favorited_time) ||
          parseWeiboTime(status.created_at) ||
          0;
        out.push({
          mid,
          text: stripHtml(status.text),
          favAt,
          authorScreenName: author.screen_name || null,
        });
      }
      if (
        favs.length === 0 ||
        out.length >= limit ||
        !weiboHasNextPage(obj.data, page)
      ) {
        break;
      }
    }
    return out;
  }

  /** Mirrors fetchFollows. */
  async fetchFollows(cookie, uid, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    const seenItems = new Set();
    const seenPages = new Set();
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/friendships/friends", this.baseUrl);
      url.searchParams.set("uid", String(uid));
      url.searchParams.set("page", String(page));
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "follows",
          page,
        });
      }
      const obj = await this._doGetJson(url, cookie, {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const users = this._extractSourceArray(
        obj,
        [["data", "users"]],
        "follows",
      );
      if (isRepeatedPage(seenPages, users, weiboFollowKey)) break;
      for (const u of users) {
        if (out.length >= limit) break;
        if (!u) continue;
        const followUid = typeof u.id === "number" ? u.id : 0;
        if (followUid === 0) continue;
        const itemKey = String(followUid);
        if (seenItems.has(itemKey)) continue;
        seenItems.add(itemKey);
        out.push({
          uid: followUid,
          screenName: u.screen_name || "(unnamed)",
          description: u.description || null,
          avatarUrl: u.profile_image_url || null,
          // m.weibo.cn /api/friendships/friends doesn't return follow_time —
          // 0 lets the snapshot builder fall back to snapshottedAt.
          followedAt: 0,
        });
      }
      if (
        users.length === 0 ||
        out.length >= limit ||
        !weiboHasNextPage(obj.data, page)
      ) {
        break;
      }
    }
    return out;
  }
}

function weiboPostsCursor(response) {
  const data = response && response.data;
  if (!data || typeof data !== "object") return null;
  const info =
    data.cardlistInfo && typeof data.cardlistInfo === "object"
      ? data.cardlistInfo
      : {};
  if (
    info.since_id == null ||
    info.since_id === "" ||
    info.since_id === 0 ||
    info.since_id === "0"
  ) {
    return null;
  }
  return info.since_id;
}

function weiboHasNextPage(data, page) {
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
  const maxPage = Number(data.maxPage ?? data.max_page ?? data.max_page_num);
  return Number.isFinite(maxPage) && page < maxPage;
}

function isRepeatedPage(seenPages, items, keyForItem) {
  const pageKey = JSON.stringify(
    items.map((item) => keyForItem(item) || JSON.stringify(item)),
  );
  if (seenPages.has(pageKey)) return true;
  seenPages.add(pageKey);
  return false;
}

function weiboPostKey(card) {
  if (!card || typeof card !== "object") return null;
  const blog = card.mblog;
  if (!blog || typeof blog !== "object") return null;
  const id = blog.mid || blog.id;
  return id == null ? null : String(id);
}

function weiboFavouriteKey(favourite) {
  if (!favourite || typeof favourite !== "object") return null;
  const status = favourite.status;
  if (!status || typeof status !== "object") return null;
  const id = status.mid || status.id;
  return id == null ? null : String(id);
}

function weiboFollowKey(user) {
  if (!user || typeof user !== "object") return null;
  return user.id == null ? null : String(user.id);
}

module.exports = {
  WeiboApiClient,
  // Exposed for tests
  _internals: {
    parseWeiboTime,
    stripHtml,
    BROWSER_UA,
    BROWSER_HEADERS,
  },
};
