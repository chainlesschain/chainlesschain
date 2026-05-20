/**
 * 腾讯混元 / 元宝 (Tencent Hunyuan / Yuanbao) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.5
 *   - login https://yuanbao.tencent.com/
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "hunyuan",
  displayName: "腾讯元宝",
  androidPackage: "com.tencent.hunyuan.app.chat",
  loginUrl: "https://yuanbao.tencent.com/",
  cookieDomains: ["yuanbao.tencent.com", ".tencent.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("hunyuan", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("hunyuan", "listMessages");
  },
};

module.exports = { SPEC };
