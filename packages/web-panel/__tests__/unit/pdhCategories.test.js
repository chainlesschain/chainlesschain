/**
 * pdhCategories — frontend adapter→category mirror tests.
 *
 * This util is a hand-maintained MIRROR of the backend single-source-of-truth
 * `@chainlesschain/personal-data-hub/lib/categories.js` (its header warns the
 * two must be kept in sync manually). The key test here is a DRIFT GUARD that
 * cross-checks the frontend getCategory against the backend for representative
 * adapter names — so a future edit to one but not the other fails CI.
 *
 * No bug found on review (the FE `-`-suffix prefix detection is equivalent to
 * the BE `*`-suffix one). Regression/parity protection only.
 */

import { describe, it, expect } from "vitest";
import {
  getCategory,
  categoryLabel,
  CATEGORIES,
  CATEGORY_LABELS,
} from "../../src/utils/pdhCategories.js";
import be from "../../../personal-data-hub/lib/categories.js";

const SAMPLES = [
  "wechat",
  "wechat-pc",
  "messaging-qq",
  "social-bilibili",
  "email-imap-qq",
  "shopping-taobao",
  "alipay-bill",
  "travel-12306",
  "system-data",
  "system-data-android",
  "browser-history",
  "vscode",
  "win-recent",
  "git-activity",
  "shell-history",
  "local-files",
  "ai-chat-doubao",
  "unknown-thing",
  "",
];

describe("pdhCategories.getCategory", () => {
  it("classifies representative adapters into the expected buckets", () => {
    expect(getCategory("wechat")).toBe("chat");
    expect(getCategory("messaging-qq")).toBe("chat");
    expect(getCategory("social-bilibili")).toBe("social");
    expect(getCategory("email-imap-qq")).toBe("email");
    expect(getCategory("shopping-taobao")).toBe("shopping");
    expect(getCategory("travel-12306")).toBe("travel");
    expect(getCategory("system-data-android")).toBe("system");
    expect(getCategory("ai-chat-doubao")).toBe("ai-chat");
  });

  it("returns 'other' for unknown / empty / non-string input", () => {
    expect(getCategory("unknown-thing")).toBe("other");
    expect(getCategory("")).toBe("other");
    expect(getCategory(null)).toBe("other");
    expect(getCategory(undefined)).toBe("other");
  });

  it("DRIFT GUARD: matches the backend categories.js for every sample", () => {
    for (const name of SAMPLES) {
      expect(getCategory(name)).toBe(be.getCategory(name));
    }
  });

  it("every category the backend can return has a frontend label", () => {
    for (const name of SAMPLES) {
      const cat = be.getCategory(name);
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});

describe("pdhCategories.categoryLabel", () => {
  it("returns the display label, falling back to the id then '未知'", () => {
    expect(categoryLabel("chat")).toBe("社交聊天");
    expect(categoryLabel("nonexistent")).toBe("nonexistent");
    expect(categoryLabel("")).toBe("未知");
    expect(categoryLabel(null)).toBe("未知");
  });

  it("every CATEGORIES id has a label", () => {
    for (const id of CATEGORIES) {
      expect(CATEGORY_LABELS[id]).toBeTruthy();
    }
  });
});
