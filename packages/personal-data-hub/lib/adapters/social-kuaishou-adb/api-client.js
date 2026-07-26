"use strict";

/**
 * Phase 6d (Kuaishou C 路径 — 2026-05-25): Node-side KuaishouApiClient.
 *
 * Byte-parity port of KuaishouApiClient.kt. **Profile from cookie (no
 * HTTP) + 3 GraphQL POST endpoints (all signed)**:
 *   - `kuaishou.web.cp.api_ph` cookie payload → ProfileInfo (parseProfileFromCookie)
 *   - `/graphql` visionFeedRecommend  — watch history (signed)
 *   - `/graphql` visionProfilePhotoList — user's posted photos (signed)
 *   - `/graphql` visionSearchPhoto   — search history (signed)
 *
 * **signProvider injection (Phase 6d)**: defaults to NULL_SIGN_PROVIDER —
 * signUrl returns null, so the 3 signed endpoints short-circuit with
 * lastErrorCode=-99. Desktop wiring injects KuaishouSignBridge.
 *
 * **GraphQL nuances**:
 *   - POST `/graphql` with body `{operationName, variables, query}`
 *   - Body MUST match exactly what was signed (NS_sig3 hashes body bytes)
 *   - signedHeaders returns kpf/kpn that must be sent verbatim
 *
 * **Anti-bot signal**: User-Agent must be desktop Chrome 120+. Referer +
 * Origin = https://www.kuaishou.com/. Without `kpf`/`kpn` headers
 * GraphQL endpoint returns 403/Errors.
 */

const { NULL_SIGN_PROVIDER } = require("../../sign-providers");
const {
  createSourcePageGuard,
  extractRecognizedArray,
} = require("../../source-page");

const DEFAULT_BASE_URL = "https://www.kuaishou.com/";
const DEFAULT_MAX_PAGES = Number.POSITIVE_INFINITY;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BROWSER_HEADERS = Object.freeze({
  "User-Agent": BROWSER_UA,
  Referer: "https://www.kuaishou.com/",
  Origin: "https://www.kuaishou.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
});

const OP_FEED_RECOMMEND = "visionFeedRecommend";
const OP_PROFILE_PHOTOS = "visionProfilePhotoList";
const OP_SEARCH_PHOTO = "visionSearchPhoto";
const WATCH_PAGE_SIZE = 50;
const PROFILE_PHOTO_PAGE_SIZE = 100;

function normalizeMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return v > 1e12 ? v : v * 1000;
}

class KuaishouApiClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    if (!this.baseUrl.endsWith("/")) this.baseUrl += "/";
    this._fetch = opts.fetch || globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new Error(
        "KuaishouApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
    }
    this._now = opts.now || Date.now;
    this.signProvider = opts.signProvider || NULL_SIGN_PROVIDER;
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
    this._bridgeHits = 0;
    this._fallbackHits = 0;
  }

  /**
   * Extract uid from cookie. Mirror of Kotlin extractUid:
   *   1. `userId=N` direct cookie
   *   2. Nested user_id / uid / userId inside `kuaishou.web.cp.api_ph`
   *      URL-encoded JSON
   */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const direct = /(?:^|; ?)userId=(\d+)/.exec(cookie);
    if (direct && direct[1] && direct[1] !== "0") {
      this._clearLastError();
      return direct[1];
    }
    const cpMatch = /(?:^|; ?)kuaishou\.web\.cp\.api_ph=([^;]+)/.exec(cookie);
    if (cpMatch && cpMatch[1]) {
      const embedded = extractEmbeddedUid(cpMatch[1]);
      if (embedded) {
        this._clearLastError();
        return embedded;
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 userId / kuaishou.web.cp.api_ph 嵌套 user_id — 登录未完成或仅游客态",
    );
    return null;
  }

  /**
   * Parse profile from cookie's `kuaishou.web.cp.api_ph` URL-encoded JSON.
   * NO HTTP — this is purely cookie-derived (Kuaishou's passport writes
   * the full profile JSON into the cookie at login time).
   *
   * Returns null if api_ph absent / un-decodable / lacks user_id.
   */
  async fetchProfile(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const cpMatch = /(?:^|; ?)kuaishou\.web\.cp\.api_ph=([^;]+)/.exec(cookie);
    if (!cpMatch || !cpMatch[1]) {
      this._setLastError(
        -8,
        "cookie 缺 kuaishou.web.cp.api_ph (profile 解析需要)",
      );
      return null;
    }
    const jsonText = apiPhDecodeCandidates(cpMatch[1]).find((c) =>
      c.trimStart().startsWith("{"),
    );
    if (!jsonText) {
      this._setLastError(
        -9,
        "kuaishou.web.cp.api_ph 解码后非 JSON (urlencoded + base64 fallback 均失败)",
      );
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(jsonText);
    } catch (e) {
      this._setLastError(-3, "parse: " + (e.message || String(e)));
      return null;
    }
    const uid =
      pickString(obj.user_id) ||
      pickString(obj.userId) ||
      (Number.isFinite(obj.user_id) &&
        obj.user_id > 0 &&
        String(obj.user_id)) ||
      (Number.isFinite(obj.userId) && obj.userId > 0 && String(obj.userId)) ||
      null;
    if (!uid || uid === "0") {
      this._setLastError(
        -7,
        `api_ph JSON 缺 user_id (keys=[${Object.keys(obj).join(",")}])`,
      );
      return null;
    }
    this._clearLastError();
    return {
      uid,
      nickname:
        pickString(obj.user_name) ||
        pickString(obj.userName) ||
        pickString(obj.nickname) ||
        "(unnamed)",
      kuaishouId:
        pickString(obj.kuaishou_id) || pickString(obj.kuaishouId) || null,
      avatarUrl:
        pickString(obj.headurl) ||
        pickString(obj.headUrl) ||
        pickString(obj.avatar) ||
        null,
      sex: pickString(obj.sex) || pickString(obj.gender) || null,
      city: pickString(obj.city) || null,
      constellation: pickString(obj.constellation) || null,
      description:
        pickString(obj.description) || pickString(obj.signature) || null,
    };
  }

  async _signedGraphQL(cookie, operationName, variables) {
    const body = JSON.stringify({
      operationName,
      variables,
      query: "",
    });
    const rawUrl = new URL("graphql", this.baseUrl);
    const purpose = `${operationName}|${body}`;
    // signProvider.signUrl + signedHeaders sequential. KuaishouSignBridge
    // caches kpf/kpn from signUrl call so signedHeaders returns them.
    const signedUrl = await this.signProvider.signUrl(rawUrl, purpose);
    if (!signedUrl) {
      this._setLastError(
        -99,
        "__NS_sig3 unavailable (signProvider returned null — bridge not warm or rotated)",
      );
      this._fallbackHits += 1;
      return null;
    }
    const extraHeaders = await this.signProvider.signedHeaders(rawUrl, purpose);
    this._bridgeHits += 1;
    const headers = { ...BROWSER_HEADERS, ...extraHeaders, Cookie: cookie };
    try {
      const resp = await this._fetch(signedUrl.toString(), {
        method: "POST",
        headers,
        body,
      });
      const respBody = await resp.text();
      if (!resp.ok) {
        this._setLastError(resp.status, `HTTP ${resp.status}`);
        return null;
      }
      const trimmed = respBody.trimStart();
      if (!trimmed.startsWith("{")) {
        this._setLastError(
          -4,
          "non-json (cookie expired or anti-bot triggered)",
        );
        return null;
      }
      let obj;
      try {
        obj = JSON.parse(respBody);
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

  /**
   * /graphql visionFeedRecommend — watch history (recommended feed user
   * dwelled on). Requires __NS_sig3.
   */
  async fetchWatchHistory(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const pageSize = Math.min(limit, WATCH_PAGE_SIZE);
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let cursor = "";
    const seenItems = new Set();
    const seenPages = new Set();
    const pageGuard =
      maxPages === Number.POSITIVE_INFINITY
        ? createSourcePageGuard("social-kuaishou-adb")
        : null;
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "watch",
          page,
          cursor,
        });
      }
      const response = await this._signedGraphQL(cookie, OP_FEED_RECOMMEND, {
        pcursor: cursor,
        count: pageSize,
      });
      if (!response) return out;
      const feeds = this._extractGraphQlArray(
        response,
        [["data", OP_FEED_RECOMMEND, "feeds"]],
        "watch",
      );
      if (pageGuard) pageGuard.observe("watch", feeds);
      else if (isRepeatedPage(seenPages, feeds, kuaishouPhotoKey)) break;
      out.push(
        ...extractPhotoList(
          feeds,
          limit - out.length,
          (item, photo, photoId, caption, ts) => ({
            photoId,
            caption,
            authorName: (item.author && item.author.name) || null,
            authorId: (item.author && item.author.id) || null,
            viewedAt: ts,
            duration: Number.isFinite(photo.duration) ? photo.duration : 0,
          }),
          seenItems,
        ),
      );
      if (feeds.length === 0 || out.length >= limit) break;
      const root = response.data && response.data[OP_FEED_RECOMMEND];
      const nextCursor = graphQlNextCursor(root);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return out;
  }

  /**
   * /graphql visionProfilePhotoList — user's own posted photos. Requires
   * __NS_sig3.
   */
  async fetchProfilePhotos(cookie, userId, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const pageSize = Math.min(limit, PROFILE_PHOTO_PAGE_SIZE);
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let cursor = "";
    const seenItems = new Set();
    const seenPages = new Set();
    const pageGuard =
      maxPages === Number.POSITIVE_INFINITY
        ? createSourcePageGuard("social-kuaishou-adb")
        : null;
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "profile-photos",
          page,
          cursor,
        });
      }
      const response = await this._signedGraphQL(cookie, OP_PROFILE_PHOTOS, {
        userId,
        pcursor: cursor,
        count: pageSize,
        page: "profile",
      });
      if (!response) return out;
      const feeds = this._extractGraphQlArray(
        response,
        [["data", OP_PROFILE_PHOTOS, "feeds"]],
        "profile-photos",
      );
      if (pageGuard) pageGuard.observe("profile-photos", feeds);
      else if (isRepeatedPage(seenPages, feeds, kuaishouPhotoKey)) break;
      out.push(
        ...extractPhotoList(
          feeds,
          limit - out.length,
          (_item, _photo, photoId, caption, ts) => ({
            photoId,
            caption,
            postedAt: ts,
          }),
          seenItems,
        ),
      );
      if (feeds.length === 0 || out.length >= limit) break;
      const root = response.data && response.data[OP_PROFILE_PHOTOS];
      const nextCursor = graphQlNextCursor(root);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return out;
  }

  /**
   * /graphql visionSearchPhoto — user's recent search keywords. Requires
   * __NS_sig3.
   *
   * Two response shapes observed: data.recentSearchList vs data.history.
   */
  async fetchSearchHistory(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const out = [];
    let cursor = "";
    const scanStartedAt = this._now();
    let syntheticIndex = 0;
    const seenItems = new Set();
    const seenPages = new Set();
    const pageGuard =
      maxPages === Number.POSITIVE_INFINITY
        ? createSourcePageGuard("social-kuaishou-adb")
        : null;
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "search-history",
          page,
          cursor,
        });
      }
      const response = await this._signedGraphQL(cookie, OP_SEARCH_PHOTO, {
        keyword: "",
        pcursor: cursor,
        page: "search",
      });
      if (!response) return out;
      const arr = this._extractGraphQlArray(
        response,
        [
          ["data", OP_SEARCH_PHOTO, "recentSearchList"],
          ["data", OP_SEARCH_PHOTO, "history"],
        ],
        "search-history",
      );
      if (pageGuard) pageGuard.observe("search-history", arr);
      else if (isRepeatedPage(seenPages, arr, kuaishouSearchKey)) break;
      for (const raw of arr) {
        if (out.length >= limit) break;
        let keyword = null;
        let ts = 0;
        if (raw && typeof raw === "object") {
          keyword = raw.keyword || raw.query || null;
          ts = normalizeMs(raw.time || raw.searchTime || 0);
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
      const root = response.data && response.data[OP_SEARCH_PHOTO];
      const nextCursor = graphQlNextCursor(root);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return out;
  }

  _extractGraphQlArray(response, paths, stream) {
    const errors =
      response && Array.isArray(response.errors) ? response.errors : [];
    const sourceResponse =
      errors.length > 0 ? { ...response, error: errors[0] } : response;
    try {
      const items = extractRecognizedArray(sourceResponse, paths, {
        source: "social-kuaishou-adb",
        stream,
      });
      this._clearLastError();
      return items;
    } catch (error) {
      const first = errors[0];
      const message =
        (first && first.message && `graphql: ${first.message}`) ||
        error.message;
      this._setLastError(-5, message);
      throw error;
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
}

function graphQlNextCursor(root) {
  if (!root || typeof root !== "object") return null;
  if (root.hasMore === false || root.has_more === false) return null;
  const raw =
    root.pcursor ?? root.nextCursor ?? root.next_cursor ?? root.cursor;
  if (raw == null) return null;
  const cursor = String(raw);
  if (
    cursor.length === 0 ||
    cursor.toLowerCase() === "no_more" ||
    cursor.toLowerCase() === "nomore"
  ) {
    return null;
  }
  return cursor;
}

function extractPhotoList(feeds, limit, build, seenItems = new Set()) {
  if (!Array.isArray(feeds)) return [];
  const out = [];
  for (const item of feeds) {
    if (out.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    // Kuaishou GraphQL nests the photo under `photo`; flat fallback.
    const photo =
      item.photo && typeof item.photo === "object" ? item.photo : item;
    const photoId = pickString(photo.id);
    if (!photoId) continue;
    if (seenItems.has(photoId)) continue;
    seenItems.add(photoId);
    const caption = pickString(photo.caption) || "(no caption)";
    const ts = normalizeMs(photo.timestamp || photo.createTime || 0);
    const built = build(item, photo, photoId, caption, ts);
    if (built) out.push(built);
  }
  return out;
}

function isRepeatedPage(seenPages, items, keyForItem) {
  const pageKey = JSON.stringify(
    items.map((item) => keyForItem(item) || JSON.stringify(item)),
  );
  if (seenPages.has(pageKey)) return true;
  seenPages.add(pageKey);
  return false;
}

function kuaishouPhotoKey(item) {
  if (!item || typeof item !== "object") return null;
  const photo =
    item.photo && typeof item.photo === "object" ? item.photo : item;
  return pickString(photo.id);
}

function kuaishouSearchKey(item) {
  if (typeof item === "string") return `string:${item}`;
  if (!item || typeof item !== "object") return null;
  const keyword = item.keyword || item.query;
  if (!keyword) return null;
  return `${keyword}:${item.time || item.searchTime || 0}`;
}

/**
 * api_ph payload decode chain (v0.3): newer Kuaishou builds write the
 * `kuaishou.web.cp.api_ph` cookie as base64(JSON) instead of urlencoded
 * JSON. Yields the URI-decoded string first; when that doesn't look like
 * JSON but matches the base64 charset (std or url-safe), also yields the
 * base64-decoded form — gated on the result starting with `{` so lenient
 * Buffer decoding of arbitrary text can't surface garbage.
 */
function apiPhDecodeCandidates(cpRaw) {
  let decoded;
  try {
    decoded = decodeURIComponent(cpRaw);
  } catch {
    decoded = cpRaw;
  }
  const out = [decoded];
  const trimmed = decoded.trim();
  if (!trimmed.startsWith("{") && /^[A-Za-z0-9+/\-_]+={0,2}$/.test(trimmed)) {
    const b64 = Buffer.from(
      trimmed.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf-8");
    if (b64.trimStart().startsWith("{")) out.push(b64);
  }
  return out;
}

function extractEmbeddedUid(cpRaw) {
  for (const decoded of apiPhDecodeCandidates(cpRaw)) {
    for (const pat of [
      /"?user_id"?\s*:\s*"?(\d+)"?/,
      /"?uid"?\s*:\s*"?(\d+)"?/,
      /"?userId"?\s*:\s*"?(\d+)"?/,
    ]) {
      const m = pat.exec(decoded);
      if (m && m[1] && m[1] !== "0") return m[1];
    }
  }
  return null;
}

function pickString(v) {
  if (typeof v !== "string") return null;
  return v.length > 0 ? v : null;
}

module.exports = {
  KuaishouApiClient,
  _internals: {
    BROWSER_UA,
    BROWSER_HEADERS,
    OP_FEED_RECOMMEND,
    OP_PROFILE_PHOTOS,
    OP_SEARCH_PHOTO,
    normalizeMs,
    extractPhotoList,
    extractEmbeddedUid,
    apiPhDecodeCandidates,
  },
};
