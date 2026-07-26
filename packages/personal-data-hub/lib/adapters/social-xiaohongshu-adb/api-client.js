"use strict";

/**
 * Phase 3c (Xhs C 路径 — 2026-05-25): Node-side XhsApiClient.
 *
 * Byte-parity port of XhsApiClient.kt 4 endpoints. **Best-effort X-S
 * signing** (~60% GET / <30% POST hit rate) — collector tolerates
 * partial failures.
 *
 * Endpoints:
 *   - `/api/sns/web/v1/user/me`             — no X-S, cookies-only
 *   - `/api/sns/web/v2/user_posted`         — needs X-S
 *   - `/api/sns/web/v1/note/like/page`      — needs X-S
 *   - `/api/sns/web/v1/user/follow/list`    — needs X-S
 *
 * **Anti-bot signal**: User-Agent must look like desktop Chrome (xhs
 * web is desktop-tuned, NOT mobile like Bilibili/Weibo). Referer +
 * Origin = `https://www.xiaohongshu.com/`.
 */

const { computeXsXt } = require("./sign");
const { NULL_SIGN_PROVIDER } = require("../../sign-providers");
const {
  createSourcePageGuard,
  extractRecognizedArray,
} = require("../../source-page");

const DEFAULT_BASE_URL = "https://edith.xiaohongshu.com/";
const DEFAULT_MAX_PAGES = Number.POSITIVE_INFINITY;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BROWSER_HEADERS = Object.freeze({
  "User-Agent": BROWSER_UA,
  Referer: "https://www.xiaohongshu.com/",
  Origin: "https://www.xiaohongshu.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
});

/**
 * Parse xhs's interact_info count strings: "1.2万" / "10w+" / "234" / "亿".
 * Mirrors XhsApiClient.kt:parseCount.
 */
function parseCount(raw) {
  if (typeof raw !== "string" || raw.length === 0) return 0;
  const trimmed = raw.trim();
  if (trimmed.endsWith("万")) {
    const n = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(n) ? Math.floor(n * 10000) : 0;
  }
  if (trimmed.endsWith("w+") || trimmed.endsWith("W+")) {
    const n = parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(n) ? Math.floor(n * 10000) : 0;
  }
  if (trimmed.endsWith("w") || trimmed.endsWith("W")) {
    const n = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(n) ? Math.floor(n * 10000) : 0;
  }
  if (trimmed.endsWith("亿")) {
    const n = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(n) ? Math.floor(n * 100_000_000) : 0;
  }
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a Xhs timestamp to milliseconds (seconds → ms when < 1e12).
 */
function normalizeMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return v > 1e12 ? v : v * 1000;
}

class XhsApiClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    if (!this.baseUrl.endsWith("/")) this.baseUrl += "/";
    this._fetch = opts.fetch || globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new Error(
        "XhsApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
    }
    this._now = opts.now || Date.now;
    // Phase 6b: signProvider injectable. Desktop wiring injects
    // XhsSignBridge (Electron WebContentsView running xhs.js, ~100% hit
    // rate). CLI / tests get NULL_SIGN_PROVIDER → falls back to the
    // in-process best-effort computeXsXt (~60% GET / <30% POST hit).
    // Both code paths are present so the client works in either context
    // without the caller having to swap api-client implementations.
    this.signProvider = opts.signProvider || NULL_SIGN_PROVIDER;
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
    // Diagnostic counters — collector reads these to decide whether to
    // surface "bridge upgrade succeeded" in the report.
    this._bridgeHits = 0;
    this._fallbackHits = 0;
  }

  async _doGetJson(
    url,
    cookie,
    a1,
    requireSign,
    { returnErrorResponse = false } = {},
  ) {
    const headers = { ...BROWSER_HEADERS, Cookie: cookie };
    if (requireSign && a1) {
      const pathWithQuery = url.pathname + url.search;
      // Phase 6b: prefer bridge over in-process computeXsXt.
      // signedHeaders is async — bridge does executeJavaScript across
      // Electron IPC. Returns {} on cold bridge / xhs.js rotation / IPC
      // error, in which case we fall back to the best-effort md5.
      const bridgeHeaders = await this.signProvider.signedHeaders(
        url,
        `${pathWithQuery}|`,
      );
      const bridgeKeys = Object.keys(bridgeHeaders);
      if (bridgeKeys.length > 0) {
        // Bridge produced headers — use them verbatim. xhs.js returns
        // X-s / X-t (lowercase t in some builds) / X-s-common; we let
        // the bridge's normalizeXhsHeader handle case.
        Object.assign(headers, bridgeHeaders);
        this._bridgeHits += 1;
      } else {
        // Fallback: in-process best-effort md5 (P3c path).
        const { xs, xt } = computeXsXt(pathWithQuery, null, a1, {
          now: this._now,
        });
        headers["X-S"] = xs;
        headers["X-T"] = xt;
        this._fallbackHits += 1;
      }
    }
    try {
      const resp = await this._fetch(url.toString(), {
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
        this._setLastError(-4, "non-json (login redirect / anti-bot HTML)");
        return null;
      }
      let obj;
      try {
        obj = JSON.parse(body);
      } catch (e) {
        this._setLastError(-3, "parse: " + (e.message || String(e)));
        return null;
      }
      // xhs returns either {code: N, msg:..., data:...} or {success:bool, code:N, data:...}
      const success = obj.success === undefined ? true : obj.success;
      if (success === false) {
        this._setLastError(-5, "/success=false (no code)");
        if (returnErrorResponse) return obj;
        return null;
      }
      const code = typeof obj.code === "number" ? obj.code : 0;
      if (code !== 0) {
        this._setLastError(code, (obj.msg || "").toString());
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
    try {
      const items = extractRecognizedArray(response, paths, {
        source: "social-xiaohongshu-adb",
        stream,
      });
      this._clearLastError();
      return items;
    } catch (error) {
      const code =
        response && typeof response.code === "number" && response.code !== 0
          ? response.code
          : response && response.success === false
            ? -5
            : -6;
      const message =
        response &&
        (response.msg != null || response.message != null) &&
        String(response.msg != null ? response.msg : response.message);
      this._setLastError(code, message || error.message);
      throw error;
    }
  }

  /**
   * Fetch /api/sns/web/v1/user/me — cookies-only, no X-S required.
   * Returns `{userId, nickname}` or null on failure.
   */
  async fetchMe(cookie) {
    const url = new URL("api/sns/web/v1/user/me", this.baseUrl);
    const obj = await this._doGetJson(url, cookie, null, false);
    if (!obj) return null;
    const data = obj.data || {};
    const userId = (data.user_id && String(data.user_id)) || null;
    if (!userId) {
      this._setLastError(
        -7,
        "/user/me ok but user_id blank (cookie likely missing web_session)",
      );
      return null;
    }
    return {
      userId,
      nickname: data.nickname || null,
    };
  }

  /**
   * Fetch user's posted notes. Requires X-S signing.
   */
  async fetchNotes(cookie, a1, userId, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
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
        ? createSourcePageGuard("social-xiaohongshu-adb")
        : null;
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/sns/web/v2/user_posted", this.baseUrl);
      url.searchParams.set("user_id", userId);
      url.searchParams.set("num", "30");
      url.searchParams.set("cursor", cursor);
      url.searchParams.set("image_formats", "jpg,webp,avif");
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "notes",
          page,
          cursor,
        });
      }
      const obj = await this._doGetJson(url, cookie, a1, true, {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const notes = this._extractSourceArray(obj, [["data", "notes"]], "notes");
      if (pageGuard) pageGuard.observe("notes", notes);
      else if (isRepeatedPage(seenPages, notes, xhsNoteKey)) break;
      for (const n of notes) {
        if (out.length >= limit) break;
        if (!n) continue;
        const noteId =
          (n.note_id && String(n.note_id)) || (n.id && String(n.id));
        if (!noteId) continue;
        if (seenItems.has(noteId)) continue;
        seenItems.add(noteId);
        const interact = n.interact_info || {};
        out.push({
          noteId,
          title: n.display_title || n.title || "(no title)",
          desc: n.desc || null,
          type: n.type || "normal",
          createdAt: normalizeMs(typeof n.time === "number" ? n.time : 0),
          likedCount: parseCount(interact.liked_count),
          collectedCount: parseCount(interact.collected_count),
          commentCount: parseCount(interact.comment_count),
        });
      }
      if (notes.length === 0 || out.length >= limit) break;
      const nextCursor = xhsNextCursor(obj.data);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return out;
  }

  /**
   * Fetch user's liked notes. Requires X-S.
   */
  async fetchLiked(cookie, a1, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
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
        ? createSourcePageGuard("social-xiaohongshu-adb")
        : null;
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/sns/web/v1/note/like/page", this.baseUrl);
      url.searchParams.set("num", "20");
      url.searchParams.set("cursor", cursor);
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "liked",
          page,
          cursor,
        });
      }
      const obj = await this._doGetJson(url, cookie, a1, true, {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const notes = this._extractSourceArray(obj, [["data", "notes"]], "liked");
      if (pageGuard) pageGuard.observe("liked", notes);
      else if (isRepeatedPage(seenPages, notes, xhsNoteKey)) break;
      for (const n of notes) {
        if (out.length >= limit) break;
        if (!n) continue;
        const noteId = n.note_id && String(n.note_id);
        if (!noteId) continue;
        if (seenItems.has(noteId)) continue;
        seenItems.add(noteId);
        const user = n.user || {};
        out.push({
          noteId,
          title: n.display_title || n.title || "(no title)",
          // xhs doesn't return explicit liked_at — collector fills with snapshotted_at
          likedAt: 0,
          authorNickname: user.nickname || null,
        });
      }
      if (notes.length === 0 || out.length >= limit) break;
      const nextCursor = xhsNextCursor(obj.data);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return out;
  }

  /**
   * Fetch follow list. Requires X-S.
   */
  async fetchFollows(cookie, a1, userId, opts = {}) {
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
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
        ? createSourcePageGuard("social-xiaohongshu-adb")
        : null;
    for (let page = 1; page <= maxPages && out.length < limit; page += 1) {
      const url = new URL("api/sns/web/v1/user/follow/list", this.baseUrl);
      url.searchParams.set("user_id", userId);
      url.searchParams.set("num", "20");
      url.searchParams.set("cursor", cursor);
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "follows",
          page,
          cursor,
        });
      }
      const obj = await this._doGetJson(url, cookie, a1, true, {
        returnErrorResponse: true,
      });
      if (!obj) return out;
      const users = this._extractSourceArray(
        obj,
        [["data", "users"]],
        "follows",
      );
      if (pageGuard) pageGuard.observe("follows", users);
      else if (isRepeatedPage(seenPages, users, xhsUserKey)) break;
      for (const u of users) {
        if (out.length >= limit) break;
        if (!u) continue;
        const userIdStr = u.user_id && String(u.user_id);
        if (!userIdStr) continue;
        if (seenItems.has(userIdStr)) continue;
        seenItems.add(userIdStr);
        out.push({
          userId: userIdStr,
          nickname: u.nickname || "(unnamed)",
          image: u.image || null,
          // xhs doesn't return explicit follow time
          followedAt: 0,
        });
      }
      if (users.length === 0 || out.length >= limit) break;
      const nextCursor = xhsNextCursor(obj.data);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return out;
  }
}

function xhsNextCursor(data) {
  if (!data || typeof data !== "object") return null;
  if (
    data.has_more === false ||
    data.has_more === 0 ||
    data.hasMore === false
  ) {
    return null;
  }
  const raw = data.cursor ?? data.next_cursor ?? data.nextCursor;
  if (raw == null || raw === "") return null;
  if (data.has_more !== true && data.has_more !== 1 && data.hasMore !== true) {
    return null;
  }
  return String(raw);
}

function isRepeatedPage(seenPages, items, keyForItem) {
  const pageKey = JSON.stringify(
    items.map((item) => keyForItem(item) || JSON.stringify(item)),
  );
  if (seenPages.has(pageKey)) return true;
  seenPages.add(pageKey);
  return false;
}

function xhsNoteKey(note) {
  if (!note || typeof note !== "object") return null;
  const id = note.note_id || note.id;
  return id == null ? null : String(id);
}

function xhsUserKey(user) {
  if (!user || typeof user !== "object") return null;
  return user.user_id == null ? null : String(user.user_id);
}

module.exports = {
  XhsApiClient,
  _internals: {
    parseCount,
    normalizeMs,
    BROWSER_UA,
    BROWSER_HEADERS,
  },
};
