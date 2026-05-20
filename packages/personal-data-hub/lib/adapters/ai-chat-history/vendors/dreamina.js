/**
 * Dreamina (ByteDance AI image / video) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.8
 *   - login https://dreamina.capcut.com/  (海外) / https://jimeng.jianying.com/  (国内即梦)
 *   - 每条消息的 generatedImages[] 已在 schema-map 处理为 Item(subtype=media)
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "dreamina",
  displayName: "Dreamina",
  androidPackage: "com.bytedance.dreamina",
  loginUrl: "https://jimeng.jianying.com/",
  cookieDomains: ["jimeng.jianying.com", ".jianying.com"],
  rateLimits: { perMinute: 15, minIntervalMs: 2500 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("dreamina", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("dreamina", "listMessages");
  },
};

module.exports = { SPEC };
