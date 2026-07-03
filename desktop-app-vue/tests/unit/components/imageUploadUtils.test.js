import { describe, it, expect } from "vitest";
import {
  formatFileSize,
  formatDate,
  getResultHeader,
  getConfidenceColor,
  getQualityColor,
  getQualityLabel,
} from "@renderer/components/imageUploadUtils";

describe("imageUploadUtils", () => {
  describe("formatFileSize", () => {
    it("returns 0 B for falsy", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(undefined)).toBe("0 B");
    });
    it("scales across units", () => {
      expect(formatFileSize(512)).toBe("512.00 B");
      expect(formatFileSize(1024)).toBe("1.00 KB");
      expect(formatFileSize(1048576)).toBe("1.00 MB");
    });
  });

  describe("formatDate", () => {
    it("returns dash for falsy", () => {
      expect(formatDate(0)).toBe("-");
      expect(formatDate(null)).toBe("-");
    });
    it("formats a timestamp", () => {
      const out = formatDate(1700000000000);
      expect(typeof out).toBe("string");
      expect(out).not.toBe("-");
    });
  });

  describe("getResultHeader", () => {
    it("uses basename for success/failure", () => {
      expect(getResultHeader({ success: true, path: "a/b/photo.png" }, 0)).toBe(
        "✓ photo.png",
      );
      expect(
        getResultHeader({ success: false, path: "C:\\x\\y\\scan.jpg" }, 0),
      ).toBe("✗ scan.jpg");
    });
    it("falls back to index label when no path", () => {
      expect(getResultHeader({ success: true }, 2)).toBe("✓ 图片 3");
    });
  });

  describe("getConfidenceColor", () => {
    it("bands by confidence", () => {
      expect(getConfidenceColor(90)).toBe("green");
      expect(getConfidenceColor(70)).toBe("blue");
      expect(getConfidenceColor(50)).toBe("orange");
      expect(getConfidenceColor(10)).toBe("red");
    });
  });

  describe("getQualityColor / getQualityLabel", () => {
    it("maps known qualities", () => {
      expect(getQualityColor("high")).toBe("green");
      expect(getQualityColor("very_low")).toBe("red");
      expect(getQualityLabel("high")).toBe("高质量");
      expect(getQualityLabel("very_low")).toBe("很低质量");
    });
    it("falls back for unknown", () => {
      expect(getQualityColor("weird")).toBe("default");
      expect(getQualityLabel("weird")).toBe("未知");
    });
  });
});
