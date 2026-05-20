/**
 * Kimi (Moonshot) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.2
 *   - login https://kimi.moonshot.cn/
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "kimi",
  displayName: "Kimi",
  androidPackage: "com.moonshot.kimichat",
  loginUrl: "https://kimi.moonshot.cn/",
  cookieDomains: ["kimi.moonshot.cn", ".moonshot.cn"],
  rateLimits: { perMinute: 30, minIntervalMs: 1500 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("kimi", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("kimi", "listMessages");
  },
};

module.exports = { SPEC };
