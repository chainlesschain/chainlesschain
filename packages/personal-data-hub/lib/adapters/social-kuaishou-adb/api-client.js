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

const DEFAULT_BASE_URL = "https://www.kuaishou.com/";

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
    let decoded;
    try {
      decoded = decodeURIComponent(cpMatch[1]);
    } catch {
      decoded = cpMatch[1];
    }
    const trimmed = decoded.trimStart();
    if (!trimmed.startsWith("{")) {
      this._setLastError(
        -9,
        "kuaishou.web.cp.api_ph 解码后非 JSON (likely base64 — v0.3 加 fallback)",
      );
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(decoded);
    } catch (e) {
      this._setLastError(-3, "parse: " + (e.message || String(e)));
      return null;
    }
    const uid =
      pickString(obj.user_id) ||
      pickString(obj.userId) ||
      (Number.isFinite(obj.user_id) && obj.user_id > 0 && String(obj.user_id)) ||
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
      // GraphQL errors come back as {errors: [...]} with HTTP 200.
      if (Array.isArray(obj.errors) && obj.errors.length > 0) {
        const first = obj.errors[0];
        const msg = (first && first.message) || "graphql error";
        this._setLastError(-5, "graphql: " + msg);
        return null;
      }
      this._clearLastError();
      return obj.data || null;
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
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
    const data = await this._signedGraphQL(cookie, OP_FEED_RECOMMEND, {
      pcursor: "",
      count: limit,
    });
    if (!data) return [];
    const feeds =
      (data.visionFeedRecommend && data.visionFeedRecommend.feeds) || [];
    return extractPhotoList(feeds, limit, (item, photo, photoId, caption, ts) => ({
      photoId,
      caption,
      authorName:
        (item.author && item.author.name) || null,
      authorId:
        (item.author && item.author.id) || null,
      viewedAt: ts,
      duration: Number.isFinite(photo.duration) ? photo.duration : 0,
    }));
  }

  /**
   * /graphql visionProfilePhotoList — user's own posted photos. Requires
   * __NS_sig3.
   */
  async fetchProfilePhotos(cookie, userId, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 100;
    const data = await this._signedGraphQL(cookie, OP_PROFILE_PHOTOS, {
      userId,
      pcursor: "",
      count: limit,
      page: "profile",
    });
    if (!data) return [];
    const feeds =
      (data.visionProfilePhotoList && data.visionProfilePhotoList.feeds) || [];
    return extractPhotoList(feeds, limit, (_item, _photo, photoId, caption, ts) => ({
      photoId,
      caption,
      postedAt: ts,
    }));
  }

  /**
   * /graphql visionSearchPhoto — user's recent search keywords. Requires
   * __NS_sig3.
   *
   * Two response shapes observed: data.recentSearchList vs data.history.
   */
  async fetchSearchHistory(cookie, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
    const data = await this._signedGraphQL(cookie, OP_SEARCH_PHOTO, {
      keyword: "",
      pcursor: "",
      page: "search",
    });
    if (!data) return [];
    const root = data.visionSearchPhoto || {};
    const arr = Array.isArray(root.recentSearchList)
      ? root.recentSearchList
      : Array.isArray(root.history)
        ? root.history
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
        ts = normalizeMs(raw.time || raw.searchTime || 0);
      } else if (typeof raw === "string") {
        keyword = raw;
        ts = now - i * 1000;
      }
      if (!keyword) continue;
      out.push({ keyword, searchedAt: ts });
    }
    return out;
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

function extractPhotoList(feeds, limit, build) {
  if (!Array.isArray(feeds)) return [];
  const out = [];
  const cap = Math.min(limit, feeds.length);
  for (let i = 0; i < cap; i++) {
    const item = feeds[i];
    if (!item || typeof item !== "object") continue;
    // Kuaishou GraphQL nests the photo under `photo`; flat fallback.
    const photo =
      item.photo && typeof item.photo === "object" ? item.photo : item;
    const photoId = pickString(photo.id);
    if (!photoId) continue;
    const caption = pickString(photo.caption) || "(no caption)";
    const ts = normalizeMs(photo.timestamp || photo.createTime || 0);
    const built = build(item, photo, photoId, caption, ts);
    if (built) out.push(built);
  }
  return out;
}

function extractEmbeddedUid(cpRaw) {
  let decoded;
  try {
    decoded = decodeURIComponent(cpRaw);
  } catch {
    decoded = cpRaw;
  }
  for (const pat of [
    /"?user_id"?\s*:\s*"?(\d+)"?/,
    /"?uid"?\s*:\s*"?(\d+)"?/,
    /"?userId"?\s*:\s*"?(\d+)"?/,
  ]) {
    const m = pat.exec(decoded);
    if (m && m[1] && m[1] !== "0") return m[1];
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
  },
};
