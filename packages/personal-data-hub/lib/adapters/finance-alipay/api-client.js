/**
 * AlipayApiClient — FAMILY-23 v0.1 cookie-scrape（无签名）。
 *
 * 支付宝 web cookie uid 不易直取（多走 session token）；v0.1 best-effort 从
 * alipay_uid / userId / loginUserId 抽数字 uid。账单/交易明细 走 v0.2（mobilegw
 * 接口 + 签名）。**高敏感**（涉资金）— 上行受 telemetry level + quiet hours 闸。
 */
"use strict";

class AlipayApiClient {
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
    for (const key of ["alipay_uid", "userId", "loginUserId"]) {
      const m = new RegExp(`(?:^|; ?)${key}=(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 alipay_uid / userId / loginUserId — 支付宝未登录或仅 session token",
    );
    return null;
  }
}

module.exports = { AlipayApiClient };
