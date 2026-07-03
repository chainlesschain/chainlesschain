import { describe, it, expect } from "vitest";
import {
  getCategoryColor,
  getCategoryLabel,
  formatFileSize,
  formatDate,
} from "@renderer/pages/externalDeviceBrowserUtils";

describe("externalDeviceBrowserUtils", () => {
  it("getCategoryColor maps categories, defaults otherwise", () => {
    expect(getCategoryColor("DOCUMENT")).toBe("blue");
    expect(getCategoryColor("CODE")).toBe("cyan");
    expect(getCategoryColor("WHAT")).toBe("default");
  });

  it("getCategoryLabel maps categories, echoes unknown", () => {
    expect(getCategoryLabel("IMAGE")).toBe("图片");
    expect(getCategoryLabel("OTHER")).toBe("其他");
    expect(getCategoryLabel("WHAT")).toBe("WHAT");
  });

  describe("formatFileSize", () => {
    it("returns '0 B' for zero/falsy", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(null)).toBe("0 B");
    });
    it("scales to the right unit with 2 decimals", () => {
      expect(formatFileSize(1024)).toBe("1.00 KB");
      expect(formatFileSize(1536)).toBe("1.50 KB");
      expect(formatFileSize(5 * 1024 * 1024)).toBe("5.00 MB");
    });
  });

  describe("formatDate", () => {
    it("returns '-' for falsy input", () => {
      expect(formatDate(null)).toBe("-");
    });
    it("returns relative buckets for recent timestamps", () => {
      expect(formatDate(Date.now() - 10 * 60000)).toBe("10分钟前");
      expect(formatDate(Date.now() - 3 * 3600000)).toBe("3小时前");
      expect(formatDate(Date.now() - 2 * 86400000)).toBe("2天前");
    });
  });
});
