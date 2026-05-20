/**
 * DeepSeek vendor spec.
 *
 * Phase 10.1 skeleton — listConversations / listMessages throw VENDOR_NOT_WIRED.
 * Wiring lands in Phase 10.2 alongside cookie auth + h5 API signature work.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.1
 *   - login   https://chat.deepseek.com/
 *   - convs   GET /api/v0/chat_session/fetch_page?count=N&before=<cursor>
 *   - msgs    GET /api/v0/chat/history_messages?chat_session_id=<id>
 *   - cookies userToken / session cookie
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "deepseek",
  displayName: "DeepSeek",
  androidPackage: "com.deepseek.chat",
  loginUrl: "https://chat.deepseek.com/",
  cookieDomains: ["chat.deepseek.com", ".deepseek.com"],
  rateLimits: { perMinute: 30, minIntervalMs: 1500 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("deepseek", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("deepseek", "listMessages");
  },
};

module.exports = { SPEC };
