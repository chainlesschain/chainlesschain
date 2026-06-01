/**
 * HonorOfKingsApiClient — FAMILY-23 v0.1 cookie-scrape（无签名）。
 *
 * 王者荣耀走腾讯系登录（微信/QQ openid 或营地 gamehelper cookie）；v0.1 仅从
 * cookie 抽 uid（extractUid），战绩/对局时长 走 v0.2（营地接口 + 腾讯签名）。
 * Cookie key 优先级: openid > uin(QQ号) > tencent_uid。
 */
"use strict";

class HonorOfKingsApiClient {
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
    // openid 是字母数字混合; uin / tencent_uid 是纯数字。
    const openid = /(?:^|; ?)openid=([A-Za-z0-9_-]+)/.exec(cookie);
    if (openid && openid[1] && openid[1].length >= 8) {
      this._clearLastError();
      return openid[1];
    }
    for (const key of ["uin", "tencent_uid"]) {
      const m = new RegExp(`(?:^|; ?)${key}=o?0*(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 openid / uin / tencent_uid — 营地/微信/QQ 未登录",
    );
    return null;
  }
}

module.exports = { HonorOfKingsApiClient };
