import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatTimestamp,
  formatEventTime,
  getEventTypeLabel,
  getEventColor,
  getEventDescription,
} from "@renderer/components/browser/recordingPanelUtils";

describe("recordingPanelUtils", () => {
  describe("formatDuration", () => {
    it("shows seconds under a minute", () => {
      expect(formatDuration(5000)).toBe("5s");
      expect(formatDuration(0)).toBe("0s");
    });
    it("shows m:ss under an hour", () => {
      expect(formatDuration(65000)).toBe("1:05");
      expect(formatDuration(125000)).toBe("2:05");
    });
    it("shows h:mm:ss over an hour", () => {
      expect(formatDuration(3661000)).toBe("1:01:01");
    });
  });

  describe("formatTimestamp / formatEventTime", () => {
    it("produce non-empty strings", () => {
      expect(typeof formatTimestamp(1700000000000)).toBe("string");
      expect(formatTimestamp(1700000000000).length).toBeGreaterThan(0);
      expect(typeof formatEventTime(1700000000000)).toBe("string");
      expect(formatEventTime(1700000000000).length).toBeGreaterThan(0);
    });
  });

  describe("getEventTypeLabel", () => {
    it("maps known types + falls back to raw", () => {
      expect(getEventTypeLabel("click")).toBe("点击");
      expect(getEventTypeLabel("blur")).toBe("失焦");
      expect(getEventTypeLabel("custom")).toBe("custom");
    });
  });

  describe("getEventColor", () => {
    it("maps known types + defaults", () => {
      expect(getEventColor("click")).toBe("blue");
      expect(getEventColor("key")).toBe("cyan");
      expect(getEventColor("hover")).toBe("default");
    });
  });

  describe("getEventDescription", () => {
    it("describes each event kind", () => {
      expect(getEventDescription({ type: "click", selector: "#btn" })).toBe(
        "点击 #btn",
      );
      expect(getEventDescription({ type: "click" })).toBe("点击 元素");
      expect(getEventDescription({ type: "type", text: "hi" })).toBe(
        '输入 "hi"',
      );
      expect(getEventDescription({ type: "navigate", url: "/x" })).toBe(
        "导航到 /x",
      );
      expect(getEventDescription({ type: "scroll", x: 1, y: 2 })).toBe(
        "滚动到 (1, 2)",
      );
      expect(getEventDescription({ type: "key", key: "Enter" })).toBe(
        "按键 Enter",
      );
    });
    it("falls back to description for unknown types", () => {
      expect(getEventDescription({ type: "other", description: "d" })).toBe(
        "d",
      );
      expect(getEventDescription({ type: "other" })).toBe("");
    });
  });
});
