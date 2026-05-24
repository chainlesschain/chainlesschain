"use strict";

import { describe, it, expect } from "vitest";

const {
  CATEGORIES,
  CATEGORY_LABELS,
  getCategory,
  groupByCategory,
} = require("../lib/categories");

describe("PDH categories taxonomy", () => {
  it("CATEGORIES covers the 8 known buckets and is frozen", () => {
    expect(CATEGORIES).toEqual([
      "chat", "social", "email", "shopping", "travel", "system", "ai-chat", "other",
    ]);
    expect(Object.isFrozen(CATEGORIES)).toBe(true);
  });

  it("CATEGORY_LABELS has Chinese label for every category", () => {
    for (const c of CATEGORIES) {
      expect(typeof CATEGORY_LABELS[c]).toBe("string");
      expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["wechat", "chat"],
    ["messaging-qq", "chat"],
    ["messaging-telegram", "chat"],
    ["messaging-whatsapp", "chat"],
    ["social-bilibili", "social"],
    ["social-weibo", "social"],
    ["social-douyin", "social"],
    ["social-xiaohongshu", "social"],
    ["social-toutiao", "social"],
    ["social-kuaishou", "social"],
    ["email-imap", "email"],
    ["email-imap-qq", "email"],
    ["email-imap-gmail", "email"],
    ["alipay-bill", "shopping"],
    ["shopping-taobao", "shopping"],
    ["shopping-jd", "shopping"],
    ["shopping-meituan", "shopping"],
    ["shopping-pinduoduo", "shopping"],
    ["travel-12306", "travel"],
    ["travel-ctrip", "travel"],
    ["travel-amap", "travel"],
    ["travel-baidu-map", "travel"],
    ["travel-tencent-map", "travel"],
    ["system-data", "system"],
    ["system-data-android", "system"],
    ["browser-history-chrome", "system"],
    ["ai-chat-history", "ai-chat"],
    ["ai-chat-deepseek", "ai-chat"],
  ])("getCategory(%s) → %s", (adapter, cat) => {
    expect(getCategory(adapter)).toBe(cat);
  });

  it.each([
    ["unknown-adapter", "other"],
    ["", "other"],
    [null, "other"],
    [undefined, "other"],
    [123, "other"],
  ])("getCategory(%p) falls back to other", (adapter, expected) => {
    expect(getCategory(adapter)).toBe(expected);
  });

  it("groupByCategory groups multiple adapters and omits empty buckets", () => {
    const groups = groupByCategory([
      "wechat",
      "messaging-qq",
      "social-bilibili",
      "email-imap-qq",
      "unknown-x",
    ]);
    expect(groups).toEqual({
      chat: ["wechat", "messaging-qq"],
      social: ["social-bilibili"],
      email: ["email-imap-qq"],
      other: ["unknown-x"],
    });
    expect(groups.travel).toBeUndefined();
  });

  it("groupByCategory tolerates empty / nullish input", () => {
    expect(groupByCategory(null)).toEqual({});
    expect(groupByCategory(undefined)).toEqual({});
    expect(groupByCategory([])).toEqual({});
  });
});
