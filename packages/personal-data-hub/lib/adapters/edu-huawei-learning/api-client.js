/**
 * HuaweiLearningApiClient — FAMILY-23 华为学习中心采集客户端。
 *
 * 华为学习中心走华为账号登录；v0.1 仅 cookie-scrape（extractUid，从 accountId /
 * userId / huaweiUid 抽数字 uid）。**v0.2 接通 live HTTP fetcher**：cookie（华为
 * 账号 web 会话）直拉 用户信息 + 课程学习记录（课程名 / 学习时长）。
 *
 * ⚠️ **best-effort**：学习中心接口无公开稳定文档，下方端点/字段按 hicloud 教育
 *    服务常见形态实现（envelope `{code|resultCode, message, data}`，0 = ok），
 *    做了多字段名兼容（pick 回退），**未经真实华为账号登录态实地验证** —
 *    端点/字段漂移时改常量 / opts 覆盖（同 SignProvider 轮转思路）。
 */
"use strict";

const { pick, toDurationMs, toEpochMs } = require("../_live-json-helpers");

const DEFAULT_BASE_URL = "https://educenter.hicloud.com";
// 端点（best-effort，可经 opts 覆盖）。
const PATH_USER_INFO = "/edu/api/user/v1/info";
const PATH_STUDY_RECORDS = "/edu/api/study/v1/records";

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 12; HarmonyOS) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36";

class HuaweiLearningApiClient {
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
    for (const key of ["accountId", "userId", "huaweiUid"]) {
      const m = new RegExp(`(?:^|; ?)${key}=(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 accountId / userId / huaweiUid — 华为账号未登录",
    );
    return null;
  }

  /**
   * live 模式会话探测：华为账号 web 会话 key 形态不稳定（CAS / OAuth 多变体），
   * 宽松判定 — 有任意 `k=v` 形态的非空 cookie 即放行，真伪交给服务端校验。
   * @param {string} cookie @returns {boolean}
   */
  hasSession(cookie) {
    if (typeof cookie !== "string" || !/[^=;\s]+=[^;\s]+/.test(cookie)) {
      this._setLastError(-7, "cookie 为空或非法 — 华为账号未登录");
      return false;
    }
    this._clearLastError();
    return true;
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
   * GET <url> with cookie. Parses `{ code|resultCode, message, data }`
   * (0 = ok). Returns `data` on success, null on error (sets lastError).
   */
  async _doGetJson(url, cookie) {
    if (typeof this._fetch !== "function") {
      this._setLastError(
        -2,
        "HuaweiLearningApiClient: fetch not available — pass opts.fetch or run on Node 18+",
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
    const code = pick(obj, ["code", "resultCode", "errorCode"], 0);
    if (Number(code) !== 0) {
      this._setLastError(
        Number(code),
        pick(obj, ["message", "msg", "desc", "errorMsg"], `code ${code}`).toString(),
      );
      return null;
    }
    this._clearLastError();
    const data = pick(obj, ["data", "result", "value"]);
    return data !== null ? data : obj;
  }

  /** 用户信息 → { uid, nickname } or null. */
  async getUserInfo(cookie) {
    const data = await this._doGetJson(`${this.baseUrl}${this.userInfoPath}`, cookie);
    if (data === null) return null;
    const u = pick(data, ["user", "userInfo", "account"], data);
    const uid = pick(u, ["uid", "userId", "accountId"]);
    return {
      uid: uid != null ? String(uid) : null,
      nickname: pick(u, ["nickName", "nickname", "displayName", "userName", "name"]),
    };
  }

  /**
   * 课程学习记录 → [{ recordId, course, durationMs, startAt }]. null on error.
   * @param {string} cookie
   * @param {object} [opts] { limit, offset }
   */
  async getStudyRecords(cookie, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20;
    const offset = Number.isInteger(opts.offset) && opts.offset > 0 ? opts.offset : 0;
    const url = `${this.baseUrl}${this.studyRecordsPath}?offset=${offset}&limit=${limit}`;
    const data = await this._doGetJson(url, cookie);
    if (data === null) return null;
    const list = pick(data, ["records", "list", "items"], Array.isArray(data) ? data : []);
    if (!Array.isArray(list)) return [];
    return list.map((r) => ({
      recordId: pick(r, ["recordId", "id", "logId"]),
      course: pick(r, ["courseName", "course", "title", "name"]),
      durationMs: toDurationMs(
        pick(r, ["studyDuration", "duration", "learnTime", "durationMs"], 0),
      ),
      startAt: toEpochMs(pick(r, ["startTime", "studyTime", "createTime", "beginTime"])),
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
          course: r.course,
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
  HuaweiLearningApiClient,
  // Exported for tests / endpoint introspection.
  PATH_USER_INFO,
  PATH_STUDY_RECORDS,
};
