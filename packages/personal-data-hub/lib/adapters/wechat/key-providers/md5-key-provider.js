/**
 * Phase 12.6.1 — MD5KeyProvider (v0.5 legacy WeChat < 8.0 path).
 *
 * Wraps the existing key-extractor.js (MD5(IMEI+UIN)[:7] lowercase)
 * behind the KeyProvider interface. Pure frida-independent: works from
 * a pulled WeChat data directory (`adb pull /data/data/com.tencent.mm/`).
 *
 * Usage:
 *   const provider = new MD5KeyProvider({
 *     wechatDataPath: "/tmp/com.tencent.mm",
 *     // optional manual overrides for testing or when CompatibleInfo.cfg
 *     // parsing fails
 *     uin: "1234567890",
 *     imei: "1234567890abcdef",
 *   });
 *   const key = await provider.getKey();
 */
"use strict";

const { KeyProvider } = require("./key-provider-base");
const { extractWeChatKey } = require("../key-extractor");

class MD5KeyProvider extends KeyProvider {
  /**
   * @param {object} opts
   * @param {string} opts.wechatDataPath  directory mirroring the pulled
   *                                       /data/data/com.tencent.mm/ tree
   * @param {string} [opts.uin]            override (skip auth XML parse)
   * @param {string} [opts.imei]           override (skip CompatibleInfo)
   * @param {Function} [opts.extractor]    DI seam — defaults to
   *                                       extractWeChatKey
   */
  constructor(opts = {}) {
    super();
    if (!opts || typeof opts !== "object") {
      throw new Error("MD5KeyProvider: opts required");
    }
    if (!opts.wechatDataPath || typeof opts.wechatDataPath !== "string") {
      throw new Error("MD5KeyProvider: opts.wechatDataPath required");
    }
    this._wechatDataPath = opts.wechatDataPath;
    this._uinOverride = opts.uin || null;
    this._imeiOverride = opts.imei || null;
    this._extractor = typeof opts.extractor === "function"
      ? opts.extractor
      : extractWeChatKey;
    this._lastResult = null;
  }

  get name() {
    return "md5";
  }

  /**
   * @returns {Promise<string>}  7-char lowercase hex MD5 prefix
   */
  async getKey() {
    const result = this._extractor({
      wechatDataPath: this._wechatDataPath,
      uin: this._uinOverride,
      imei: this._imeiOverride,
    });
    this._lastResult = result;
    if (!result || !result.key) {
      const warnings = (result && result.warnings) || [];
      const reason = warnings.length > 0 ? warnings.join("; ") : "key extraction returned empty";
      throw new Error(`MD5KeyProvider.getKey: ${reason}`);
    }
    return result.key;
  }

  /**
   * Last extraction result for telemetry / debugging — exposes uin /
   * imei sources and warnings. Returns null until getKey() called.
   */
  getLastResult() {
    return this._lastResult;
  }
}

module.exports = { MD5KeyProvider };
