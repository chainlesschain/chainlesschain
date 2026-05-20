/**
 * 百度千帆 (Baidu Qianfan) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.6
 *   - login https://chat.baidu.com/
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "qianfan",
  displayName: "百度千帆",
  androidPackage: "com.baidu.qianfan.llmkitchat",
  loginUrl: "https://chat.baidu.com/",
  cookieDomains: ["chat.baidu.com", ".baidu.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("qianfan", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("qianfan", "listMessages");
  },
};

module.exports = { SPEC };
