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

const DEFAULT_BASE_URL = "https://edith.xiaohongshu.com/";

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

  async _doGetJson(url, cookie, a1, requireSign) {
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
        return null;
      }
      const code = typeof obj.code === "number" ? obj.code : 0;
      if (code !== 0) {
        this._setLastError(code, (obj.msg || "").toString());
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
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 30;
    const url = new URL("api/sns/web/v2/user_posted", this.baseUrl);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("num", "30");
    url.searchParams.set("cursor", "");
    url.searchParams.set("image_formats", "jpg,webp,avif");
    const obj = await this._doGetJson(url, cookie, a1, true);
    if (!obj) return [];
    const data = obj.data || {};
    const notes = Array.isArray(data.notes) ? data.notes : [];
    const out = [];
    for (let i = 0; i < Math.min(limit, notes.length); i++) {
      const n = notes[i];
      if (!n) continue;
      const noteId =
        (n.note_id && String(n.note_id)) || (n.id && String(n.id));
      if (!noteId) continue;
      const interact = n.interact_info || {};
      out.push({
        noteId,
        title:
          n.display_title ||
          n.title ||
          "(no title)",
        desc: n.desc || null,
        type: n.type || "normal",
        createdAt: normalizeMs(typeof n.time === "number" ? n.time : 0),
        likedCount: parseCount(interact.liked_count),
        collectedCount: parseCount(interact.collected_count),
        commentCount: parseCount(interact.comment_count),
      });
    }
    return out;
  }

  /**
   * Fetch user's liked notes. Requires X-S.
   */
  async fetchLiked(cookie, a1, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 30;
    const url = new URL("api/sns/web/v1/note/like/page", this.baseUrl);
    url.searchParams.set("num", "20");
    url.searchParams.set("cursor", "");
    const obj = await this._doGetJson(url, cookie, a1, true);
    if (!obj) return [];
    const data = obj.data || {};
    const notes = Array.isArray(data.notes) ? data.notes : [];
    const out = [];
    for (let i = 0; i < Math.min(limit, notes.length); i++) {
      const n = notes[i];
      if (!n) continue;
      const noteId = n.note_id && String(n.note_id);
      if (!noteId) continue;
      const user = n.user || {};
      out.push({
        noteId,
        title: n.display_title || n.title || "(no title)",
        // xhs doesn't return explicit liked_at — collector fills with snapshotted_at
        likedAt: 0,
        authorNickname: user.nickname || null,
      });
    }
    return out;
  }

  /**
   * Fetch follow list. Requires X-S.
   */
  async fetchFollows(cookie, a1, userId, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 100;
    const url = new URL("api/sns/web/v1/user/follow/list", this.baseUrl);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("num", "20");
    url.searchParams.set("cursor", "");
    const obj = await this._doGetJson(url, cookie, a1, true);
    if (!obj) return [];
    const data = obj.data || {};
    const users = Array.isArray(data.users) ? data.users : [];
    const out = [];
    for (let i = 0; i < Math.min(limit, users.length); i++) {
      const u = users[i];
      if (!u) continue;
      const userIdStr = u.user_id && String(u.user_id);
      if (!userIdStr) continue;
      out.push({
        userId: userIdStr,
        nickname: u.nickname || "(unnamed)",
        image: u.image || null,
        // xhs doesn't return explicit follow time
        followedAt: 0,
      });
    }
    return out;
  }
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
