import { describe, it, expect } from "vitest";
import {
  getStageKey,
  getStageDescription,
  getStepIconClass,
  formatDuration,
} from "@renderer/components/workflow/workflowProgressUtils";

describe("workflow/workflowProgressUtils", () => {
  describe("getStageKey", () => {
    it("maps indices to stage keys", () => {
      expect(getStageKey(0)).toBe("analysis");
      expect(getStageKey(5)).toBe("delivery");
    });
    it("falls back to unknown out of range", () => {
      expect(getStageKey(99)).toBe("unknown");
    });
  });

  describe("getStageDescription", () => {
    it("shows completed with duration", () => {
      expect(getStageDescription({ status: "completed", duration: 5000 })).toBe(
        "完成 (5秒)",
      );
    });
    it("shows progress when running", () => {
      expect(getStageDescription({ status: "running", progress: 42 })).toBe(
        "42%",
      );
      expect(getStageDescription({ status: "running" })).toBe("0%");
    });
    it("shows failure label", () => {
      expect(getStageDescription({ status: "failed" })).toBe("失败");
    });
    it("empty for pending/other", () => {
      expect(getStageDescription({ status: "pending" })).toBe("");
    });
  });

  describe("getStepIconClass", () => {
    it("flags the active status", () => {
      expect(getStepIconClass({ status: "running" })).toEqual({
        completed: false,
        running: true,
        failed: false,
        pending: false,
      });
    });
  });

  describe("formatDuration", () => {
    it("returns 0秒 for empty", () => {
      expect(formatDuration(0)).toBe("0秒");
      expect(formatDuration(null)).toBe("0秒");
    });
    it("formats seconds/minutes/hours", () => {
      expect(formatDuration(45 * 1000)).toBe("45秒");
      expect(formatDuration((3 * 60 + 20) * 1000)).toBe("3分20秒");
      expect(formatDuration((2 * 60 + 15) * 60 * 1000)).toBe("2时15分");
    });
  });
});
