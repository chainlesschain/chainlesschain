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
