import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatTime,
  getBadgeColor,
  getRoleColor,
  getActivityColor,
  getActivityText,
} from "@renderer/pages/enterpriseDashboardUtils";

describe("enterpriseDashboardUtils", () => {
  describe("formatBytes", () => {
    it("returns 0 B for zero", () => {
      expect(formatBytes(0)).toBe("0 B");
    });
    it("scales across units", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(1099511627776)).toBe("1 TB");
    });
  });

  describe("formatTime", () => {
    const now = Date.now();
    it("buckets recent times", () => {
      expect(formatTime(now)).toBe("Just now");
      expect(formatTime(now - 5 * 60000)).toBe("5m ago");
      expect(formatTime(now - 3 * 3600000)).toBe("3h ago");
      expect(formatTime(now - 2 * 86400000)).toBe("2d ago");
    });
    it("falls back to a date for old timestamps", () => {
      const out = formatTime(now - 30 * 86400000);
      expect(out).not.toMatch(/ago|Just now/);
      expect(out.length).toBeGreaterThan(0);
    });
  });

  describe("getBadgeColor", () => {
    it("ranks top 3, defaults after", () => {
      expect(getBadgeColor(0)).toBe("#f5222d");
      expect(getBadgeColor(2)).toBe("#faad14");
      expect(getBadgeColor(5)).toBe("#1890ff");
    });
  });

  describe("getRoleColor", () => {
    it("maps roles + falls back", () => {
      expect(getRoleColor("owner")).toBe("red");
      expect(getRoleColor("editor")).toBe("blue");
      expect(getRoleColor("guest")).toBe("default");
    });
  });

  describe("getActivityColor / getActivityText", () => {
    it("maps activity types", () => {
      expect(getActivityColor("create")).toBe("green");
      expect(getActivityColor("delete")).toBe("red");
      expect(getActivityText("edit")).toBe("edited");
      expect(getActivityText("share")).toBe("shared");
    });
    it("falls back for unknown", () => {
      expect(getActivityColor("weird")).toBe("blue");
      expect(getActivityText("weird")).toBe("interacted with");
    });
  });
});
