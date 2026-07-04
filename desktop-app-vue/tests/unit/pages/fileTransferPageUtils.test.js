import { describe, it, expect } from "vitest";
import {
  getStatusColor,
  getStatusText,
  formatFileSize,
  formatSpeed,
  formatRelativeTime,
  formatDateTime,
} from "@renderer/pages/p2p/fileTransferPageUtils";

describe("fileTransferPageUtils", () => {
  it("maps transfer status color+text", () => {
    expect(getStatusColor("uploading")).toBe("blue");
    expect(getStatusColor("error")).toBe("error");
    expect(getStatusColor("x")).toBe("default");
    expect(getStatusText("downloading")).toBe("接收中");
    expect(getStatusText("x")).toBe("x");
  });

  describe("formatFileSize / formatSpeed", () => {
    it("scales size and appends /s for speed", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1048576)).toBe("1 MB");
      expect(formatSpeed(1024)).toBe("1 KB/s");
    });
  });

  describe("formatRelativeTime", () => {
    it("buckets recent, delegates to full datetime for old", () => {
      expect(formatRelativeTime(Date.now())).toBe("刚刚");
      expect(formatRelativeTime(Date.now() - 30 * 60000)).toBe("30分钟前");
      const old = formatRelativeTime(Date.now() - 5 * 3600000);
      expect(old).not.toMatch(/刚刚|分钟前/);
      expect(typeof old).toBe("string");
    });
  });

  it("formatDateTime returns a locale string", () => {
    expect(typeof formatDateTime(1700000000000)).toBe("string");
    expect(formatDateTime(1700000000000).length).toBeGreaterThan(0);
  });
});
