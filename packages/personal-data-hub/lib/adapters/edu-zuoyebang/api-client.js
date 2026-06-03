/**
 * ZuoyebangApiClient — FAMILY-23 v0.1 cookie-scrape（无签名）。
 *
 * 作业帮 session 主键是 ZYBUSS（不透明 token）；数字 uid 走 uid / student_id /
 * passport_uid。v0.1 仅 extractUid（学习/搜题历史 走 v0.2）。仅 ZYBUSS 无数字 uid
 * 时返 null（v0.1 不解 ZYBUSS）。
 */
"use strict";

class ZuoyebangApiClient {
  constructor() {
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
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
      "cookie 缺 uid / student_id / passport_uid — 作业帮未登录 (仅 ZYBUSS 不透明 token, v0.1 不解)",
    );
    return null;
  }
}

module.exports = { ZuoyebangApiClient };
