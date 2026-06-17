/**
 * categoryMap 测试 — src/renderer/utils/categoryMap.ts
 *
 * Pure category name mapping + helpers. No deps.
 */

import { describe, it, expect } from "vitest";

import {
  categoryMap,
  getCategoryName,
  getAllCategories,
  isProfessionalCategory,
} from "@/utils/categoryMap";

describe("categoryMap — getCategoryName", () => {
  it("maps known categories to their Chinese label", () => {
    expect(getCategoryName("medical")).toBe("🏥 医疗");
    expect(getCategoryName("writing")).toBe("写作");
    expect(getCategoryName("all")).toBe("全部");
  });

  it("falls back to the raw value for unknown categories", () => {
    expect(getCategoryName("not-a-category")).toBe("not-a-category");
  });

  it("returns 未分类 for null / undefined / empty", () => {
    expect(getCategoryName(null)).toBe("未分类");
    expect(getCategoryName(undefined)).toBe("未分类");
    expect(getCategoryName("")).toBe("未分类");
  });
});

describe("categoryMap — getAllCategories", () => {
  it("returns a shallow copy, not the original reference", () => {
    const all = getAllCategories();
    expect(all).toEqual(categoryMap);
    expect(all).not.toBe(categoryMap);
    all.medical = "mutated";
    expect(categoryMap.medical).toBe("🏥 医疗"); // original untouched
  });
});

describe("categoryMap — isProfessionalCategory", () => {
  it("recognizes the four professional categories only", () => {
    expect(isProfessionalCategory("medical")).toBe(true);
    expect(isProfessionalCategory("legal")).toBe(true);
    expect(isProfessionalCategory("education")).toBe(true);
    expect(isProfessionalCategory("research")).toBe(true);
    expect(isProfessionalCategory("writing")).toBe(false);
    expect(isProfessionalCategory("unknown")).toBe(false);
  });
});
