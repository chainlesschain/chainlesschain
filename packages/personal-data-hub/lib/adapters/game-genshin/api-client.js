/**
 * GenshinApiClient — FAMILY-23 v0.1 cookie-scrape（无签名）。
 *
 * 原神 / 米哈游通行证 (HoYoLAB / 米游社) 走 cookie 鉴权；v0.1 仅从 cookie 抽 uid
 * (extractUid)，不做 HTTP fetcher（历史战绩 / 游戏时长 走 v0.2 通过 takumi/hk4e
 * 接口 + DS 签名）。镜像 social-toutiao-adb/api-client.js 的 extractUid 形态。
 *
 * Cookie key 优先级 (米游社 2023+ → 旧版):
 *   account_id_v2 > ltuid_v2 > account_id > ltuid
 */
"use strict";

class GenshinApiClient {
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

  /**
   * 从 cookie 串抽米哈游通行证 uid。失败返 null + 设 lastError。
   * @param {string} cookie 形如 "account_id_v2=12345; ltoken_v2=...; ..."
   * @returns {string|null}
   */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const keys = ["account_id_v2", "ltuid_v2", "account_id", "ltuid"];
    for (const key of keys) {
      const m = new RegExp(`(?:^|; ?)${key}=(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 account_id_v2 / ltuid_v2 / account_id / ltuid — 米游社未登录或仅游客态",
    );
    return null;
  }
}

module.exports = { GenshinApiClient };
