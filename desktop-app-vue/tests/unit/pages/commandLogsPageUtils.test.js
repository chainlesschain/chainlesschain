import { describe, it, expect } from "vitest";
import {
  getStatusColor,
  getStatusText,
  getLevelColor,
  getDurationColor,
  truncate,
  formatTimestamp,
  formatJSON,
} from "@renderer/pages/commandLogsPageUtils";

describe("commandLogsPageUtils", () => {
  describe("getStatusColor / getStatusText", () => {
    it("maps known statuses", () => {
      expect(getStatusColor("success")).toBe("success");
      expect(getStatusColor("failure")).toBe("error");
      expect(getStatusText("warning")).toBe("警告");
    });
    it("falls back", () => {
      expect(getStatusColor("x")).toBe("default");
      expect(getStatusText("x")).toBe("x");
    });
  });

  describe("getLevelColor", () => {
    it("maps log levels + defaults", () => {
      expect(getLevelColor("info")).toBe("processing");
      expect(getLevelColor("error")).toBe("error");
      expect(getLevelColor("trace")).toBe("default");
    });
  });

  describe("getDurationColor", () => {
    it("bands by duration", () => {
      expect(getDurationColor(100)).toBe("success");
      expect(getDurationColor(1000)).toBe("warning");
      expect(getDurationColor(5000)).toBe("error");
    });
  });

  describe("truncate", () => {
    it("returns empty for falsy", () => {
      expect(truncate("", 5)).toBe("");
      expect(truncate(null, 5)).toBe("");
    });
    it("leaves short strings, truncates long with ellipsis", () => {
      expect(truncate("abc", 5)).toBe("abc");
      expect(truncate("abcdefgh", 5)).toBe("abcde...");
    });
  });

  describe("formatTimestamp", () => {
    it("formats as YYYY-MM-DD HH:mm:ss", () => {
      expect(formatTimestamp(1700000000000)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
  });

  describe("formatJSON", () => {
    it("returns empty for falsy", () => {
      expect(formatJSON(null)).toBe("");
      expect(formatJSON("")).toBe("");
    });
    it("pretty-prints objects and JSON strings", () => {
      expect(formatJSON({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(formatJSON('{"b":2}')).toBe('{\n  "b": 2\n}');
    });
    it("returns raw string on parse failure", () => {
      expect(formatJSON("not-json")).toBe("not-json");
    });
  });
});
