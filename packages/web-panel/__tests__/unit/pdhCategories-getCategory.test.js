import { describe, it, expect } from "vitest";
import { getCategory, CATEGORIES, CATEGORY_LABELS, categoryLabel } from "../../src/utils/pdhCategories.js";

describe("frontend pdhCategories", () => {
  it("CATEGORIES + LABELS cover the 8 buckets", () => {
    expect(CATEGORIES.length).toBe(8);
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });

  it.each([
    ["wechat", "chat"],
    ["messaging-qq", "chat"],
    ["messaging-telegram", "chat"],
    ["social-bilibili", "social"],
    ["social-weibo", "social"],
    ["email-imap", "email"],
    ["email-imap-qq", "email"],
    ["shopping-taobao", "shopping"],
    ["alipay-bill", "shopping"],
    ["travel-12306", "travel"],
    ["system-data-android", "system"],
    ["system-data", "system"],
    ["browser-history-chrome", "system"],
    ["ai-chat-history", "ai-chat"],
    ["unknown-x", "other"],
    ["", "other"],
    [null, "other"],
    [undefined, "other"],
  ])("getCategory(%p) → %s", (adapter, expected) => {
    expect(getCategory(adapter)).toBe(expected);
  });

  it("categoryLabel returns Chinese name for known + fallback for unknown", () => {
    expect(categoryLabel("chat")).toBe("社交聊天");
    expect(categoryLabel("xyz")).toBe("xyz");
    expect(categoryLabel(null)).toBe("未知");
  });
});
