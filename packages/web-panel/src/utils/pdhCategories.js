/**
 * PDH Vault Browser — adapter category labels (frontend mirror).
 *
 * Backend `getCategory()` lives in @chainlesschain/personal-data-hub/categories
 * and is consulted in vault.searchEvents + facetCounts to map adapters to
 * these buckets. The frontend only needs the labels (Chinese display names)
 * + ordering for the sidebar. New buckets: add the id here AND in the
 * backend categories.js (single source of truth for the mapping logic;
 * UI labels are display-only and need to be kept consistent manually).
 */

export const CATEGORIES = Object.freeze([
  "chat",
  "social",
  "email",
  "shopping",
  "travel",
  "system",
  "ai-chat",
  "other",
]);

export const CATEGORY_LABELS = Object.freeze({
  chat: "社交聊天",
  social: "内容平台",
  email: "邮件",
  shopping: "支付订单",
  travel: "出行",
  system: "系统数据",
  "ai-chat": "AI 对话",
  other: "其他",
});

export const CATEGORY_ICONS = Object.freeze({
  chat: "MessageOutlined",
  social: "PlayCircleOutlined",
  email: "MailOutlined",
  shopping: "ShoppingOutlined",
  travel: "CarOutlined",
  system: "MobileOutlined",
  "ai-chat": "RobotOutlined",
  other: "AppstoreOutlined",
});

export function categoryLabel(id) {
  return CATEGORY_LABELS[id] || id || "未知";
}

// Adapter → category mapping (mirror of packages/personal-data-hub/lib/categories.js
// PREFIX_RULES). Kept in sync manually — backend categories.js is single source
// of truth for the matching logic; this duplicate is here only so the
// renderer dispatcher can decide which Vue component to render per event
// without an extra round-trip. Adding a new prefix? Update BOTH.
const PREFIX_RULES = Object.freeze([
  ["wechat",          "chat"],
  ["messaging-",      "chat"],
  ["social-",         "social"],
  ["email-",          "email"],
  ["shopping-",       "shopping"],
  ["alipay-",         "shopping"],
  ["travel-",         "travel"],
  ["system-data",     "system"],
  ["browser-",        "system"],
  ["vscode",          "system"],
  ["win-recent",      "system"],
  ["git-activity",    "system"],
  ["shell-history",   "system"],
  ["ai-chat-",        "ai-chat"],
]);

export function getCategory(adapterName) {
  if (typeof adapterName !== "string" || adapterName.length === 0) return "other";
  for (const [pre, cat] of PREFIX_RULES) {
    if (pre.endsWith("-") || pre === "system-data") {
      if (adapterName.startsWith(pre)) return cat;
    } else if (adapterName === pre) {
      return cat;
    }
  }
  return "other";
}
