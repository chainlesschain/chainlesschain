/**
 * 通义千问 (Aliyun Tongyi) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.3
 *   - login https://tongyi.aliyun.com/
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "tongyi",
  displayName: "通义千问",
  androidPackage: "com.aliyun.tongyi",
  loginUrl: "https://tongyi.aliyun.com/",
  cookieDomains: ["tongyi.aliyun.com", ".aliyun.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("tongyi", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("tongyi", "listMessages");
  },
};

module.exports = { SPEC };
