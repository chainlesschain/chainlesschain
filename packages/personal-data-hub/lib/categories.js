/**
 * Shared adapter → category taxonomy for the PDH Vault Browser UI.
 *
 * Single source of truth consumed by:
 *   - packages/web-panel (desktop browser view)
 *   - packages/cli (cc hub search --category)
 *   - android-app (mirrored as Kotlin enum in PdhCategoryMap.kt; keep in sync)
 *
 * Categories are stable user-facing buckets (社交聊天 / 内容平台 / ...) — the
 * browser sidebar keys off these, not raw adapter names. New adapters get
 * mapped here once and surface in the right bucket on both shells.
 *
 * Matching is prefix-based by adapter name so we don't have to touch this
 * file for every adapter variant (e.g. `email-imap-qq`, `email-imap-gmail`).
 * First matching prefix wins; order in PREFIX_RULES matters for overlapping
 * prefixes (none today, but reserve the right).
 */

"use strict";

const CATEGORIES = Object.freeze([
  "chat",      // 即时通讯 / 私聊
  "social",    // 内容平台 / 短视频 / 微博
  "email",     // 邮件
  "shopping",  // 支付 / 订单 / 购物
  "travel",    // 出行 / 地图 / 票务
  "system",    // 系统数据（通讯录 / 应用列表）
  "ai-chat",   // AI 助手对话历史
  "other",     // 兜底
]);

const CATEGORY_LABELS = Object.freeze({
  chat:      "社交聊天",
  social:    "内容平台",
  email:     "邮件",
  shopping:  "支付订单",
  travel:    "出行",
  system:    "系统数据",
  "ai-chat": "AI 对话",
  other:     "其他",
});

// Ordered prefix → category rules. First match wins.
// Each entry: [prefixOrExact, category].
// Use a trailing `*` to mean "prefix match"; absent `*` means exact match.
const PREFIX_RULES = Object.freeze([
  ["wechat",          "chat"],
  ["messaging-*",     "chat"],
  ["social-*",        "social"],
  ["email-*",         "email"],
  ["shopping-*",      "shopping"],
  ["alipay-*",        "shopping"],
  ["travel-*",        "travel"],
  ["system-data*",    "system"],
  ["browser-*",       "system"],
  ["ai-chat-*",       "ai-chat"],
]);

/**
 * Map an adapter name to its category.
 * @param {string} adapterName  e.g. "social-bilibili" / "email-imap-qq" / "wechat"
 * @returns {string} category id from CATEGORIES (never throws — falls back to "other")
 */
function getCategory(adapterName) {
  if (typeof adapterName !== "string" || adapterName.length === 0) return "other";
  for (const [rule, cat] of PREFIX_RULES) {
    if (rule.endsWith("*")) {
      const prefix = rule.slice(0, -1);
      if (adapterName.startsWith(prefix)) return cat;
    } else if (adapterName === rule) {
      return cat;
    }
  }
  return "other";
}

/**
 * Group a list of adapter names by category. Returns
 * `{ [category]: string[] }` with empty categories omitted.
 */
function groupByCategory(adapterNames) {
  const out = {};
  for (const name of adapterNames || []) {
    const c = getCategory(name);
    (out[c] ||= []).push(name);
  }
  return out;
}

module.exports = {
  CATEGORIES,
  CATEGORY_LABELS,
  PREFIX_RULES,
  getCategory,
  groupByCategory,
};
