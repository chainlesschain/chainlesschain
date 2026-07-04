import { describe, it, expect } from "vitest";
import {
  getStageIcon,
  getStatusColor,
  getStatusText,
  getProgressStatus,
  getStepClass,
  getScoreColor,
  formatDuration,
  formatDetails,
} from "@renderer/components/workflow/stageDetailUtils";

describe("stageDetailUtils", () => {
  it("maps stage badge digit with fallback", () => {
    expect(getStageIcon("需求分析")).toBe("1");
    expect(getStageIcon("交付确认")).toBe("6");
    expect(getStageIcon("未知阶段")).toBe("?");
  });

  it("maps status color+text", () => {
    expect(getStatusColor("running")).toBe("processing");
    expect(getStatusColor("x")).toBe("default");
    expect(getStatusText("skipped")).toBe("已跳过");
    expect(getStatusText("x")).toBe("未知");
  });

  it("maps progress status", () => {
    expect(getProgressStatus("failed")).toBe("exception");
    expect(getProgressStatus("completed")).toBe("success");
    expect(getProgressStatus("running")).toBe("active");
  });

  it("builds step class object", () => {
    expect(getStepClass({ status: "running" })).toEqual({
      completed: false,
      running: true,
      failed: false,
      pending: false,
    });
  });

  it("bands score color", () => {
    expect(getScoreColor(0.9)).toBe("#52c41a");
    expect(getScoreColor(0.7)).toBe("#faad14");
    expect(getScoreColor(0.4)).toBe("#ff4d4f");
  });

  describe("formatDuration", () => {
    it("empties zero, seconds under a minute, m分s秒 above", () => {
      expect(formatDuration(0)).toBe("");
      expect(formatDuration(5000)).toBe("5秒");
      expect(formatDuration(125000)).toBe("2分5秒");
    });
  });

  it("formatDetails passes strings, stringifies objects", () => {
    expect(formatDetails("hi")).toBe("hi");
    expect(formatDetails({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
