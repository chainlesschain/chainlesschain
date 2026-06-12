/**
 * ZuoyebangApiClient — FAMILY-23 作业帮采集客户端。
 *
 * 作业帮 session 主键是 ZYBUSS（不透明 token）；数字 uid 走 uid / student_id /
 * passport_uid。v0.1 仅 cookie-scrape（extractUid）。**v0.2 接通 live HTTP
 * fetcher**：cookie（ZYBUSS 会话）直拉 用户信息 + 学习/搜题记录。
 *
 * ⚠️ **best-effort**：作业帮 web 接口无公开稳定文档，下方端点/字段按其 web 端
 *    常见形态实现（envelope `{errNo, errstr, data}`），做了多字段名兼容（pick
 *    回退），**未经真实登录态实地验证** — 端点/字段漂移时改常量 / opts 覆盖
 *    （同 SignProvider 轮转思路）。
 *
 * Cookie key 优先级 (extractUid): uid > student_id > passport_uid。
 * live 模式仅需 ZYBUSS 在场即可（uid 由 user-info 接口返回）。
 */
"use strict";

const { pick, toDurationMs, toEpochMs } = require("../_live-json-helpers");

const DEFAULT_BASE_URL = "https://www.zuoyebang.com";
// 端点（best-effort，可经 opts 覆盖）。
const PATH_USER_INFO = "/session/pc/getuserinfo";
const PATH_STUDY_RECORDS = "/study/pc/record/list";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

class ZuoyebangApiClient {
  constructor(opts = {}) {
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
    this._fetch =
      opts.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.userInfoPath = opts.userInfoPath || PATH_USER_INFO;
    this.studyRecordsPath = opts.studyRecordsPath || PATH_STUDY_RECORDS;
  }
  _setLastError(code, msg) {
    this._lastErrorCode = code;
    this._lastErrorMsg = msg;
  }
  _clearLastError() {
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
  }
  get lastError() {
    return { code: this._lastErrorCode, message: this._lastErrorMsg };
  }

  /** @param {string} cookie @returns {string|null} */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    for (const key of ["uid", "student_id", "passport_uid"]) {
      const m = new RegExp(`(?:^|; ?)${key}=(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 uid / student_id / passport_uid — 作业帮未登录 (仅 ZYBUSS 不透明 token, extractUid 不解)",
    );
    return null;
  }

  /**
   * live 模式会话探测：ZYBUSS 在场（uid 可由接口拿）或数字 uid 可抽即视为有会话。
   * @param {string} cookie @returns {boolean}
   */
  hasSession(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) return false;
    if (/(?:^|; ?)ZYBUSS=[^;\s]+/.test(cookie)) return true;
    const uid = this.extractUid(cookie);
    if (uid) return true;
    this._setLastError(-7, "cookie 缺 ZYBUSS 且无数字 uid — 作业帮未登录");
    return false;
  }

  _headers(cookie) {
    return {
      Cookie: cookie,
      "User-Agent": BROWSER_UA,
      Referer: `${this.baseUrl}/`,
      Accept: "application/json",
    };
  }

  /**
   * GET <url> with cookie. Parses the zuoyebang web envelope
   * `{ errNo, errstr, data }` (errNo 0 = ok). Returns `data` on success,
   * null on transport / API error (sets lastError).
   */
  async _doGetJson(url, cookie) {
    if (typeof this._fetch !== "function") {
      this._setLastError(
        -2,
        "ZuoyebangApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
      return null;
    }
    let resp;
    try {
      resp = await this._fetch(url, { method: "GET", headers: this._headers(cookie) });
    } catch (e) {
      this._setLastError(-4, "network: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    const txt = await resp.text();
    if (!resp.ok) {
      this._setLastError(resp.status, `HTTP ${resp.status}`);
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(txt);
    } catch (e) {
      this._setLastError(-3, "parse: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    const code = pick(obj, ["errNo", "errno", "code"], 0);
    if (Number(code) !== 0) {
      this._setLastError(
        Number(code),
        pick(obj, ["errstr", "errStr", "errmsg", "errMsg", "msg"], `errNo ${code}`).toString(),
      );
      return null;
    }
    this._clearLastError();
    return obj.data !== undefined && obj.data !== null ? obj.data : obj;
  }

  /** 用户信息 → { uid, nickname, grade } or null. */
  async getUserInfo(cookie) {
    const data = await this._doGetJson(`${this.baseUrl}${this.userInfoPath}`, cookie);
    if (data === null) return null;
    // web 端常把用户体包在 data.user / data.userInfo 下，或直接平铺。
    const u = pick(data, ["user", "userInfo", "loginUser"], data);
    const uid = pick(u, ["uid", "userId", "studentUid", "cuid"]);
    return {
      uid: uid != null ? String(uid) : null,
      nickname: pick(u, ["uname", "nickName", "nickname", "userName", "name"]),
      grade: pick(u, ["gradeName", "grade", "gradeId"]),
    };
  }

  /**
   * 学习/搜题记录 → [{ recordId, subject, durationMs, startAt }]. null on error.
   * @param {string} cookie
   * @param {object} [opts] { limit, offset }
   */
  async getStudyRecords(cookie, opts = {}) {
    const rn = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20;
    const pn = Number.isInteger(opts.offset) && opts.offset > 0 ? opts.offset : 0;
    const url = `${this.baseUrl}${this.studyRecordsPath}?pn=${pn}&rn=${rn}`;
    const data = await this._doGetJson(url, cookie);
    if (data === null) return null;
    const list = pick(data, ["list", "records", "items"], Array.isArray(data) ? data : []);
    if (!Array.isArray(list)) return [];
    return list.map((r) => ({
      recordId: pick(r, ["recordId", "logId", "id"]),
      subject: pick(r, ["subjectName", "subject", "courseName", "course"]),
      durationMs: toDurationMs(pick(r, ["studyTime", "duration", "learnTime", "durationMs"], 0)),
      startAt: toEpochMs(pick(r, ["startTime", "beginTime", "createTime", "time"])),
    }));
  }

  /**
   * High-level: user info + study records → snapshot-shaped { account, events }
   * so the adapter normalize path is unchanged.
   * @returns {Promise<{account, events}|null>}
   */
  async fetchSnapshot(cookie, opts = {}) {
    if (!this.hasSession(cookie)) return null; // lastError already set
    const include = opts.include || {};
    const events = [];
    let account = null;

    if (include.profile !== false) {
      const user = await this.getUserInfo(cookie);
      if (user === null) return null;
      account = { uid: user.uid, displayName: user.nickname };
      events.push({
        kind: "profile",
        id: user.uid ? `profile-${user.uid}` : null,
        uid: user.uid,
        nickname: user.nickname,
        grade: user.grade,
      });
    }

    if (include.study !== false) {
      const records = await this.getStudyRecords(cookie, {
        limit: opts.limit,
        offset: opts.offset,
      });
      if (records === null) return null;
      for (const r of records) {
        events.push({
          kind: "study",
          id: r.recordId ? `study-${r.recordId}` : null,
          subject: r.subject,
          durationMs: r.durationMs,
          startAt: r.startAt,
        });
      }
    }

    this._clearLastError();
    return { account, events };
  }
}

module.exports = {
  ZuoyebangApiClient,
  // Exported for tests / endpoint introspection.
  PATH_USER_INFO,
  PATH_STUDY_RECORDS,
};
