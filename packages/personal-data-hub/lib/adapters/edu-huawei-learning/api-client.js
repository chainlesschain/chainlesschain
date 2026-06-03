/**
 * HuaweiLearningApiClient — FAMILY-23 v0.1 cookie-scrape（无签名）。
 *
 * 华为学习中心走华为账号登录；v0.1 从 accountId / userId / huaweiUid 抽数字 uid。
 * 课程/学习时长 走 v0.2（华为教育接口 + 账号签名）。
 */
"use strict";

class HuaweiLearningApiClient {
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
}

module.exports = { HuaweiLearningApiClient };
