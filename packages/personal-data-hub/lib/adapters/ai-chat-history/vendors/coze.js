/**
 * 扣子 (Coze, ByteDance) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.7
 *   - login https://www.coze.cn/
 *   - 扣子 agent message 含 toolCalls，schema-map 已留 extra.toolCalls 字段
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "coze",
  displayName: "扣子",
  androidPackage: "com.coze.space",
  loginUrl: "https://www.coze.cn/",
  // Coze uses two cookie domains (www + sf-cdn assets); session creds live on
  // www.coze.cn so that's the only one we filter by in `applyTo(headers, ...)`.
  cookieDomains: ["www.coze.cn", ".coze.cn"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("coze", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("coze", "listMessages");
  },
};

module.exports = { SPEC };
