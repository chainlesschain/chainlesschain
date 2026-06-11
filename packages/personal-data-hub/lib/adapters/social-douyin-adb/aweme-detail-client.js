/**
 * AwemeDetailClient — resolves Douyin aweme (video) ids to human-readable
 * metadata (desc / author / duration) so watch-history events show WHAT was
 * watched, not just an id.
 *
 * Real-device finding 2026-06-11: the web detail endpoint
 *   https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=<id>
 *     &device_platform=webapp&aid=6383&channel=channel_pc_web
 * returns HTTP 200 + full `aweme_detail` JSON (desc, author.nickname, duration,
 * create_time) with **just a browser UA + Referer — no X-Bogus / cookie / msToken**
 * for this guest request shape. So title resolution is a plain HTTP client, not a
 * sign-bridge. (If Douyin later enforces signing here, this becomes the seam to
 * route through a DouyinSignBridge — same pattern as toutiao/xhs.)
 *
 * Rate-friendly: dedups ids, caps per run, sleeps between calls, fails soft per
 * id (an unresolved id just keeps "(no title)" — never aborts the sync).
 */
"use strict";

const DEFAULT_BASE_URL = "https://www.douyin.com";
const BROWSER_HEADERS = Object.freeze({
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.douyin.com/",
  "Accept-Language": "zh-CN,zh;q=0.9",
});

class AwemeDetailClient {
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._fetch =
      opts.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    this._sleep =
      opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.delayMs = Number.isFinite(opts.delayMs) ? opts.delayMs : 200;
    this.lastErrorCode = 0;
    this.lastErrorMessage = null;
  }

  _setErr(code, msg) {
    this.lastErrorCode = code;
    this.lastErrorMessage = msg;
  }

  /**
   * Resolve one aweme id → {awemeId, desc, author, durationMs, createTime} or
   * null on any error (sets lastError).
   */
  async fetchDetail(aid) {
    if (typeof this._fetch !== "function") {
      this._setErr(-2, "AwemeDetailClient: fetch not available — pass opts.fetch or run on Node 18+");
      return null;
    }
    const url =
      `${this.baseUrl}/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(String(aid))}` +
      `&device_platform=webapp&aid=6383&channel=channel_pc_web`;
    let resp;
    try {
      resp = await this._fetch(url, { method: "GET", headers: { ...BROWSER_HEADERS } });
    } catch (e) {
      this._setErr(-4, "network: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    const body = await resp.text();
    if (!resp.ok) {
      this._setErr(resp.status, `HTTP ${resp.status}`);
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(body);
    } catch (e) {
      this._setErr(-3, "parse: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    const code = typeof obj.status_code === "number" ? obj.status_code : 0;
    if (code !== 0) {
      this._setErr(code, (obj.status_msg || `status_code=${code}`).toString());
      return null;
    }
    const d = obj.aweme_detail;
    if (!d || typeof d !== "object") {
      this._setErr(-5, "no aweme_detail (deleted/private video?)");
      return null;
    }
    this._setErr(0, null);
    return {
      awemeId: String(aid),
      desc: d.desc || null,
      author: (d.author && d.author.nickname) || null,
      durationMs: Number.isFinite(d.duration) ? d.duration : null,
      createTime: Number.isFinite(d.create_time) ? d.create_time : null,
    };
  }

  /**
   * Resolve many ids → Map<aid, detail>. Dedups, caps at `limit`, sleeps
   * `delayMs` between calls. Per-id failures are skipped (not in the map).
   * @param {string[]} aids
   * @param {{limit?: number}} [opts]
   */
  async resolveMany(aids, opts = {}) {
    const uniq = [...new Set((aids || []).map(String))];
    const cap = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : uniq.length;
    const out = new Map();
    let n = 0;
    for (const aid of uniq) {
      if (n >= cap) break;
      const d = await this.fetchDetail(aid);
      n += 1;
      if (d) out.set(aid, d);
      if (this.delayMs > 0 && n < cap) await this._sleep(this.delayMs);
    }
    return out;
  }
}

module.exports = { AwemeDetailClient, BROWSER_HEADERS };
