import { describe, it, expect } from "vitest";
import {
  getEventColor,
  formatTime,
  formatDuration,
  truncate,
} from "@renderer/components/browser/recording/recordingTimelineUtils";

describe("browser/recording/recordingTimelineUtils", () => {
  describe("getEventColor", () => {
    it("maps event types with fallback", () => {
      expect(getEventColor("click")).toBe("green");
      expect(getEventColor("navigate")).toBe("purple");
      expect(getEventColor("hover")).toBe("default");
      expect(getEventColor("x")).toBe("default");
    });
  });

  describe("formatTime", () => {
    it("formats mm:ss.cs", () => {
      expect(formatTime(0)).toBe("0:00.00");
      expect(formatTime(65_430)).toBe("1:05.43");
    });
  });

  describe("formatDuration", () => {
    it("returns 0:00 for falsy", () => {
      expect(formatDuration(0)).toBe("0:00");
      expect(formatDuration(null)).toBe("0:00");
    });
    it("formats mm:ss", () => {
      expect(formatDuration(65_000)).toBe("1:05");
      expect(formatDuration(600_000)).toBe("10:00");
    });
  });

  describe("truncate", () => {
    it("empties falsy, keeps short, truncates long", () => {
      expect(truncate("", 10)).toBe("");
      expect(truncate("short", 10)).toBe("short");
      expect(truncate("0123456789abc", 10)).toBe("0123456789...");
    });
  });
});
