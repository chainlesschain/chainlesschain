/**
 * 智谱清言 (Zhipu Qingyan) vendor spec — Phase 10.1 skeleton.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.4
 *   - login https://chatglm.cn/
 */

"use strict";

const { NotImplementedYetError } = require("../vendor-spec");

const SPEC = {
  name: "zhipu",
  displayName: "智谱清言",
  androidPackage: "com.zhipuai.qingyan",
  loginUrl: "https://chatglm.cn/",
  cookieDomains: ["chatglm.cn", ".chatglm.cn"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  async validateCookie(_ctx) {
    return { ok: false, reason: "VENDOR_NOT_WIRED" };
  },

  // eslint-disable-next-line require-yield
  async *listConversations(_ctx, _opts) {
    throw new NotImplementedYetError("zhipu", "listConversations");
  },

  // eslint-disable-next-line require-yield
  async *listMessages(_ctx, _conversationId, _opts) {
    throw new NotImplementedYetError("zhipu", "listMessages");
  },
};

module.exports = { SPEC };
