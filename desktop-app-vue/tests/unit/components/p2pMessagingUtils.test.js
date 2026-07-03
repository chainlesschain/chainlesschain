import { describe, it, expect } from "vitest";
import {
  getSessionKey,
  getDeviceColor,
  formatTime,
} from "@renderer/components/p2pMessagingUtils";

describe("p2pMessagingUtils", () => {
  it("getSessionKey joins peer and device ids", () => {
    expect(getSessionKey("peerA", "devB")).toBe("peerA-devB");
  });

  it("getDeviceColor maps platforms, defaults to grey", () => {
    expect(getDeviceColor("win32")).toBe("#1890ff");
    expect(getDeviceColor("darwin")).toBe("#722ed1");
    expect(getDeviceColor("android")).toBe("#52c41a");
    expect(getDeviceColor("unknown-os")).toBe("#999");
  });

  describe("formatTime", () => {
    it("shows HH:MM for a timestamp within today", () => {
      const out = formatTime(Date.now() - 60 * 1000);
      expect(out).toMatch(/\d{1,2}:\d{2}/);
    });
    it("shows 'N天前' within the last week", () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000 - 60 * 1000;
      expect(formatTime(threeDaysAgo)).toBe("3天前");
    });
    it("shows a date string for older timestamps", () => {
      const long = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const out = formatTime(long);
      expect(out).not.toMatch(/天前/);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
