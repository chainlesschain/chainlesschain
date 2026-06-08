"use strict";

/**
 * 微信读书 (WeRead) web API client — cookie-based.
 *
 * Reuses the AI-chat HttpClient (cookie inject + rate-limit + retry +
 * injectable fetch test seam). WeRead's app API host `i.weread.qq.com`
 * accepts the web login cookie (key cookies: wr_vid, wr_skey, wr_name).
 *
 * Endpoints (community-documented; best-effort v0.1 — WeRead occasionally
 * rotates params / adds light signing on some routes, so each method is
 * defensive and a failing endpoint degrades to an empty list rather than
 * aborting the whole sync):
 *
 *   GET /user/notebooks                 → 有笔记/划线的书 (notebooks)
 *   GET /book/bookmarklist?bookId=      → 划线 (highlights)
 *   GET /review/list?bookId=&listType=11&mine=1&synckey=0 → 想法 (reviews)
 *   GET /readdata/summary?synckey=0     → 阅读时长汇总 (best-effort)
 *
 * The `wr_skey` cookie expires (~hours/days); a 401/403 surfaces as
 * CookieExpiredError so the UI can prompt re-login.
 */

const { HttpClient, CookieExpiredError } = require("../ai-chat-history/http-client");

const DEFAULT_BASE = "https://i.weread.qq.com";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

class WeReadApiClient {
  /**
   * @param {object} opts
   * @param {string} opts.cookie            WeRead cookie header string.
   * @param {string} [opts.baseUrl]         API host. Default i.weread.qq.com.
   * @param {function} [opts.fetch]         Fetch override (test seam).
   * @param {object} [opts.rateLimits]
   */
  constructor(opts = {}) {
    if (typeof opts.cookie !== "string" || opts.cookie.length === 0) {
      throw new Error("WeReadApiClient: opts.cookie required");
    }
    this._cookie = opts.cookie;
    this._base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this._http = new HttpClient({
      vendor: "weread",
      fetch: opts.fetch,
      rateLimits: opts.rateLimits || { perMinute: 30, minIntervalMs: 1200 },
    });
    this.lastErrorCode = null;
  }

  _headers() {
    return { Cookie: this._cookie, "User-Agent": DEFAULT_UA, Accept: "application/json" };
  }

  async _get(path) {
    try {
      return await this._http.getJson(`${this._base}${path}`, { headers: this._headers() });
    } catch (err) {
      if (err instanceof CookieExpiredError) {
        this.lastErrorCode = "COOKIE_EXPIRED";
        throw err;
      }
      this.lastErrorCode = err && err.message ? err.message : String(err);
      return null; // degrade — caller treats as empty
    }
  }

  /** Books that have notes/highlights. Returns array of {bookId, title, author, cover, noteCount, reviewCount}. */
  async getNotebooks() {
    const data = await this._get("/user/notebooks");
    const books = (data && Array.isArray(data.books) && data.books) || [];
    return books.map((b) => {
      const book = b.book || b;
      return {
        bookId: String(b.bookId || book.bookId || ""),
        title: book.title || "(未知书名)",
        author: book.author || null,
        cover: book.cover || null,
        category: book.category || null,
        noteCount: b.noteCount != null ? b.noteCount : null,
        reviewCount: b.reviewCount != null ? b.reviewCount : null,
        bookmarkCount: b.bookmarkCount != null ? b.bookmarkCount : null,
        sort: b.sort != null ? b.sort : null,
      };
    });
  }

  /** Highlights (划线) for one book. */
  async getBookmarks(bookId) {
    const data = await this._get(`/book/bookmarklist?bookId=${encodeURIComponent(bookId)}`);
    const rows = (data && (data.updated || data.bookmarks)) || [];
    return (Array.isArray(rows) ? rows : []).map((m) => ({
      bookmarkId: String(m.bookmarkId || ""),
      bookId: String(m.bookId || bookId),
      chapterTitle: m.chapterTitle || m.chapterName || null,
      chapterUid: m.chapterUid != null ? m.chapterUid : null,
      markText: m.markText || "",
      createTime: m.createTime != null ? m.createTime : null,
    }));
  }

  /** Reviews / thoughts (想法) for one book. */
  async getReviews(bookId) {
    const data = await this._get(
      `/review/list?bookId=${encodeURIComponent(bookId)}&listType=11&mine=1&synckey=0`,
    );
    const rows = (data && data.reviews) || [];
    return (Array.isArray(rows) ? rows : []).map((r) => {
      const rev = r.review || r;
      return {
        reviewId: String(rev.reviewId || ""),
        bookId: String(rev.bookId || bookId),
        content: rev.content || "",
        chapterTitle: rev.chapterTitle || null,
        createTime: rev.createTime != null ? rev.createTime : null,
        abstract: rev.abstract || null,
      };
    });
  }

  /** Reading-time summary (best-effort; shape varies). Returns raw object or null. */
  async getReadSummary() {
    return await this._get("/readdata/summary?synckey=0");
  }
}

module.exports = { WeReadApiClient, DEFAULT_BASE };
